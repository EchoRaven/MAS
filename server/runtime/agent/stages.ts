// The agent wrapper's input and output stages:
// transform · filter · parse_json · validate · redact · route · summarize.
import type { Processor } from "@/model/types";
import type { RunCtx } from "../context";
import { llmCall, runFn } from "../functions";
import { asText, parseJsonLoose } from "../values";
import { schemaById, validateJson } from "./jsonschema";

export interface StageResult {
  value: unknown;
  dropped?: boolean;
  /** route: the output port chosen */
  port?: string;
}

// order matters: keys and card numbers before phone numbers, which would otherwise swallow them
const REDACT: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\b(?:sk|pk|rk|ghp|xox[bp])[-_][A-Za-z0-9_-]{12,}\b/g, "[secret]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[secret]"],
  [/\bAQ\.[0-9A-Za-z_-]{20,}/g, "[secret]"],
  [/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,4}\b/g, "[card]"],
  [/(?<![\w+])\+?\d[\d -]{7,}\d\b/g, "[phone]"],
];

export class StageError extends Error {
  constructor(
    message: string,
    public stage: Processor,
  ) {
    super(message);
  }
}

export async function runStages(rc: RunCtx, node: string, stages: Processor[], value: unknown, side: "in" | "out", ports: string[] = []): Promise<StageResult> {
  let v = value;
  let port: string | undefined;
  for (const st of stages) {
    const scope = { node, vars: { stage: st.name } };
    switch (st.op) {
      case "transform":
        if (st.fn) v = await runFn(st.fn, v, rc, scope);
        if (v == null) return { value: null, dropped: true };
        break;
      case "filter":
        if (st.fn && !(await runFn(st.fn, v, rc, scope))) {
          rc.emit({ type: "transform", at: node, label: `${side} · ${st.name}`, detail: "filtered out" });
          return { value: null, dropped: true };
        }
        break;
      case "parse_json":
        try {
          v = typeof v === "string" ? parseJsonLoose(v) : typeof v === "object" && v && "text" in v ? parseJsonLoose(asText(v)) : v;
        } catch (e) {
          throw new StageError(`${st.name}: ${(e as Error).message}`, st);
        }
        break;
      case "validate": {
        const schema = schemaById(rc.doc, st.schema);
        if (schema) {
          const errs = validateJson(v, schema);
          if (errs.length) throw new StageError(`${st.name}: ${errs.slice(0, 3).join("; ")}`, st);
        }
        break;
      }
      case "redact":
        if (st.fn) v = await runFn(st.fn, v, rc, scope);
        else {
          let s = asText(v);
          for (const [re, rep] of REDACT) s = s.replace(re, rep);
          v = typeof v === "string" ? s : typeof v === "object" && v && "text" in v ? { ...(v as object), text: s } : s;
        }
        break;
      case "summarize":
        v = st.fn ? await runFn(st.fn, v, rc, scope) : await llmCall(rc, node, `Summarise concisely, keeping every decision and open item:\n\n${asText(v)}`);
        break;
      case "route": {
        const r = st.fn ? await runFn(st.fn, v, rc, scope) : null;
        if (typeof r === "string" && ports.includes(r)) port = r;
        else if (r && typeof r === "object" && !Array.isArray(r)) {
          const key = Object.keys(r).find((k) => ports.includes(k));
          if (key) {
            port = key;
            v = (r as Record<string, unknown>)[key];
          }
        }
        break;
      }
    }
    rc.emit({ type: "transform", at: node, label: `${side} · ${st.name}`, detail: port && st.op === "route" ? `routed to ${port}` : st.op });
  }
  return { value: v, port };
}
