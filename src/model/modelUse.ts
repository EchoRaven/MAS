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

/**
 * The system with chosen catalog models served by other models: { sonnet:
 * "gemini", gpt: "gemini_lite" }. Ids stay, so every reference follows.
 */
export function remapModels(doc: SystemDoc, map: Record<string, string>, defaults: ModelSpec[] = []): SystemDoc {
  const find = (id: string) => doc.models.find((m) => m.id === id) ?? defaults.find((m) => m.id === id);
  // "node:<id>" serves one node with a model, when it shares its slot with others (MoA's aggregator and a proposer)
  const nodeKeys = Object.entries(map).filter(([k]) => k.startsWith("node:"));
  const slotMap = Object.fromEntries(Object.entries(map).filter(([k]) => !k.startsWith("node:")));
  if (nodeKeys.length) {
    let out = remapModels(doc, slotMap, defaults);
    for (const [key, to] of nodeKeys) {
      const id = key.slice(5);
      const node = out.nodes.find((n) => n.id === id);
      const data = node?.data as { model?: string } | undefined;
      if (!node || typeof data?.model !== "string") throw new Error(`The system has no node "${id}" with a model`);
      const spec = find(to);
      if (!spec) throw new Error(`Unknown model "${to}"`);
      if ((spec.kind ?? "chat") !== "chat") throw new Error(`"${to}" is not a chat model`);
      // its own slot, so remapping the slot it shared cannot reach it
      const slot = `node_${id}`;
      out = {
        ...out,
        models: [...out.models.filter((m) => m.id !== slot), { ...spec, id: slot }],
        nodes: out.nodes.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, model: slot } } as typeof n) : n)),
      };
    }
    return out;
  }
  for (const [from, to] of Object.entries(map)) {
    if (!doc.models.some((m) => m.id === from)) throw new Error(`The system has no model "${from}"`);
    const spec = find(to);
    if (!spec) throw new Error(`Unknown model "${to}"`);
    if ((spec.kind ?? "chat") !== (doc.models.find((m) => m.id === from)!.kind ?? "chat")) throw new Error(`"${to}" is not the same kind of model as "${from}"`);
  }
  return { ...doc, models: doc.models.map((m) => (map[m.id] ? { ...find(map[m.id])!, id: m.id } : m)) };
}
