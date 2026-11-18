// Where an agent's commands run. A sandbox env asks a backend for a machine
// (a box): its work folder mounted at /work, no network or only the declared
// hosts through the egress proxy, limits, and no privileges. Docker is the
// backend today; a Firecracker microVM backend (a real kernel per box, as in
// DecodingTrust's dt_arena/vm) fits the same interface once the server's user
// may open /dev/kvm.
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BoxSpec {
  /** a stable name: the same name finds the same box (kept lifecycles) */
  name: string;
  image: string;
  /** host folder mounted read-write at /work */
  workDir: string;
  /** hosts it may reach through the egress proxy; empty = no network at all */
  egress: string[];
  memory?: string;
  cpus?: number;
  pids?: number;
  labels?: Record<string, string>;
  /** HOME inside the box (default /tmp, which does not outlive it) */
  home?: string;
}

export interface Box {
  name: string;
  /** what isolates it, for the run's log and the canvas */
  isolation: string;
}

export interface ExecResult {
  code: number;
  out: string;
}

export interface SandboxBackend {
  readonly kind: "docker" | "firecracker";
  /** Whether this machine can run boxes (Docker reachable, /dev/kvm usable…), and why not. */
  available(): Promise<{ ok: boolean; why?: string }>;
  /** Start the box, or find it running with the same isolation; replaces one started with weaker settings. */
  start(spec: BoxSpec): Promise<Box>;
  exec(box: Box, command: string, timeoutMs: number): Promise<ExecResult>;
  stop(box: Box): Promise<void>;
}

/** Egress for a box: the network it joins and the proxy settings it starts with (its own credentials). */
export type EgressGrant = (grantee: string, hosts: string[]) => Promise<{ network: string; env: Record<string, string> }>;

export function run(cmd: string, args: string[], opts: { timeout?: number; env?: Record<string, string> } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout ?? 120_000, maxBuffer: 8 * 1024 * 1024, env: opts.env ? { ...process.env, ...opts.env } : process.env }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === "number" ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, out: `${stdout}${stderr ? (stdout ? "\n" : "") + stderr : ""}`.trim() });
    });
  });
}

/** The seccomp profile every box gets (this host's Docker default allows every system call). */
export const SECCOMP_PROFILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "seccomp.json");

/** The internal network (no route out): boxes on it reach this server's gateways and nothing else. */
export const INTERNAL_NETWORK = "mas-hosted";

/** Bumped when the flags below change: a kept box started with older settings is replaced. */
export const HARDENING = "2";

/**
 * docker run flags for a box: the server's own user (not root), no capabilities, no privilege gain, the
 * seccomp profile, a read-only root with a private /tmp, limits, and the network (none, or the internal one).
 * Proxy settings go in by name (-e NAME), so the credentials never appear on a command line.
 */
export function hardenedFlags(spec: BoxSpec, network: string | null, envNames: string[], uid = process.getuid?.() ?? 10001, gid = process.getgid?.() ?? 10001): string[] {
  return [
    "--user", `${uid}:${gid}`,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--security-opt", `seccomp=${SECCOMP_PROFILE}`,
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m",
    "-e", `HOME=${spec.home ?? "/tmp"}`,
    "--network", network ?? "none",
    "--memory", spec.memory ?? "2g",
    "--cpus", String(spec.cpus ?? 2),
    "--pids-limit", String(spec.pids ?? 512),
    ...envNames.flatMap((k) => ["-e", k]),
    "--label", `mas.hardening=${HARDENING}`,
    ...Object.entries(spec.labels ?? {}).flatMap(([k, v]) => ["--label", `${k}=${v}`]),
  ];
}

export class DockerBackend implements SandboxBackend {
  readonly kind = "docker" as const;
  constructor(
    private docker: string,
    /** the egress proxy, when this server hosts it; without it a box with egress hosts is refused */
    private egress?: EgressGrant,
  ) {}

  async available() {
    const r = await run(this.docker, ["version", "--format", "{{.Server.Version}}"], { timeout: 10_000 });
    return r.code === 0 ? { ok: true } : { ok: false, why: `Docker is not reachable: ${r.out.slice(-200)}` };
  }

  async start(spec: BoxSpec): Promise<Box> {
    const isolation = `docker · ${spec.egress.length ? `egress to ${spec.egress.join(", ")} only, through the proxy` : "no network"} · not root, no capabilities, seccomp, read-only root`;
    const seen = await run(this.docker, ["inspect", "-f", `{{.State.Running}} {{index .Config.Labels "mas.hardening"}}`, spec.name], { timeout: 10_000 });
    if (seen.code === 0) {
      const [running, hardening] = seen.out.trim().split(" ");
      // a box kept from before is used only if it runs with today's isolation; its files live on the host
      if (running === "true" && hardening === HARDENING && !spec.egress.length) return { name: spec.name, isolation };
      await run(this.docker, ["rm", "-f", spec.name], { timeout: 30_000 });
    }
    let network: string | null = null;
    let env: Record<string, string> = {};
    if (spec.egress.length) {
      if (!this.egress) throw new Error("This box declares egress hosts, but this server has no egress proxy (hosting is off)");
      ({ network, env } = await this.egress(spec.name, spec.egress));
    }
    const args = ["run", "-d", "--name", spec.name, ...hardenedFlags(spec, network, Object.keys(env)), "-v", `${spec.workDir}:/work`, "-w", "/work", spec.image, "sleep", "infinity"];
    const r = await run(this.docker, args, { timeout: 600_000, env });
    if (r.code !== 0) throw new Error(`Could not start the sandbox: ${r.out.slice(-400)}`);
    return { name: spec.name, isolation };
  }

  exec(box: Box, command: string, timeoutMs: number) {
    return run(this.docker, ["exec", "-w", "/work", box.name, "sh", "-lc", command], { timeout: timeoutMs });
  }

  async stop(box: Box) {
    await run(this.docker, ["rm", "-f", box.name], { timeout: 30_000 });
  }
}
