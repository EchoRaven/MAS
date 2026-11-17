// The built-in test model: no key, no network, deterministic. It lets a
// system be dry-run end to end (every edge, tool, gate and loop runs for
// real; only the model text is canned) and keeps the runtime tests offline.
//
// api.params.script: a list of replies used in order (then the last repeats).
// Each is a string, or { tool, input } to call a tool, or { text, tool, input }.
import type { ModelSpec } from "@/model/types";
import { textOf, type ChatResponse, type Part, type Provider } from "./types";

type Scripted = string | { text?: string; tool?: string; input?: Record<string, unknown> };

const counters = new Map<string, number>();

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A minimal value that satisfies a JSON Schema (first enum value, required keys only). */
export function sampleFromSchema(schema: Record<string, unknown>, hint = ""): unknown {
  if (Array.isArray(schema.enum)) return schema.enum.find((e) => e !== null) ?? schema.enum[0];
  if ("const" in schema) return schema.const;
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (t) {
    case "object": {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const keys = new Set([...((schema.required as string[]) ?? []), ...Object.keys(props).slice(0, 3)]);
      return Object.fromEntries([...keys].map((k) => [k, sampleFromSchema(props[k] ?? { type: "string" }, k)]));
    }
    case "array":
      return [];
    case "number":
    case "integer":
      return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      return hint ? `${hint} (test value)` : "test value";
  }
}

export function resetMock() {
  counters.clear();
}

export const mockProvider: Provider = {
  async chat(model: ModelSpec, _key, req) {
    const last = req.messages[req.messages.length - 1];
    const lastText = last ? textOf(last.content) || last.content.map((p) => (p.type === "tool_result" ? p.content : "")).join(" ") : "";
    const script = (model.api.params?.script ?? null) as Scripted[] | null;
    const content: Part[] = [];
    let stop: ChatResponse["stop"] = "end";
    if (script?.length) {
      const key = `${model.id}|${req.system ?? ""}`;
      const n = counters.get(key) ?? 0;
      counters.set(key, n + 1);
      const s = script[Math.min(n, script.length - 1)];
      const step = typeof s === "string" ? { text: s } : s;
      if (step.text) content.push({ type: "text", text: step.text.replace("{{input}}", lastText) });
      if (step.tool && req.tools?.some((t) => t.name === step.tool)) {
        content.push({ type: "tool_call", id: `call_${n}_${hash(step.tool)}`, name: step.tool, input: step.input ?? {} });
        stop = "tool_use";
      }
    } else {
      const who = /You are ([^.\n]+)/.exec(req.system ?? "")?.[1] ?? "Assistant";
      const json = /Reply with only a JSON value/.test(req.system ?? "");
      const consensus = /<INFO>|<CAMEL_TASK_DONE>/.exec(req.system ?? "")?.[0];
      const gist = lastText.replace(/\s+/g, " ").trim().slice(0, 160);
      let schema: Record<string, unknown> | null = null;
      const m = /matching this JSON Schema:\n([\s\S]*)$/.exec(req.system ?? "");
      if (m) {
        try {
          schema = JSON.parse(m[1].trim());
        } catch {
          schema = null;
        }
      }
      // "Answer as JSON: a, b, c" -> an object with those keys (is_/has_ flags true)
      const segment = /JSON:([^\n]*)/i.exec(lastText)?.[1] ?? "";
      const found = [...new Set(segment.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [])];
      const keys = found.length >= 2 ? found : undefined;
      const fromKeys = keys ? Object.fromEntries(keys.map((k) => [k, /^(is|has|should)_/.test(k) ? true : `${k} (test value)`])) : null;
      const wantsJson = json || /Reply with only a JSON value/.test(lastText);
      content.push({ type: "text", text: wantsJson ? JSON.stringify(schema ? sampleFromSchema(schema) : (fromKeys ?? { summary: gist, from: who })) : `${who}: ${gist ? `on "${gist}" — ` : ""}done.${consensus ? ` ${consensus}` : ""}` });
    }
    const input = Math.ceil(((req.system ?? "").length + req.messages.reduce((n, m) => n + JSON.stringify(m.content).length, 0)) / 4);
    return { content, stop, usage: { input, output: Math.ceil(textOf(content).length / 4) + 5 } };
  },

  async embed(_model, _key, texts) {
    // bag-of-words hashed into 64 dims: similar texts land near each other
    return texts.map((t) => {
      const v = new Array(64).fill(0);
      for (const w of t.toLowerCase().match(/[a-z0-9一-鿿]+/g) ?? []) v[hash(w) % 64] += 1;
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  },

  async rerank(_model, _key, query, docs) {
    const q = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
    return docs.map((d) => {
      const words = d.toLowerCase().split(/\W+/);
      return words.filter((w) => q.has(w)).length / (words.length || 1);
    });
  },
};
