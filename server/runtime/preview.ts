// Trying an env's tools without building a run: a preview session holds one
// live copy of the env, so a call can follow another (write a file, then run
// it). The copy is throwaway: a sandbox gets a box and a folder of its own
// (never the kept /work or a workspace's), a database a copy of its file. An
// imported (MCP) env is called for real, so a tool that is not read-only
// runs only when the caller confirms. Sessions end on reset or after ten idle
// minutes, and their box and files go with them.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EnvData, PluginData, SysEdge, SysNode, SystemDoc } from "@/model/types";
import type { HostedServices } from "../hosting/services";
import type { Config } from "../config";
import type { Store } from "../store/files";
import type { Secrets } from "../store/secrets";
import type { RunCtx } from "./context";
import { run } from "./isolation";
import { Models } from "./models";
import { DatabaseEnv } from "./resources/envs/database";
import { McpEnv } from "./resources/envs/mcpEnv";
import { RoomEnv } from "./resources/envs/room";
import { SandboxEnv } from "./resources/envs/sandbox";
import { createPlugin } from "./resources/plugins";
import type { Resource, RtTool } from "./resources/types";

const IDLE_MS = 10 * 60_000;

interface Session {
  id: string;
  systemId: string;
  envId: string;
  resource: Resource;
  /** what it is: "a throwaway copy" or "the real service" */
  copy: boolean;
  log: { at: string; level: string; text: string }[];
  usd: number;
  touched: number;
  dir: string;
  ctrl: AbortController;
}

export interface PreviewTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  effect: string;
  /** a call changes something real (an imported env's write tools): it runs only when confirmed */
  needs_confirm: boolean;
}

export class EnvPreviews {
  private sessions = new Map<string, Session>();
  private timer: NodeJS.Timeout;

  constructor(
    private store: Store,
    private secrets: Secrets,
    private config: Config,
    private dataDir: string,
    private hosted?: HostedServices,
  ) {
    this.timer = setInterval(() => void this.reap(), 60_000);
    this.timer.unref();
    void this.sweep();
  }

  /** Previews do not outlive the server: what earlier ones left (folders, a box) is removed at start. */
  private async sweep() {
    fs.rmSync(path.join(this.dataDir, "previews"), { recursive: true, force: true });
    const state = path.join(this.dataDir, "state");
    if (fs.existsSync(state)) for (const d of fs.readdirSync(state)) if (/__preview_[0-9a-f]+$/.test(d)) fs.rmSync(path.join(state, d), { recursive: true, force: true });
    const ps = await run(this.config.docker, ["ps", "-a", "--filter", "label=mas.run", "--format", '{{.Names}} {{.Label "mas.run"}}'], { timeout: 20_000 });
    if (ps.code !== 0) return;
    const boxes = ps.out.split("\n").filter((l) => / preview_[0-9a-f]+$/.test(l.trim())).map((l) => l.split(" ")[0]);
    if (boxes.length) await run(this.config.docker, ["rm", "-f", ...boxes], { timeout: 60_000 });
  }

  private edge(envId: string): SysEdge {
    return { id: `preview-${envId}`, source: "preview", target: envId, kind: "access", access: "read_write" } as SysEdge;
  }

  /** Start a preview of an env or a plugin of a stored system. */
  open(doc: SystemDoc, envId: string): Session {
    const found = doc.nodes.find((n) => n.id === envId && (n.data.kind === "env" || n.data.kind === "plugin"));
    if (!found) throw new Error("No such env or plugin in this system");
    const id = crypto.randomBytes(6).toString("hex");
    const dir = path.join(this.dataDir, "previews", id);
    fs.mkdirSync(dir, { recursive: true });
    if (found.data.kind === "plugin") return this.openPlugin(doc, found as SysNode<PluginData>, id, dir);
    const node = found as SysNode<EnvData>;
    const e = node.data;
    let data: EnvData = { ...e };
    let copy = true;
    if (e.env_kind === "sandbox" && !e.manifest) data = { ...e, lifecycle: "per_run", share: "shared" };
    if (e.env_kind === "database" && !e.manifest) {
      const img = e.image ?? "";
      const src = img.startsWith("sqlite:") ? path.resolve(img.slice(7)) : path.join(this.dataDir, "state", doc.id, envId, "db.sqlite");
      const dst = path.join(dir, "db.sqlite");
      if (fs.existsSync(src)) fs.copyFileSync(src, dst);
      data = { ...e, image: `sqlite:${dst}` };
    }
    if (e.manifest?.exposes.mcp) copy = false;
    // a preview system of its own: its folders are not the real system's, and no workspace shares /work with it
    const pnode = { ...node, data } as SysNode<EnvData>;
    const pdoc: SystemDoc = {
      ...doc,
      id: `${doc.id}__preview_${id}`,
      nodes: doc.nodes.filter((n) => !(n.data.kind === "plugin" && n.data.preset === "workspace")).map((n) => (n.id === envId ? pnode : n)),
    };
    const { session, rc } = this.context(doc, pdoc, envId, id, dir, copy);
    session.resource =
      e.manifest?.exposes.mcp ? new McpEnv(rc, pnode) : e.env_kind === "sandbox" ? new SandboxEnv(rc, pnode) : e.env_kind === "database" ? new DatabaseEnv(rc, pnode) : e.env_kind === "room" ? new RoomEnv(rc, pnode) : (null as unknown as Resource);
    if (!session.resource) throw new Error(`A ${e.env_kind} env has no tools to try`);
    this.sessions.set(id, session);
    return session;
  }

