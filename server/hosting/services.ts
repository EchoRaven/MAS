// Hosted services: code someone uploads (an archive, or a git repository),
// built into a Docker image and run isolated on this server, so an MCP server,
// a plugin backend or a tool can live here instead of somewhere else.
//
//   mcp-stdio   a fresh container per connection (docker run -i), no network
//   mcp-http    one long-running container on an internal network, reached
//   http        at its address by this server only (no published port)
//
// No network unless the service declares egress hosts; then it reaches those
// hosts only, through the egress proxy (it stays on the internal network, with
// no route out of its own). Unprivileged user, no capabilities,
// memory / CPU / process limits. Secrets go in as environment variables when
// the container starts and are never written to disk.
import { ModelGateway } from "./modelGateway";
import { SECCOMP_PROFILE } from "../runtime/isolation";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { checkManifest, COMPOSE_FILES, DEFAULT_MANIFEST, detectRuntime, generatedDockerfile, type Endpoint, type HostManifest } from "@/model/hosting";
import { sanitizeCompose } from "./compose";
import type { Secrets } from "../store/secrets";
import { type EgressAccess, EgressProxy } from "./egress";
import { HttpError } from "../store/files";

const MAX_ARCHIVE = 15 * 1024 * 1024;
const MAX_UNPACKED = 200 * 1024 * 1024;
const INTERNAL_NET = "mas-hosted";

export interface ServiceVersion {
  n: number;
  from: "upload" | "git";
  source: string;
  at: string;
  files: number;
  image?: string;
  built_at?: string;
  build_ok?: boolean;
}

export interface HostedService {
  id: string;
  name: string;
  created_at: string;
  current: number;
  versions: ServiceVersion[];
  /** what the project's own mas-host file says, with what was set on the service on top */
  manifest: HostManifest;
  /** set on the service (overrides the project file) */
  overrides: Partial<HostManifest>;
}

export type ServiceState = { running: boolean; address?: string; container?: string };

function exec(cmd: string, args: string[], opts: { timeout?: number; cwd?: string; env?: Record<string, string> } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout ?? 120_000, cwd: opts.cwd, env: opts.env ? { ...process.env, ...opts.env } : process.env, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === "number" ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, out: `${stdout}${stderr ? (stdout ? "\n" : "") + stderr : ""}`.trim() });
    });
  });
}

