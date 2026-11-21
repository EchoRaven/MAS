// One agent's access to its model and tools during a turn, with the agent's
// hooks around every model and tool call, approvals for irreversible tools,
// tool policies, and events.
import type { AgentData, AgentHook } from "@/model/types";
import type { RunCtx } from "../context";
import { nameOf } from "../context";
import { runFn } from "../functions";
import { testExpr } from "../functions/sandbox";
import { conditionHolds, policiesAt } from "@/model/policies";
import type { ChatMessage, ChatResponse, Part, ToolDef } from "../models";
import { textOf } from "../models";
import type { RtTool } from "../resources/types";
import { clip } from "../values";

export class AgentIO {
  constructor(
    readonly rc: RunCtx,
    readonly node: string,
    readonly agent: AgentData,
    readonly tools: RtTool[],
    readonly serverTools: ("web_search" | "web_fetch")[],
    /** extra ctx helpers for hooks (observe…) */
    readonly hookHelpers: Record<string, unknown> = {},
  ) {}

  /** f(event, ctx) -> event | null. null from a before_* hook blocks the step. */
  async hook<T>(name: AgentHook, event: T): Promise<T | null> {
    const fn = this.agent.hooks?.[name];
    if (!fn) return event;
    const ask_human = async (ev: unknown) => {
      const approver = this.rc.doc.nodes.find((n) => n.data.kind === "human" && n.data.approves);
      const a = await this.rc.ask({ node: approver?.id ?? "", from: this.node, kind: "approval", text: `${nameOf(this.rc, this.node)} (${name}):\n${clip(JSON.stringify(ev, null, 1), 1500)}` });
      return a.approved ? ev : null;
    };
    const agent = { id: this.node, name: this.agent.name, role: this.agent.role };
    const out = await runFn(fn, event, this.rc, { node: this.node, vars: { hook: name, agent }, named: { event }, helpers: { ask_human, ...this.hookHelpers } });
    this.rc.emit({ type: "transform", at: this.node, label: `hook · ${name}`, detail: out == null ? "blocked" : fn.lang });
    if (out === undefined) return event;
    return out as T | null;
  }

  toolDefs(): ToolDef[] {
    return this.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  }

  /** model calls this turn; a turn may make at most a few times max_steps (custom loops can loop forever) */
  private calls = 0;

  /** A model call with before_model / after_model hooks and usage accounting. */
  async model(req: { system: string; messages: ChatMessage[]; tools?: boolean; model?: string | null; temperature?: number | null; max_tokens?: number | null }): Promise<ChatResponse> {
    const cap = Math.max(10, (this.agent.harness.max_steps ?? 30) * 3);
    if (++this.calls > cap) throw new Error(`${this.agent.name} made more than ${cap} model calls in one turn (3 × max_steps); stopping it`);
    let call = { system: req.system, messages: req.messages };
    const before = await this.hook("before_model", call);
    if (before === null) return { content: [{ type: "text", text: "" }], stop: "end", usage: { input: 0, output: 0 } };
    // a hook may return only what it changes ({ system } say); the rest of the call stays
    if (before && typeof before === "object") call = { ...call, ...before };
    const { res, usage } = await this.rc.models.chat(req.model ?? this.agent.model, {
      system: call.system,
      messages: call.messages,
      tools: req.tools === false ? undefined : this.toolDefs(),
      server_tools: req.tools === false ? undefined : this.serverTools,
      temperature: req.temperature,
      max_tokens: req.max_tokens,
      signal: this.rc.signal,
    });
    this.rc.usage(this.node, usage);
    // a reply cut at the output limit: say so, or a tool call cut in half looks like the agent had nothing to say
    if (res.stop === "max_tokens") {
      const empty = !textOf(res.content).trim() && !res.content.some((p) => p.type === "tool_call");
      this.rc.emit({
        type: "log",
        node: this.node,
        level: empty ? "error" : "warn",
        text: `${this.agent.name}'s reply stopped at the output limit (${usage.tokens_out} tokens visible; a model that thinks first spends its thinking from the same allowance)${empty ? ", with nothing usable in it" : ""}. The limit is the component's max_tokens, the model's api.params.max_output, MAS_MAX_OUTPUT, or with none of those the provider's own maximum`,
      });
    }
    for (const p of res.content) {
      if (p.type === "raw" && (p.block as { type?: string }).type === "server_tool_use") {
        const b = p.block as { name: string; input: unknown };
        this.rc.emit({ type: "tool", node: this.node, tool: b.name, args: clip(JSON.stringify(b.input), 500), result: "(run by the provider)" });
      }
    }
    const after = await this.hook("after_model", { text: textOf(res.content), stop: res.stop });
    if (after && typeof after === "object" && typeof (after as { text?: unknown }).text === "string" && (after as { text: string }).text !== textOf(res.content)) {
      // a hook that rewrites the text replaces the reply's text parts
      return { ...res, content: [...res.content.filter((x) => x.type !== "text"), { type: "text", text: (after as { text: string }).text }] };
    }
    return res;
  }