  /**
   * A plugin on a copy of its state: its own folder and the system's shared folders (workspaces) are copied
   * into the preview's, so a memory written or a file changed in the preview stays there. A plugin with an
   * external backend (MCP, HTTP) is the real service.
   */
  private openPlugin(doc: SystemDoc, node: SysNode<PluginData>, id: string, dir: string): Session {
    const pdoc: SystemDoc = { ...doc, id: `${doc.id}__preview_${id}` };
    const from = path.join(this.dataDir, "state", doc.id);
    const to = path.join(this.dataDir, "state", pdoc.id);
    for (const part of [node.id, "fs"]) if (fs.existsSync(path.join(from, part))) fs.cpSync(path.join(from, part), path.join(to, part), { recursive: true });
    const { session, rc } = this.context(doc, pdoc, node.id, id, dir, node.data.spec.backend.kind === "builtin");
    session.resource = createPlugin(rc, { ...node });
    this.sessions.set(id, session);
    return session;
  }

  private context(doc: SystemDoc, pdoc: SystemDoc, envId: string, id: string, dir: string, copy: boolean): { session: Session; rc: RunCtx } {
    const ctrl = new AbortController();
    const session = { id, systemId: doc.id, envId, copy, log: [], usd: 0, touched: Date.now(), dir, ctrl } as unknown as Session;
    const rc: RunCtx = {
      runId: `preview_${id}`,
      doc: pdoc,
      byId: new Map(pdoc.nodes.map((n) => [n.id, n])),
      models: new Models(pdoc.models, this.secrets, false),
      store: this.store,
      secrets: this.secrets,
      config: this.config,
      signal: ctrl.signal,
      hosted: this.hosted,
      vars: {},
      stop: () => ctrl.abort(),
      emit: (ev) => {
        if (ev.type === "log") session.log.push({ at: new Date().toISOString(), level: ev.level, text: ev.text });
      },
      usage: (_node, u) => {
        session.usd += u.usd;
      },
      tick: () => undefined,
      ask: async () => {
        throw new Error("A preview cannot ask a person");
      },
    };
    return { session, rc };
  }

  get(id: string, systemId: string, envId: string): Session {
    const s = this.sessions.get(id);
    if (!s || s.systemId !== systemId || s.envId !== envId) throw new Error("That preview has ended: start a new one");
    s.touched = Date.now();
    return s;
  }

  async tools(s: Session): Promise<PreviewTool[]> {
    const tools = await s.resource.tools(this.edge(s.envId));
    return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, effect: t.effect, needs_confirm: !s.copy && !isReadOnly(t) }));
  }

  async call(s: Session, name: string, args: Record<string, unknown>, confirm: boolean): Promise<{ result: string; error: boolean; seconds: number }> {
    const tool = (await s.resource.tools(this.edge(s.envId))).find((t) => t.name === name);
    if (!tool) throw new Error(`No tool ${name} here`);
    if (!s.copy && !isReadOnly(tool) && !confirm) throw new Error(`${name} changes the real ${s.envId} (it is not a copy): confirm to run it`);
    const t0 = Date.now();
    try {
      const result = await tool.run(args ?? {}, { node: "preview" });
      return { result: result.length > 50_000 ? `${result.slice(0, 50_000)}\n…` : result, error: false, seconds: (Date.now() - t0) / 1000 };
    } catch (e) {
      return { result: (e as Error).message, error: true, seconds: (Date.now() - t0) / 1000 };
    }
  }

  async close(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    s.ctrl.abort();
    await s.resource.close?.().catch(() => undefined);
    fs.rmSync(s.dir, { recursive: true, force: true });
    // the sandbox's folder for this preview lives under its own preview system
    fs.rmSync(path.join(this.dataDir, "state", `${s.systemId}__preview_${s.id}`), { recursive: true, force: true });
  }

  private async reap() {
    for (const s of [...this.sessions.values()]) if (Date.now() - s.touched > IDLE_MS) await this.close(s.id);
  }

  async closeAll() {
    clearInterval(this.timer);
    for (const id of [...this.sessions.keys()]) await this.close(id);
  }
}

const isReadOnly = (t: RtTool) => t.effect === "read" || t.effect === "pure";
