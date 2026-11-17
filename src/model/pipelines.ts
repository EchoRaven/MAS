// Pipelines built from registry steps: how a plugin retrieves, how a
// knowledge base is indexed, how memory is written and kept, how a database
// is queried. Each stage is a Step: a preset with params, or custom code.
import { makeStep, type Slot, type Step } from "./steps";

/** query -> search (several = hybrid) -> fuse -> filters -> rerank -> select -> format */
export interface RetrievalSpec {
  rewrite: Step;
  search: Step[];
  fuse: Step;
  filters: Step[];
  rerank: Step;
  select: Step;
  format: Step;
}

/** Knowledge: load -> chunk -> embed -> enrich, re-indexed on a schedule. */
export interface IndexSpec {
  load: Step;
  chunk: Step;
  embed: Step;
  enrich: Step;
  schedule: Step;
}

/** Memory: extract -> classify -> merge -> retain, with periodic consolidation. */
export interface MemoryPolicy {
  extract: Step;
  classify: Step;
  merge: Step;
  retain: Step;
  consolidate: Step;
}

/** How agents query a database env. */
export interface DbQuerySpec {
  /** templates: only the named queries below · text_to_sql: an LLM writes SQL within the allowlist · tools: the env's own tools · custom: code */
  mode: "templates" | "text_to_sql" | "tools" | "custom";
  templates: { name: string; description: string; sql: string }[];
  /** text_to_sql: tables it may see */
  tables: string[];
  read_only: boolean;
  row_limit: number;
  model?: string | null;
  fn?: import("./types").FunctionSpec | null;
}

/** The ordered stages of each pipeline, for editors and validation. Lists hold several steps. */
export const RETRIEVAL_SLOTS: { key: keyof RetrievalSpec; slot: Slot; title: string; many?: boolean }[] = [
  { key: "rewrite", slot: "rewrite", title: "Query" },
  { key: "search", slot: "search", title: "Search", many: true },
  { key: "fuse", slot: "fuse", title: "Fuse" },
  { key: "filters", slot: "filter", title: "Filter", many: true },
  { key: "rerank", slot: "rerank", title: "Rerank" },
  { key: "select", slot: "select", title: "Select" },
  { key: "format", slot: "format", title: "Format" },
];
export const INDEX_SLOTS: { key: keyof IndexSpec; slot: Slot; title: string }[] = [
  { key: "load", slot: "load", title: "Load" },
  { key: "chunk", slot: "chunk", title: "Chunk" },
  { key: "embed", slot: "embed", title: "Embed" },
  { key: "enrich", slot: "enrich", title: "Enrich" },
  { key: "schedule", slot: "schedule", title: "Re-index" },
];
export const MEMORY_SLOTS: { key: keyof MemoryPolicy; slot: Slot; title: string }[] = [
  { key: "extract", slot: "extract", title: "Extract" },
  { key: "classify", slot: "classify", title: "Classify" },
  { key: "merge", slot: "merge", title: "Merge" },
  { key: "retain", slot: "retain", title: "Retain" },
  { key: "consolidate", slot: "consolidate", title: "Consolidate" },
];

const step = (slot: Slot, use: string, params: Record<string, string | number | boolean | null> = {}): Step => {
  const s = makeStep(slot, use);
  return { ...s, params: { ...s.params, ...params } };
};

export function defaultRetrieval(kind: "knowledge" | "memory" | "plain"): RetrievalSpec {
  if (kind === "knowledge") {
    return {
      rewrite: step("rewrite", "none"),
      search: [step("search", "vector", { embedding: "embed" }), step("search", "keyword")],
      fuse: step("fuse", "rrf"),
      filters: [step("filter", "threshold", { min: 0.2 })],
      rerank: step("rerank", "model", { model: "rerank" }),
      select: step("select", "mmr", { k: 5 }),
      format: step("format", "bullets"),
    };
  }
  if (kind === "memory") {
    return {
      rewrite: step("rewrite", "none"),
      search: [step("search", "vector", { embedding: "embed", k: 30 }), step("search", "recent", { k: 5 })],
      fuse: step("fuse", "rrf"),
      filters: [step("filter", "recency", { half_life_days: 30 })],
      rerank: step("rerank", "none"),
      select: step("select", "top_k", { k: 8 }),
      format: step("format", "bullets"),
    };
  }
  return {
    rewrite: step("rewrite", "none"),
    search: [step("search", "keyword")],
    fuse: step("fuse", "concat"),
    filters: [],
    rerank: step("rerank", "none"),
    select: step("select", "top_k", { k: 10 }),
    format: step("format", "bullets"),
  };
}

export function defaultIndex(): IndexSpec {
  return {
    load: step("load", "files"),
    chunk: step("chunk", "recursive"),
    embed: step("embed", "model", { model: "embed" }),
    enrich: step("enrich", "none"),
    schedule: step("schedule", "on_change"),
  };
}

export function defaultMemoryPolicy(): MemoryPolicy {
  return {
    extract: step("extract", "llm", { model: "haiku" }),
    classify: step("classify", "llm", { model: "haiku" }),
    merge: step("merge", "llm_resolve", { model: "haiku" }),
    retain: step("retain", "decay"),
    consolidate: step("consolidate", "summarize", { model: "haiku" }),
  };
}

export function defaultDbQuery(): DbQuerySpec {
  return { mode: "templates", templates: [{ name: "find_order", description: "Look up an order by id", sql: "SELECT * FROM orders WHERE id = :order_id" }], tables: [], read_only: true, row_limit: 200, model: null, fn: null };
}

/** Every step of a pipeline with where it sits, for validation and summaries. */
export function stepsOf(p: Partial<RetrievalSpec & IndexSpec & MemoryPolicy>): { slot: Slot; step: Step; where: string }[] {
  const out: { slot: Slot; step: Step; where: string }[] = [];
  for (const d of [...RETRIEVAL_SLOTS, ...INDEX_SLOTS, ...MEMORY_SLOTS]) {
    const v = (p as Record<string, Step | Step[] | undefined>)[d.key];
    if (!v) continue;
    for (const s of Array.isArray(v) ? v : [v]) out.push({ slot: d.slot, step: s, where: d.title });
  }
  return out;
}