  private async approve(t: RtTool, args: Record<string, unknown>): Promise<boolean> {
    for (const p of policiesAt(this.rc.doc, "tool")) {
      if (!conditionHolds(p, (x) => testExpr(x, { tool: t.name, args, effect: t.effect, agent: this.node }).ok)) continue;
      if (p.action === "block") throw new Error(`blocked by policy ${p.id}`);
      if (p.action === "require_approval") return this.ask(t, args, `policy ${p.id}`);
      if (p.action === "notify") this.rc.emit({ type: "log", node: this.node, level: "warn", text: `Policy ${p.id}: ${nameOf(this.rc, this.node)} calls ${t.name}` });
    }
    if (t.effect === "irreversible") return this.ask(t, args, "irreversible tool");
    return true;
  }

  private async ask(t: RtTool, args: Record<string, unknown>, why: string): Promise<boolean> {
    const approver = this.rc.doc.nodes.find((n) => n.data.kind === "human" && n.data.approves);
    this.rc.emit({ type: "status", node: this.node, status: "waiting" });
    const a = await this.rc.ask({ node: approver?.id ?? "", from: this.node, kind: "approval", text: `${nameOf(this.rc, this.node)} wants to call ${t.name} (${why}):\n${clip(JSON.stringify(args, null, 1), 1500)}` });
    this.rc.emit({ type: "status", node: this.node, status: "working" });
    return !!a.approved;
  }

  /** Run the tool calls of one model reply; results in the same order. */
  async runTools(calls: Extract<Part, { type: "tool_call" }>[]): Promise<Part[]> {
    return Promise.all(
      calls.map(async (c): Promise<Part> => {
        const t = this.tools.find((x) => x.name === c.name);
        let result: string;
        let error = false;
        try {
          if (!t) throw new Error(`there is no tool called ${c.name}. The tools you have: ${this.tools.map((x) => x.name).join(", ") || "none"}`);
          const ev = await this.hook("before_tool", { tool: { name: c.name, effect: t.effect, source: t.source }, args: c.input });
          if (ev === null) throw new Error("blocked by the before_tool hook");
          const args = (ev as { args?: Record<string, unknown> }).args ?? c.input;
          if (!(await this.approve(t, args))) throw new Error("the person declined this call");
          result = await t.run(args, { node: this.node });
          const after = await this.hook("after_tool", { tool: { name: c.name, effect: t.effect, source: t.source }, args, result });
          if (after && typeof (after as { result?: unknown }).result === "string") result = (after as { result: string }).result;
        } catch (e) {
          error = true;
          result = `Error: ${(e as Error).message}`;
          await this.hook("on_error", { where: "tool", tool: c.name, error: (e as Error).message }).catch(() => null);
        }
        this.rc.emit({ type: "tool", node: this.node, tool: c.name, args: clip(JSON.stringify(c.input), 1500), result: clip(result, 3000), error });
        if (t && t.source !== "catalog" && !t.source.startsWith("edge:")) {
          const edge = this.rc.doc.edges.find((e) => e.kind === "access" && e.source === this.node && e.target === t.source);
          if (edge) this.rc.emit({ type: "access", node: this.node, target: t.source, edge: edge.id, op: t.effect === "read" || t.effect === "pure" ? "read" : "write" });
        }
        return { type: "tool_result", id: c.id, content: clip(result, 30_000), error };
      }),
    );
  }
}
