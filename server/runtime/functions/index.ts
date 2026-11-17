// Run any FunctionSpec: f(input, ctx) -> output | null.
import jsonata from "jsonata";
import type { FunctionSpec } from "@/model/types";
import type { RunCtx } from "../context";
import { textOf, userText } from "../models/types";
import { runPython } from "./python";
import { runJs } from "./sandbox";
import { renderTemplate } from "./template";

export interface FnScope {
  node?: string;
  edge?: string;
  /** extra helpers for code (retrieve, tools, memory…) */
  helpers?: Record<string, unknown>;
  /** extra template variables (query, hits, round…) */
  vars?: Record<string, unknown>;
  /** values bound by name in code, per the slot's signature (lists, hits, records, event…) */
  named?: Record<string, unknown>;
}

/** One model call with a prompt, for llm functions and code (ctx.llm). */
export async function llmCall(rc: RunCtx, node: string, prompt: string, model?: string | null, system?: string): Promise<string> {
  const { res, usage } = await rc.models.chat(model ?? null, { system, messages: [userText(prompt)], signal: rc.signal });
  rc.usage(node, usage);
  return textOf(res.content);
}

export function fnContext(rc: RunCtx, scope: FnScope): Record<string, unknown> {
  const node = scope.node ?? "";
  return {
    run_id: rc.runId,
    node,
    edge: scope.edge,
    vars: rc.vars,
    now: Date.now(),
    /** ctx.llm(prompt, data?, model?): data is appended as text or JSON */
    llm: (prompt: string, data?: unknown, model?: string) => llmCall(rc, node, data === undefined ? String(prompt) : `${prompt}\n\n${typeof data === "string" ? data : JSON.stringify(data, null, 1)}`, model),
    log: (text: string) => rc.emit({ type: "log", node, level: "info", text: String(text).slice(0, 2000) }),
    ...scope.vars,
    ...scope.helpers,
  };
}

export async function runFn(fn: FunctionSpec, input: unknown, rc: RunCtx, scope: FnScope = {}): Promise<unknown> {
  const ctx = fnContext(rc, scope);
  const timeout = fn.timeout_ms ?? undefined;
  switch (fn.lang) {
    case "template":
      return renderTemplate(fn.code, { input, ctx, ...ctx, ...scope.vars, ...scope.named });
    case "jsonata":
      return jsonata(fn.code).evaluate(input, { ctx: { run_id: rc.runId, node: ctx.node, vars: rc.vars, ...scope.vars } });
    case "js":
      return runJs(fn.code, input, ctx, timeout, scope.named);
    case "python":
      return runPython(fn.code, input, { run_id: rc.runId, node: ctx.node, vars: rc.vars, now: Date.now(), ...scope.vars, ...scope.named }, timeout);
    case "llm":
      return llmCall(rc, String(ctx.node), await renderTemplate(fn.code, { input, ctx, ...ctx, ...scope.vars, ...scope.named }), fn.model);
  }
}
