// Build a live plugin from its component. Built-in presets have their own
// implementation; any other backend is external. A hook the user has edited
// (it no longer matches the preset's default) replaces the built-in
// behaviour and runs with the plugin's helpers: search(query, k), list(dir),
// tasks(), self.
import type { PluginData, SysEdge, SysNode } from "@/model/types";
import { PLUGIN_PRESETS } from "@/model/plugins";
import type { RunCtx } from "../../context";
import type { Resource, RtTool, TurnInfo } from "../types";
import { BoardPlugin } from "./board";
import { runHook } from "./common";
import { ExternalPlugin } from "./external";
import { KnowledgePlugin } from "./knowledge";
import { MemoryPlugin } from "./memory";
import { WorkspacePlugin, listFiles } from "./workspace";

type Builtin = MemoryPlugin | KnowledgePlugin | WorkspacePlugin | BoardPlugin;

function builtinFor(rc: RunCtx, node: SysNode<PluginData>): Builtin | null {
  if (node.data.spec.backend.kind !== "builtin") return null;
  switch (node.data.preset) {
    case "memory":
      return new MemoryPlugin(rc, node);
    case "knowledge":
      return new KnowledgePlugin(rc, node);
    case "workspace":
      return new WorkspacePlugin(rc, node);
    case "board":
      return new BoardPlugin(rc, node);
    default:
      return null;
  }
}

class PluginResource implements Resource {
  private inner: Resource;
  private started = new Set<string>();
  constructor(
    private rc: RunCtx,
    private node: SysNode<PluginData>,
  ) {
    this.inner = builtinFor(rc, node) ?? new ExternalPlugin(rc, node);
  }
  get id() {
    return this.node.id;
  }

  private edited(hook: "before_turn" | "after_turn" | "on_start"): boolean {
    const fn = this.node.data.spec.hooks[hook];
    if (!fn) return false;
    const preset = PLUGIN_PRESETS.find((p) => p.id === this.node.data.preset)?.spec().hooks[hook];
    const isBuiltin = this.inner instanceof MemoryPlugin || this.inner instanceof KnowledgePlugin || this.inner instanceof WorkspacePlugin || this.inner instanceof BoardPlugin;
    return !isBuiltin || !preset || preset.code !== fn.code || preset.lang !== fn.lang;
  }

  private helpers(node: string, edge?: SysEdge): Record<string, unknown> {
    const inner = this.inner;
    return {
      search: async (q: unknown, k?: unknown) => {
        if (inner instanceof MemoryPlugin || inner instanceof KnowledgePlugin) {
          const r = await inner.search(node, String(q ?? ""), edge ? { ...edge, binding: { ...(edge.binding ?? { mode: "tool" }), read: { ...(edge.binding?.read ?? {}), top_k: typeof k === "number" ? k : edge.binding?.read?.top_k } } } : undefined);
          return "hits" in r ? r.hits : r.text.split("\n").filter(Boolean).map((text) => ({ text }));
        }
        return [];
      },
      list: (dir?: unknown) => (inner instanceof WorkspacePlugin ? listFiles(inner.root(node)).filter((f) => !dir || dir === "/" || f.startsWith(String(dir).replace(/^\//, ""))) : []),
      tasks: () => (inner instanceof BoardPlugin ? inner.list(node).filter((t) => t.state !== "done") : []),
    };
  }

  async tools(edge: SysEdge): Promise<RtTool[]> {
    return this.inner.tools(edge);
  }

  async beforeTurn(turn: { node: string; input: string; edge: SysEdge }) {
    if (!this.started.has(turn.node) && this.node.data.spec.hooks.on_start) {
      this.started.add(turn.node);
      await runHook(this.rc, this.node, "on_start", turn.input, turn.node, this.helpers(turn.node, turn.edge));
    }
    if (this.edited("before_turn")) return runHook(this.rc, this.node, "before_turn", { text: turn.input, role: "user" }, turn.node, this.helpers(turn.node, turn.edge));
    return this.inner.beforeTurn ? this.inner.beforeTurn(turn) : null;
  }

  async afterTurn(turn: TurnInfo): Promise<void | { wrote: boolean }> {
    if (this.edited("after_turn") && !(this.inner instanceof MemoryPlugin)) {
      await runHook(this.rc, this.node, "after_turn", { input: turn.input, output: turn.output, messages: turn.messages }, turn.node, this.helpers(turn.node, turn.edge));
      return;
    }
    if (this.inner instanceof MemoryPlugin && this.edited("after_turn") && !turn.binding.write?.extract) {
      // an edited after_turn on memory is its extraction step
      return this.inner.afterTurn({ ...turn, binding: { ...turn.binding, write: { when: "after_turn", extract: this.node.data.spec.hooks.after_turn } } });
    }
    return this.inner.afterTurn?.(turn);
  }

  async observe(node: string, text: string) {
    if (this.inner instanceof MemoryPlugin) await this.inner.write(node, text);
  }

  async close() {
    await this.inner.close?.();
  }
}

export const createPlugin = (rc: RunCtx, node: SysNode<PluginData>): Resource => new PluginResource(rc, node);
