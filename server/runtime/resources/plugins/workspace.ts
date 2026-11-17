// Workspace: a folder of files agents read and write. One folder per plugin
// per system (scope group / agent get their own subfolder). Paths are
// confined to the folder.
import fs from "node:fs";
import path from "node:path";
import type { PluginData, SysEdge, SysNode } from "@/model/types";
import type { RunCtx } from "../../context";
import { S, schema, type Resource, type RtTool } from "../types";
import { scopeKey } from "./common";

export function confine(root: string, rel: string): string {
  const f = path.resolve(root, String(rel ?? "").replace(/^\/+/, ""));
  if (f !== root && !f.startsWith(root + path.sep)) throw new Error(`path escapes the workspace: ${rel}`);
  return f;
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
    const base = this.rc.store.stateDir(this.rc.doc.id, this.node.id, "files");
    const dir = scope === "agent" || scope === "group" ? path.join(base, scopeKey(this.rc, this.node, agent).replace(/[^\w.-]/g, "_")) : base;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
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

  async beforeTurn(turn: { node: string }) {
    const files = listFiles(this.root(turn.node));
    return `Files in ${this.node.data.name}:\n${files.length ? files.slice(0, 100).map((f) => `- ${f}`).join("\n") : "(empty)"}`;
  }
}
