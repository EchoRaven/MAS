// Workspace: a folder of files agents read and write. One folder per plugin
// per system (scope group / agent get their own subfolder). Paths are
// confined to the folder.
import fs from "node:fs";
import path from "node:path";
import type { PluginData, SysEdge, SysNode } from "@/model/types";
import type { RunCtx } from "../../context";
import { S, schema, type Resource, type RtTool } from "../types";
import { scopeKey } from "./common";

/**
 * The real location of a path inside the workspace, or an error when it would
 * leave it: by "..", or through a symbolic link. Links matter because a
 * sandbox shares the /work folder and can create them: a relative link that
 * points nowhere in the container can point at the server's own files here.
 */
export function confine(root: string, rel: string): string {
  const realRoot = fs.realpathSync(root);
  const inside = (p: string) => p === realRoot || p.startsWith(realRoot + path.sep);
  const escape = () => new Error(`path escapes the workspace: ${rel}`);
  const f = path.resolve(realRoot, String(rel ?? "").replace(/^\/+/, ""));
  if (!inside(f)) throw escape();
  // a link at the end: where it points must be inside, even if that does not exist yet (writing would create it)
  let link: fs.Stats | null = null;
  try {
    link = fs.lstatSync(f);
  } catch {
    /* does not exist yet */
  }
  if (link?.isSymbolicLink()) {
    const target = path.resolve(path.dirname(f), fs.readlinkSync(f));
    if (!inside(fs.existsSync(target) ? fs.realpathSync(target) : target)) throw escape();
  }
  // the real location of the path, or of the nearest folder above it that exists, must be inside
  let p = f;
  while (!fs.existsSync(p) && p !== realRoot) p = path.dirname(p);
  const real = fs.realpathSync(p);
  if (!inside(real)) throw escape();
  return p === f ? real : path.join(real, path.relative(p, f));
}

export function listFiles(root: string, dir = root, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length > 500) break;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(root, f, out);
    else out.push(path.relative(root, f));
  }
  return out;
}

/**
 * Workspaces that name the same source share one folder (copies of a plugin
 * in several groups see the same files), and the source "/work" is the folder
 * a sandbox env mounts at /work.
 */
export function sharedFolder(rc: RunCtx, source?: string): string | null {
  if (!source) return null;
  const slug = source.replace(/^\/+|\/+$/g, "").replace(/[^\w.-]+/g, "_") || "root";
  return rc.store.stateDir(rc.doc.id, "fs", slug);
}

const workPlugin = (rc: RunCtx) => rc.doc.nodes.find((n) => n.data.kind === "plugin" && n.data.preset === "workspace" && n.data.spec.sources?.[0]?.replace(/\/+$/, "") === "/work") as SysNode<PluginData> | undefined;
export const hasWorkFolder = (rc: RunCtx) => !!workPlugin(rc);

/** The folder a workspace with source /work shares with the sandbox: one per run when the workspace's scope is run. */
export function workFolder(rc: RunCtx): string | null {
  const p = workPlugin(rc);
  if (!p) return null;
  const base = sharedFolder(rc, "/work")!;
  return p.data.spec.scope === "run" ? path.join(base, `run-${rc.runId}`.replace(/[^\w.-]/g, "_")) : base;
}

export class WorkspacePlugin implements Resource {
  constructor(
    private rc: RunCtx,
    private node: SysNode<PluginData>,
  ) {}
  get id() {
    return this.node.id;
  }
  root(agent: string): string {
    const scope = this.node.data.spec.scope;
    const base = sharedFolder(this.rc, this.node.data.spec.sources?.[0]) ?? this.rc.store.stateDir(this.rc.doc.id, this.node.id, "files");
    const dir = scope === "agent" || scope === "group" || scope === "run" ? path.join(base, scopeKey(this.rc, this.node, agent).replace(/[^\w.-]/g, "_")) : base;
    fs.mkdirSync(dir, { recursive: true });
    // the real path, so the files listed and the paths checked agree
    return fs.realpathSync(dir);
  }

  async tools(edge: SysEdge): Promise<RtTool[]> {
    const all: RtTool[] = [
      { name: "list_files", description: "List files in the workspace", input_schema: schema({ dir: S }, []), effect: "read", source: this.id, run: async (a, c) => listFiles(this.root(c.node), confine(this.root(c.node), String(a.dir ?? ""))).join("\n") || "(empty)" },
      { name: "read_file", description: "Read a file from the workspace", input_schema: schema({ path: S }), effect: "read", source: this.id, run: async (a, c) => {
        const f = confine(this.root(c.node), String(a.path));
        if (!fs.existsSync(f)) throw new Error(`no such file: ${a.path}`);
        const text = fs.readFileSync(f, "utf8");
        return text.length > 50_000 ? text.slice(0, 50_000) + "\n…(truncated)" : text;
      } },
      { name: "write_file", description: "Write (create or replace) a file in the workspace", input_schema: schema({ path: S, content: S }), effect: "write", source: this.id, run: async (a, c) => {
        const f = confine(this.root(c.node), String(a.path));
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, String(a.content ?? ""));
        return `Wrote ${a.path} (${String(a.content ?? "").length} chars)`;
      } },
    ];
    const declared = new Set(this.node.data.spec.tools.map((t) => t.name));
    return all.filter((t) => declared.has(t.name) && (edge.access !== "read" || t.effect === "read"));
  }

  /**
   * Put in front of an agent's turn (binding auto_inject or pinned): the files' names, or with read.contents the
   * files themselves (a scratchpad read whole, as Agents' Room gives every agent the full scratchpad, rather than
   * the files it thinks to open). The binding's budget clips the whole.
   */
  async beforeTurn(turn: { node: string; edge?: SysEdge }): Promise<string | null> {
    const root = this.root(turn.node);
    const files = listFiles(root).sort();
    if (!turn.edge?.binding?.read?.contents) return `Files in ${this.node.data.name}:\n${files.length ? files.slice(0, 100).map((f) => `- ${f}`).join("\n") : "(empty)"}`;
    if (!files.length) return null;
    const parts = files.map((f) => {
      const text = fs.readFileSync(path.join(root, f), "utf8");
      return `### ${f}\n${text.length > 20_000 ? text.slice(0, 20_000) + "\n…(truncated)" : text}`;
    });
    return `Files in ${this.node.data.name} so far:\n\n${parts.join("\n\n")}`;
  }
}
