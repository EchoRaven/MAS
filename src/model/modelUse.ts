// Which models a system uses, and where: agents, bare model calls, llm
// functions, and every pipeline step and loop setting that names one. The
// Library counts these, a run checks their keys before it starts, and the
// architect rewires a preset's models to ones that will work.
import type { ModelSpec, SystemDoc } from "./types";

const MODEL_KEYS = ["model", "embedding", "planner", "critic", "evaluator"];

export interface ModelUse {
  model: string;
  /** component (or edge) that names it */
  where: string;
}

/** Every place a catalog model is named. */
export function modelUses(doc: SystemDoc): ModelUse[] {
  const out: ModelUse[] = [];
  const catalog = new Set(doc.models.map((m) => m.id));
  const walk = (v: unknown, where: string) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, where));
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (MODEL_KEYS.includes(k) && typeof x === "string" && catalog.has(x)) out.push({ model: x, where });
      else walk(x, where);
    }
  };
  for (const n of doc.nodes) walk(n.data, n.id);
  for (const e of doc.edges) walk({ transform: e.transform, binding: e.binding }, e.id);
  return out;
}

/** Point every place that names `from` at `to`. */
export function replaceModel(doc: SystemDoc, from: string, to: string): SystemDoc {
  const swap = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(swap);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, MODEL_KEYS.includes(k) && x === from ? to : swap(x)]));
  };
  return { ...doc, nodes: doc.nodes.map((n) => ({ ...n, data: swap(n.data) as typeof n.data })), edges: doc.edges.map((e) => swap(e) as typeof e) };
}

/**
 * The system with every chat model in its catalog served by one model instead
 * (looked up in the system's catalog, then the defaults). Ids stay as they
 * are, so every reference follows, even one in function code.
 */
export function runAllOn(doc: SystemDoc, target: string, defaults: ModelSpec[] = []): SystemDoc {
  const spec = doc.models.find((m) => m.id === target) ?? defaults.find((m) => m.id === target);
  if (!spec) throw new Error(`Unknown model "${target}"`);
  if ((spec.kind ?? "chat") !== "chat") throw new Error(`"${target}" is not a chat model`);
  return { ...doc, models: doc.models.map((m) => ((m.kind ?? "chat") === "chat" && m.provider !== "mock" ? { ...spec, id: m.id } : m)) };
}