/** An archive member that could write outside the folder it is unpacked into. */
export function unsafeMember(name: string): boolean {
  const n = name.replace(/\\/g, "/");
  return n.startsWith("/") || /^[a-zA-Z]:/.test(n) || n.split("/").includes("..");
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

export class HostedServices {
  private root: string;
  private building = new Set<string>();
  /** the only way out for services that declare egress hosts */
  readonly egress = new EgressProxy();
  /** models for agent programs in containers: a token per turn, the key swapped in here */
  readonly models: ModelGateway;
  /** where hosted agent programs reach the platform's MCP (set when the gateway listener starts) */
  mcpGateway: string | null = null;
  /** when each long-running service was last used: idle ones are stopped, and start again on next use */
  private lastUsed = new Map<string, number>();
  private reaper?: NodeJS.Timeout;
  constructor(
    dataDir: string,
    private docker: string,
    private secrets: Secrets,
  ) {
    this.models = new ModelGateway(secrets);
    this.root = path.join(dataDir, "hosted");
    fs.mkdirSync(this.root, { recursive: true });
  }

  /** Check every few minutes for long-running services nobody has used for a while. */
  startReaper(everyMs = 5 * 60_000) {
    this.reaper ??= setInterval(() => void this.stopIdle(), everyMs);
    this.reaper.unref?.();
  }

  /** Stop long-running services idle for longer than their idle_minutes (default 30; 0 = never). Returns the ones stopped. */
  async stopIdle(now = Date.now()): Promise<string[]> {
    const stopped: string[] = [];
    // the idle clock is kept in memory: a service still running from before a restart starts its clock now, or it
    // would never be stopped (one ran 18 hours this way)
    const ps = await exec(this.docker, ["ps", "--filter", "label=mas.service", "--format", '{{.Label "mas.service"}}'], { timeout: 20_000 });
    if (ps.code === 0) for (const id of ps.out.split("\n").map((l) => l.trim()).filter(Boolean)) if (!this.lastUsed.has(id)) this.lastUsed.set(id, now);
    for (const [id, at] of this.lastUsed) {
      const s = this.get(id);
      if (!s) {
        this.lastUsed.delete(id);
        continue;
      }
      const limit = s.manifest.idle_minutes ?? 30;
      if (limit > 0 && now - at > limit * 60_000) {
        await this.stop(id);
        this.lastUsed.delete(id);
        stopped.push(id);
      }
    }
    return stopped;
  }

  /** Note a use of a long-running service (so it is not stopped as idle). */
  touch(id: string, now = Date.now()) {
    this.lastUsed.set(id, now);
  }

  // ---- storage ---------------------------------------------------------------------------
  private dir(id: string) {
    if (!/^svc_[a-z0-9_]+$/.test(id)) throw new HttpError(400, "Not a service id");
    return path.join(this.root, id);
  }
  private save(s: HostedService) {
    fs.writeFileSync(path.join(this.dir(s.id), "service.json"), JSON.stringify(s, null, 1));
  }
  list(): HostedService[] {
    return fs
      .readdirSync(this.root)
      .filter((d) => d.startsWith("svc_") && fs.existsSync(path.join(this.root, d, "service.json")))
      .map((d) => JSON.parse(fs.readFileSync(path.join(this.root, d, "service.json"), "utf8")) as HostedService)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  get(id: string): HostedService | null {
    const f = path.join(this.dir(id), "service.json");
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as HostedService) : null;
  }
  private must(id: string): HostedService {
    const s = this.get(id);
    if (!s) throw new HttpError(404, `No hosted service ${id}`);
    return s;
  }
  srcDir(id: string, n: number) {
    return path.join(this.dir(id), `v${n}`, "src");
  }

  /** A new service from an archive (base64 .tar.gz / .tgz / .zip) or a git repository (https). */
  async create(input: { name: string; archive_base64?: string; filename?: string; git?: string; manifest?: Partial<HostManifest> }): Promise<HostedService> {
    const name = String(input.name ?? "").trim();
    if (!name) throw new HttpError(400, "Give the service a name");
    const id = `svc_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "service"}_${crypto.randomBytes(3).toString("hex")}`;
    fs.mkdirSync(this.dir(id), { recursive: true });
    const s: HostedService = { id, name, created_at: new Date().toISOString(), current: 0, versions: [], manifest: { ...DEFAULT_MANIFEST }, overrides: input.manifest ?? {} };
    try {
      await this.addVersion(s, input);
    } catch (e) {
      fs.rmSync(this.dir(id), { recursive: true, force: true });
      throw e;
    }
    return s;
  }

  /** A new version of the code; the service switches to it (the old ones stay, to go back to). */
  async update(id: string, input: { archive_base64?: string; filename?: string; git?: string }): Promise<HostedService> {
    const s = this.must(id);
    await this.addVersion(s, input);
    return s;
  }

  private async addVersion(s: HostedService, input: { archive_base64?: string; filename?: string; git?: string }) {
    const n = (s.versions.at(-1)?.n ?? 0) + 1;
    const src = this.srcDir(s.id, n);
    fs.mkdirSync(src, { recursive: true });
    let from: ServiceVersion["from"];
    let source: string;
    if (input.git) {
      const url = String(input.git);
      if (!/^https:\/\/[^\s]+$/.test(url)) throw new HttpError(400, "Only https git URLs");
      const r = await exec("git", ["clone", "--depth", "1", "--no-recurse-submodules", url, src], { timeout: 300_000, env: { GIT_TERMINAL_PROMPT: "0" } });
      if (r.code !== 0) throw new HttpError(400, `git clone failed: ${r.out.slice(-300)}`);
      fs.rmSync(path.join(src, ".git"), { recursive: true, force: true });
      from = "git";
      source = url;
    } else if (input.archive_base64) {
      const buf = Buffer.from(input.archive_base64, "base64");
      if (!buf.length) throw new HttpError(400, "The archive is empty");
      if (buf.length > MAX_ARCHIVE) throw new HttpError(413, `The archive is over ${MAX_ARCHIVE / 1024 / 1024} MB`);
      const fname = String(input.filename ?? "project.tar.gz");
      const tmp = path.join(this.dir(s.id), `v${n}`, fname.endsWith(".zip") ? "upload.zip" : "upload.tar.gz");
      fs.writeFileSync(tmp, buf);
      await this.unpack(tmp, src);
      fs.rmSync(tmp, { force: true });
      from = "upload";
      source = fname;
    } else throw new HttpError(400, "Give an archive (archive_base64 with filename) or a git URL");
    // a project in one top folder (the usual archive) is that folder
    const top = fs.readdirSync(src);
    if (top.length === 1 && fs.statSync(path.join(src, top[0])).isDirectory()) {
      const inner = path.join(src, top[0]);
      for (const f of fs.readdirSync(inner)) fs.renameSync(path.join(inner, f), path.join(src, f));
      fs.rmdirSync(inner);
    }
    const files = listFiles(src);
    if (!files.length) throw new HttpError(400, "The project has no files");
    s.versions.push({ n, from, source, at: new Date().toISOString(), files: files.length });
    s.current = n;
    s.manifest = this.effectiveManifest(src, s.overrides);
    this.save(s);
  }

  /** Unpack after checking every member: no absolute paths, no "..", no links, a size cap. */
  private async unpack(archive: string, into: string) {
    const zip = archive.endsWith(".zip");
    const listing = zip ? await exec("unzip", ["-Z", "-l", archive]) : await exec("tar", ["-tvzf", archive]);
    if (listing.code !== 0) throw new HttpError(400, `Not a readable ${zip ? "zip" : ".tar.gz"} archive`);
    const names = zip ? (await exec("unzip", ["-Z1", archive])).out.split("\n").filter(Boolean) : (await exec("tar", ["-tzf", archive])).out.split("\n").filter(Boolean);
    const bad = names.filter(unsafeMember);
    if (bad.length) throw new HttpError(400, `The archive has paths outside its folder: ${bad.slice(0, 3).join(", ")}`);
    // links (tar: l/h in the mode column; zip: l in the permissions) could point anywhere
    const lines = listing.out.split("\n");
    if (lines.some((l) => (zip ? /^l/.test(l.trim()) : /^[lh]/.test(l)))) throw new HttpError(400, "The archive has links; send plain files");
    let total = 0;
    if (!zip) for (const l of lines) total += Number(l.split(/\s+/)[2] ?? 0) || 0;
    else for (const l of lines) total += Number(l.trim().split(/\s+/)[3] ?? 0) || 0;
    if (total > MAX_UNPACKED) throw new HttpError(413, `The project unpacks to over ${MAX_UNPACKED / 1024 / 1024} MB`);
    const r = zip ? await exec("unzip", ["-q", "-o", archive, "-d", into], { timeout: 120_000 }) : await exec("tar", ["-xzf", archive, "-C", into, "--no-same-owner", "--no-same-permissions"], { timeout: 120_000 });
    if (r.code !== 0) throw new HttpError(400, `Could not unpack: ${r.out.slice(-200)}`);
  }

  private effectiveManifest(src: string, overrides: Partial<HostManifest>): HostManifest {
    let own: Partial<HostManifest> = {};
    for (const f of ["mas-host.yaml", "mas-host.yml", "mas-host.json"]) {
      const p = path.join(src, f);
      if (!fs.existsSync(p)) continue;
      const text = fs.readFileSync(p, "utf8");
      own = (f.endsWith(".json") ? JSON.parse(text) : parseYaml(text)) ?? {};
      break;
    }
    return { ...DEFAULT_MANIFEST, ...own, ...overrides, expose: { ...DEFAULT_MANIFEST.expose, ...(own.expose ?? {}), ...(overrides.expose ?? {}) } } as HostManifest;
  }

  /** Change how the service runs (start, expose, egress, env…); kept across new versions of the code. */
  configure(id: string, overrides: Partial<HostManifest>): HostedService {
    const s = this.must(id);
    s.overrides = { ...s.overrides, ...overrides };
    s.manifest = this.effectiveManifest(this.srcDir(id, s.current), s.overrides);
    const why = checkManifest(s.manifest);
    if (why.length) throw new HttpError(400, why.join("; "));
    this.save(s);
    return s;
  }

  /** Remove the service: its containers (and a compose project's volumes and network), images, and every version. */
  async delete(id: string) {
    const s = this.must(id);
    // everything that needs the project's files runs before they are removed
    if (s.versions.find((x) => x.n === s.current)?.image?.startsWith("compose:")) {
      await this.compose(s, ["down", "-v", "--rmi", "local"], {}, 300_000);
      await exec(this.docker, ["network", "rm", this.projectNet(id)], { timeout: 30_000 });
    } else await this.stop(id);
    for (const v of s.versions) if (v.image && !v.image.startsWith("compose:")) await exec(this.docker, ["rmi", "-f", v.image], { timeout: 60_000 });
    fs.rmSync(this.dir(id), { recursive: true, force: true });
  }


  // ---- build -----------------------------------------------------------------------------
  /** Build the current version into an image. The build may use the network (to install dependencies). */
  async build(id: string): Promise<{ ok: boolean; log: string; image?: string }> {
    const s = this.must(id);
    const why = checkManifest(s.manifest);
    if (why.length) return { ok: false, log: `The service is not set up yet: ${why.join("; ")}` };
    if (this.building.has(id)) return { ok: false, log: "Already building" };
    this.building.add(id);
    try {
      const v = s.versions.find((x) => x.n === s.current)!;
      const src = this.srcDir(id, v.n);
      const files = listFiles(src);
      const runtime = detectRuntime(files, s.manifest.runtime);
      if (!runtime) return { ok: false, log: "Cannot tell how to build this: add a Dockerfile, a requirements.txt / pyproject.toml, a package.json, or set runtime" };
      if (runtime === "compose") return await this.buildCompose(s, v, src, files);
      if (runtime !== "dockerfile" && !s.manifest.start) return { ok: false, log: "Say how to start it: start in mas-host.yaml, or set it on the service" };
      const dockerfile = path.join(path.dirname(src), "Dockerfile.mas");
      if (runtime === "dockerfile") fs.copyFileSync(path.join(src, "Dockerfile"), dockerfile);
      else fs.writeFileSync(dockerfile, generatedDockerfile(runtime, files, s.manifest));
      const image = `mas-hosted-${id.replace(/_/g, "-")}:v${v.n}`;
      const r = await exec(this.docker, ["build", "-t", image, "-f", dockerfile, src], { timeout: 900_000 });
      const log = r.out.slice(-6000);
      fs.writeFileSync(path.join(path.dirname(src), "build.log"), r.out);
      Object.assign(v, { built_at: new Date().toISOString(), build_ok: r.code === 0, ...(r.code === 0 ? { image } : {}) });
      this.save(s);
      return { ok: r.code === 0, log, ...(r.code === 0 ? { image } : {}) };
    } finally {
      this.building.delete(id);
    }
  }

  // ---- compose projects ------------------------------------------------------------------
  private project(id: string) {
    return `mas-${id.replace(/_/g, "-")}`;
  }
  private composeFile(id: string, n: number) {
    return path.join(this.srcDir(id, n), ".mas-compose.json");
  }
  private isCompose(s: HostedService) {
    return detectRuntime(listFiles(this.srcDir(s.id, s.current)), s.manifest.runtime) === "compose";
  }
  /** `docker compose` (the plugin) where there is one, else the standalone docker-compose */
  private composeCli?: Promise<[string, string[]]>;
  private async compose(s: HostedService, args: string[], env: Record<string, string> = {}, timeout = 600_000) {
    this.composeCli ??= exec(this.docker, ["compose", "version"], { timeout: 20_000 }).then((r) => (r.code === 0 ? [this.docker, ["compose"]] : ["docker-compose", []]) as [string, string[]]);
    const [cmd, pre] = await this.composeCli;
    return exec(cmd, [...pre, "-p", this.project(s.id), "-f", this.composeFile(s.id, s.current), ...args], { timeout, env, cwd: this.srcDir(s.id, s.current) });
  }

  /** Rewrite the project's compose file (see compose.ts), then build its images. */
  private async buildCompose(s: HostedService, v: ServiceVersion, src: string, files: string[]): Promise<{ ok: boolean; log: string; image?: string }> {
    if (!s.manifest.expose.service) return { ok: false, log: "Say which compose service is reached: expose.service (and its port)" };
    const file = COMPOSE_FILES.find((f) => files.includes(f))!;
    const raw = parseYaml(fs.readFileSync(path.join(src, file), "utf8"));
    const check = sanitizeCompose(raw, { memory: s.manifest.memory, egress: (s.manifest.egress ?? []).length > 0, network: this.projectNet(s.id) });
    if (!check.ok) return { ok: false, log: `This compose project cannot be hosted as it is:\n- ${check.refused.join("\n- ")}` };
    if (!check.services.includes(s.manifest.expose.service)) return { ok: false, log: `expose.service ${s.manifest.expose.service} is not one of its services: ${check.services.join(", ")}` };
    // the project's internal network gets a subnet of its own from 10.213.0.0/16: Docker's default pools run out
    // on a busy host, and a shared network would let two projects' services of the same name collide. It is made
    // outside compose, so the egress proxy can listen on its gateway before anything starts.
    const subnet = this.subnetOf(s.id) ?? (await this.freeSubnet());
    if (!subnet) return { ok: false, log: "No free subnet in 10.213.0.0/16 for this project's network" };
    fs.writeFileSync(path.join(this.dir(s.id), "subnet"), subnet);
    fs.writeFileSync(this.composeFile(s.id, v.n), JSON.stringify(check.doc, null, 1));
    const r = await this.compose(s, ["build"], {}, 1_800_000);
    const log = [`Rewritten for hosting:${check.changed.length ? "\n- " + check.changed.join("\n- ") : " nothing to change"}`, r.out.slice(-5000)].join("\n\n");
    fs.writeFileSync(path.join(path.dirname(src), "build.log"), log);
    Object.assign(v, { built_at: new Date().toISOString(), build_ok: r.code === 0, ...(r.code === 0 ? { image: `compose:${this.project(s.id)}` } : {}) });
    this.save(s);
    return { ok: r.code === 0, log, ...(r.code === 0 ? { image: v.image } : {}) };
  }

  private projectNet(id: string) {
    return `${this.project(id)}-net`;
  }
  private subnetOf(id: string): string | null {
    const f = path.join(this.dir(id), "subnet");
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : null;
  }

  /** Create the project's internal network (if it is not there) and return its gateway. */
  private async projectNetwork(s: HostedService): Promise<string> {
    const subnet = this.subnetOf(s.id);
    if (!subnet) throw new Error(`${s.name} has no network yet: build it first`);
    const name = this.projectNet(s.id);
    if ((await exec(this.docker, ["network", "inspect", name], { timeout: 20_000 })).code !== 0) {
      const r = await exec(this.docker, ["network", "create", "--internal", "--subnet", subnet, name], { timeout: 30_000 });
      if (r.code !== 0) throw new Error(`Could not create ${name}: ${r.out.slice(-300)}`);
    }
    return subnet.replace(/\.0\/24$/, ".1");
  }

  /** A /24 in 10.213.0.0/16 that no Docker network uses yet. */
  private async freeSubnet(): Promise<string | null> {
    const ids = (await exec(this.docker, ["network", "ls", "-q"], { timeout: 20_000 })).out.split("\n").filter(Boolean);
    const used = ids.length ? (await exec(this.docker, ["network", "inspect", "-f", "{{range .IPAM.Config}}{{.Subnet}} {{end}}", ...ids], { timeout: 30_000 })).out : "";
    // so are the subnets other hosted projects were given, running or not
    const mine = this.list().map((x) => this.subnetOf(x.id) ?? "").join(" ");
    for (let n = 0; n < 256; n++) {
      const subnet = `10.213.${n}.0/24`;
      if (!used.includes(`10.213.${n}.`) && !mine.includes(subnet)) return subnet;
    }
    return null;
  }

  /** The entry service's address on the project's internal network, if it is running. */
  private async composeState(s: HostedService): Promise<ServiceState> {
    const ps = await this.compose(s, ["ps", "-q", s.manifest.expose.service ?? ""], {}, 30_000);
    const container = ps.out.trim().split("\n")[0];
    if (ps.code !== 0 || !container) return { running: false };
    const r = await exec(this.docker, ["inspect", "-f", "{{.State.Running}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", container], { timeout: 20_000 });
    const [running, ip] = r.out.trim().split(/\s+/);
    return { running: running === "true", container, ...(running === "true" && ip && s.manifest.expose.port ? { address: `http://${ip}:${s.manifest.expose.port}` } : {}) };
  }

  // ---- run -------------------------------------------------------------------------------
  private image(s: HostedService): string {
    const v = s.versions.find((x) => x.n === s.current);
    if (!v?.image || !v.build_ok) throw new Error(`${s.name} is not built yet (version ${s.current}): build it first`);
    return v.image;
  }
  private containerName(id: string) {
    return `mas-svc-${id.replace(/_/g, "-")}`;
  }
  private async ensureNetwork(name: string, internal: boolean) {
    const r = await exec(this.docker, ["network", "inspect", name], { timeout: 20_000 });
    if (r.code !== 0) await exec(this.docker, ["network", "create", ...(internal ? ["--internal"] : []), name], { timeout: 30_000 });
  }

  /** The environment the service starts with: plain values, and secrets read now (never stored with the service). */
  private envFor(s: HostedService): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.manifest.env ?? {})) {
      if (typeof v === "string") out[k] = v;
      else {
        const val = this.secrets.get(v.secret);
        if (!val) throw new Error(`${s.name} needs the secret ${v.secret} (Settings → API keys)`);
        out[k] = val;
      }
    }
    return out;
  }

  /**
   * For a service with egress hosts: the internal network, and proxy settings with
   * credentials of its own, so it reaches its declared hosts and nothing else.
   */
  private async proxyEnv(s: HostedService): Promise<Record<string, string>> {
    const hosts = s.manifest.egress ?? [];
    return hosts.length ? (await this.egressGrant(s.id, hosts)).env : {};
  }

  /**
   * Egress for anything on the internal network (a hosted service, a sandbox box): proxy settings with
   * credentials of its own, so it reaches the declared hosts and nothing else. A new grant for the same
   * grantee replaces the old one.
   */
  readonly egressGrant = async (grantee: string, hosts: string[], onAccess?: (a: EgressAccess) => void): Promise<{ network: string; env: Record<string, string> }> => {
    await this.ensureNetwork(INTERNAL_NET, true);
    const gw = (await exec(this.docker, ["network", "inspect", INTERNAL_NET, "-f", "{{range .IPAM.Config}}{{.Gateway}}{{end}}"], { timeout: 20_000 })).out.trim();
    if (!gw) throw new Error("The internal network has no gateway address for the egress proxy");
    const at = await this.egress.listen(gw);
    const { user, token } = this.egress.grant(grantee, hosts, onAccess);
    const url = `http://${user}:${token}@${at.host}:${at.port}`;
    return { network: INTERNAL_NET, env: { HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url, NO_PROXY: "", no_proxy: "" } };
  };

  /** docker run flags shared by both ways of running: limits, no privileges, the network, the environment by name. */
  private runFlags(s: HostedService, env: Record<string, string>, network: string | null): string[] {
    return [
      ...(network ? ["--network", network] : ["--network", "none"]),
      "--memory", s.manifest.memory ?? "512m",
      "--cpus", String(s.manifest.cpus ?? 1),
      "--pids-limit", "256",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--security-opt", `seccomp=${SECCOMP_PROFILE}`,
      // values are passed through the client's environment, so secrets never appear on a command line
      ...Object.keys(env).flatMap((k) => ["-e", k]),
      "--label", `mas.service=${s.id}`,
    ];
  }

  /** The internal network's gateway: where this server listens for the containers on it (MCP for agents, the egress proxy). */
  async gateway(): Promise<string | null> {
    await this.ensureNetwork(INTERNAL_NET, true);
    const gw = (await exec(this.docker, ["network", "inspect", INTERNAL_NET, "-f", "{{range .IPAM.Config}}{{.Gateway}}{{end}}"], { timeout: 20_000 })).out.trim();
    return /^\d+\.\d+\.\d+\.\d+$/.test(gw) ? gw : null;
  }

  /**
   * For agent-stdio: the command that runs the agent program for one turn, in a fresh
   * container on the internal network, so it can reach the platform's MCP for agents
   * (at the gateway) and, through the proxy, only the hosts it declares.
   */
  async agentCommand(id: string): Promise<{ command: string; env: Record<string, string> }> {
    const s = this.must(id);
    if (s.manifest.expose.kind !== "agent-stdio") throw new Error(`${s.name} exposes ${s.manifest.expose.kind}, not an agent program (agent-stdio)`);
    const env = { ...this.envFor(s), ...(await this.proxyEnv(s)) };
    const q = (a: string) => `'${a.replace(/'/g, "'\\''")}'`;
    // the platform passes MAS_MCP_URL / MAS_MCP_TOKEN for the turn; they go in by name, like the rest
    const args = ["run", "-i", "--rm", ...this.runFlags(s, { ...env, MAS_MCP_URL: "", MAS_MCP_TOKEN: "" }, INTERNAL_NET), this.image(s)];
    return { command: [this.docker, ...args].map(q).join(" "), env };
  }

  /** For mcp-stdio: the command (and environment) that starts a fresh container speaking MCP on stdio. */
  async stdioCommand(id: string): Promise<{ command: string; env: Record<string, string> }> {
    const s = this.must(id);
    if (s.manifest.expose.kind !== "mcp-stdio") throw new Error(`${s.name} exposes ${s.manifest.expose.kind}, not MCP on stdio`);
    const proxy = await this.proxyEnv(s);
    const env = { ...this.envFor(s), ...proxy };
    const q = (a: string) => `'${a.replace(/'/g, "'\\''")}'`;
    const args = ["run", "-i", "--rm", ...this.runFlags(s, env, Object.keys(proxy).length ? INTERNAL_NET : null), this.image(s)];
    return { command: [this.docker, ...args].map(q).join(" "), env };
  }

  async state(id: string): Promise<ServiceState> {
    const svc = this.get(id);
    if (svc && svc.versions.find((x) => x.n === svc.current)?.image?.startsWith("compose:")) return this.composeState(svc);
    const name = this.containerName(id);
    const r = await exec(this.docker, ["inspect", "-f", "{{.State.Running}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", name], { timeout: 20_000 });
    if (r.code !== 0) return { running: false };
    const [running, ip] = r.out.trim().split(/\s+/);
    const s = this.get(id);
    return { running: running === "true", container: name, ...(running === "true" && ip && s?.manifest.expose.port ? { address: `http://${ip}:${s.manifest.expose.port}` } : {}) };
  }

  /** For mcp-http and http: start the long-running container (if it is not running) and wait until it answers. */
  async start(id: string): Promise<ServiceState> {
    const s = this.must(id);
    if (s.manifest.expose.kind === "mcp-stdio" || s.manifest.expose.kind === "agent-stdio") throw new Error(`${s.name} runs per connection or per turn: nothing to keep running`);
    const now = await this.state(id);
    if (now.running && now.address) return now;
    if (this.isCompose(s)) {
      this.image(s);
      // secrets fill ${NAME} in the compose file through the environment of docker compose, never written down;
      // so does the proxy URL with this project's credentials, when it declares egress hosts
      const gateway = await this.projectNetwork(s);
      const env = this.envFor(s);
      const hosts = s.manifest.egress ?? [];
      if (hosts.length) {
        const at = await this.egress.listen(gateway);
        const { user, token } = this.egress.grant(s.id, hosts);
        env.MAS_EGRESS_PROXY = `http://${user}:${token}@${at.host}:${at.port}`;
      }
      const up = await this.compose(s, ["up", "-d"], env);
      if (up.code !== 0) throw new Error(`Could not start ${s.name}: ${up.out.slice(-400)}`);
      this.touch(id);
      for (let i = 0; i < 90; i++) {
        const st = await this.composeState(s);
        if (st.address && (await this.answers(st.address, s.manifest))) return st;
        await new Promise((res) => setTimeout(res, 1000));
      }
      throw new Error(`${s.name}: service ${s.manifest.expose.service} did not answer within 90 s on port ${s.manifest.expose.port}`);
    }
    const env = { ...this.envFor(s), ...(await this.proxyEnv(s)) };
    const network = INTERNAL_NET;
    await this.ensureNetwork(network, true);
    const name = this.containerName(id);
    await exec(this.docker, ["rm", "-f", name], { timeout: 30_000 });
    const r = await exec(this.docker, ["run", "-d", "--name", name, "--restart", "no", ...this.runFlags(s, env, network), this.image(s)], { timeout: 120_000, env });
    if (r.code !== 0) throw new Error(`Could not start ${s.name}: ${r.out.slice(-300)}`);
    this.touch(id);
    for (let i = 0; i < 60; i++) {
      const st = await this.state(id);
      if (!st.running) throw new Error(`${s.name} stopped right after starting: ${(await this.logs(id)).slice(-500)}`);
      if (st.address && (await this.answers(st.address, s.manifest))) return st;
      await new Promise((res) => setTimeout(res, 1000));
    }
    throw new Error(`${s.name} did not answer within a minute on port ${s.manifest.expose.port}`);
  }

  private async answers(address: string, m: HostManifest): Promise<boolean> {
    try {
      const res = await fetch(address + (m.expose.health ?? m.expose.path ?? "/"), { signal: AbortSignal.timeout(3000) });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async stop(id: string) {
    this.lastUsed.delete(id);
    const s = this.get(id);
    // a compose project keeps its volumes when stopped (its data); delete removes them
    if (s && s.versions.find((x) => x.n === s.current)?.image?.startsWith("compose:")) await this.compose(s, ["down"], {}, 120_000);
    else await exec(this.docker, ["rm", "-f", this.containerName(id)], { timeout: 30_000 });
  }

  async logs(id: string): Promise<string> {
    const s = this.get(id);
    if (s && s.versions.find((x) => x.n === s.current)?.image?.startsWith("compose:")) {
      const r = await this.compose(s, ["logs", "--tail", "100", "--no-color"], {}, 30_000);
      return r.code === 0 ? r.out : "(not running)";
    }
    const r = await exec(this.docker, ["logs", "--tail", "200", this.containerName(id)], { timeout: 20_000 });
    return r.code === 0 ? r.out : "(not running)";
  }

  /** Where an endpoint is reached, now: a URL with headers, or a command speaking MCP on stdio. */
  async resolve(e: Endpoint): Promise<{ url: string; headers: Record<string, string> } | { command: string; env: Record<string, string> }> {
    if ("remote" in e) {
      const headers = { ...(e.remote.headers ?? {}) };
      if (e.remote.bearer_env) {
        const key = this.secrets.get(e.remote.bearer_env);
        if (!key) throw new Error(`The connection needs the secret ${e.remote.bearer_env} (Settings → API keys)`);
        headers.authorization = `Bearer ${key}`;
      }
      return { url: e.remote.url, headers };
    }
    // by id, or by name when no service has that id: a template can name "town" without knowing this server's id
    const want = e.hosted.service.trim().toLowerCase();
    const byId = /^svc_[a-z0-9_]+$/.test(e.hosted.service) ? this.get(e.hosted.service) : null;
    const s = byId ?? this.list().find((x) => x.name.toLowerCase() === want || x.manifest.name?.toLowerCase() === want);
    if (!s) throw new HttpError(404, `No hosted service ${e.hosted.service} (by id or name): host it first`);
    if (s.manifest.expose.kind === "mcp-stdio") return await this.stdioCommand(s.id);
    const st = await this.start(s.id);
    this.touch(s.id);
    return { url: st.address! + (e.hosted.path ?? s.manifest.expose.path ?? ""), headers: {} };
  }
}
