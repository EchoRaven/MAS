// The step registry. Every configurable stage in the framework (retrieval,
// indexing, memory, database queries, the agent loop) is a slot; each slot
// offers presets with declared parameters, plus "custom" (a FunctionSpec).
// The inspector renders forms from these declarations, so adding a preset
// here is all it takes to offer it everywhere.
import type { FunctionSpec } from "./types";

export type Slot =
  // retrieval: query -> search -> fuse -> filter -> rerank -> select -> format
  | "rewrite" | "search" | "fuse" | "filter" | "rerank" | "select" | "format"
  // knowledge indexing: load -> chunk -> embed -> enrich, on a schedule
  | "load" | "chunk" | "embed" | "enrich" | "schedule"
  // memory lifecycle: extract -> classify -> merge -> retain, consolidated periodically
  | "extract" | "classify" | "merge" | "retain" | "consolidate"
  // agent loop
  | "loop";

export type ParamValue = string | number | boolean | null;

export interface ParamDef {
  key: string;
  label: string;
  type: "number" | "text" | "bool" | "select" | "model" | "list" | "prompt";
  default: ParamValue;
  options?: string[];
  /** model params: which catalog models qualify */
  modelKind?: "chat" | "embedding" | "rerank";
  hint?: string;
}

export interface StepOption {
  use: string;
  label: string;
  hint: string;
  params: ParamDef[];
}

/** One configured stage: a preset with its params, or custom code. */
export interface Step {
  use: string;
  params?: Record<string, ParamValue>;
  /** use === "custom": the code that replaces the stage */
  fn?: FunctionSpec | null;
}

const num = (key: string, label: string, d: number, hint?: string): ParamDef => ({ key, label, type: "number", default: d, hint });
const txt = (key: string, label: string, d: string, hint?: string): ParamDef => ({ key, label, type: "text", default: d, hint });
const bool = (key: string, label: string, d: boolean, hint?: string): ParamDef => ({ key, label, type: "bool", default: d, hint });
const sel = (key: string, label: string, options: string[], d: string, hint?: string): ParamDef => ({ key, label, type: "select", options, default: d, hint });
const model = (key: string, label: string, kind: ParamDef["modelKind"], hint?: string): ParamDef => ({ key, label, type: "model", modelKind: kind, default: null, hint });
const prompt = (key: string, label: string, d: string, hint?: string): ParamDef => ({ key, label, type: "prompt", default: d, hint });
const list = (key: string, label: string, d: string, hint?: string): ParamDef => ({ key, label, type: "list", default: d, hint });

/** What custom code receives and returns, per slot. */
export const CUSTOM_SIGNATURE: Record<Slot, string> = {
  rewrite: "(input, ctx) => string | string[]   // the query or several queries",
  search: "async (query, ctx) => [{ id, text, score, source, meta }]",
  fuse: "(lists: Hit[][], ctx) => Hit[]",
  filter: "(hits, ctx) => Hit[]",
  rerank: "async (query, hits, ctx) => Hit[]   // reordered, with new scores",
  select: "(hits, ctx) => Hit[]",
  format: "(hits, ctx) => string   // what goes into the context",
  load: "async (source, ctx) => [{ id, text, meta }]",
  chunk: "(doc, ctx) => [{ text, meta }]",
  embed: "async (texts: string[], ctx) => number[][]",
  enrich: "async (chunk, ctx) => meta   // merged into the chunk's metadata",
  schedule: "(ctx) => boolean   // re-index now?",
  extract: "async (turn, ctx) => [{ text, type?, meta? }]",
  classify: "async (record, ctx) => 'event' | 'fact' | 'profile' | string",
  merge: "async (record, similar: Record[], ctx) => { action: 'add' | 'update' | 'skip', record }",
  retain: "(record, ctx) => boolean   // keep?",
  consolidate: "async (records, ctx) => Record[]   // replaces the set",
  loop: "async (ctx, { model, tools, memory, emit }) => output   // the whole agent turn",
};

export const STEP_CATALOG: Record<Slot, StepOption[]> = {
  rewrite: [
    { use: "none", label: "As is", hint: "Use the incoming text", params: [] },
    { use: "template", label: "Template", hint: "Build the query from the message and task", params: [prompt("template", "Template", "{{input.text}}")] },
    { use: "multi_query", label: "Multi-query", hint: "An LLM writes several phrasings; all are searched", params: [model("model", "Model", "chat"), num("n", "Queries", 3)] },
    { use: "hyde", label: "HyDE", hint: "Search with a hypothetical answer instead of the question", params: [model("model", "Model", "chat")] },
    { use: "decompose", label: "Decompose", hint: "Split a complex question into sub-questions", params: [model("model", "Model", "chat"), num("max", "Max parts", 4)] },
  ],
  search: [
    { use: "vector", label: "Vector", hint: "Dense similarity on embeddings", params: [model("embedding", "Embedding", "embedding"), num("k", "Candidates", 20), sel("metric", "Metric", ["cosine", "dot", "l2"], "cosine")] },
    { use: "keyword", label: "Keyword (BM25)", hint: "Sparse lexical match", params: [num("k", "Candidates", 20), num("k1", "BM25 k1", 1.2), num("b", "BM25 b", 0.75)] },
    { use: "sql", label: "SQL", hint: "Query a database env (its query settings apply)", params: [txt("env", "Database env id", ""), txt("template", "Template name", "", "Empty: text-to-SQL")] },
    { use: "graph", label: "Graph", hint: "Walk entity relations from matched nodes", params: [num("hops", "Hops", 2), num("k", "Candidates", 20)] },
    { use: "tool", label: "MCP / HTTP tool", hint: "Call a tool and treat its results as hits", params: [txt("tool", "Tool", ""), prompt("args", "Arguments", '{"query": "{{query}}"}')] },
    { use: "recent", label: "Most recent", hint: "Latest records, no scoring (memory)", params: [num("k", "Records", 10)] },
  ],
  fuse: [
    { use: "rrf", label: "Reciprocal rank", hint: "Robust default for combining searches", params: [num("k", "RRF k", 60)] },
    { use: "weighted", label: "Weighted scores", hint: "Normalise and weight each search", params: [list("weights", "Weights", "0.7, 0.3", "One per search, in order")] },
    { use: "concat", label: "Concatenate", hint: "Keep every list as is", params: [] },
  ],
  filter: [
    { use: "metadata", label: "Metadata", hint: "Keep hits whose metadata matches", params: [txt("where", "Where", 'scope == "end_user"')] },
    { use: "threshold", label: "Score threshold", hint: "Drop weak matches", params: [num("min", "Min score", 0.3)] },
    { use: "recency", label: "Recency decay", hint: "Down-weight old records", params: [num("half_life_days", "Half-life (days)", 30)] },
    { use: "permission", label: "Permissions", hint: "Only what the asking user may see", params: [txt("field", "ACL field", "acl")] },
  ],
  rerank: [
    { use: "none", label: "None", hint: "Keep search order", params: [] },
    { use: "model", label: "Rerank model", hint: "Cross-encoder scores each hit", params: [model("model", "Model", "rerank"), num("top_n", "Keep", 10)] },
    { use: "llm", label: "LLM judge", hint: "A chat model scores relevance", params: [model("model", "Model", "chat"), num("top_n", "Keep", 8)] },
  ],
  select: [
    { use: "top_k", label: "Top K", hint: "The best K", params: [num("k", "K", 5)] },
    { use: "mmr", label: "MMR", hint: "Relevant but not redundant", params: [num("k", "K", 5), num("lambda", "Relevance vs diversity", 0.7)] },
    { use: "budget", label: "Token budget", hint: "As many as fit", params: [num("tokens", "Tokens", 3000)] },
  ],
  format: [
    { use: "bullets", label: "Bullets with sources", hint: "- text [source]", params: [] },
    { use: "template", label: "Template", hint: "Your own layout", params: [prompt("template", "Template", "{{#each hits}}- {{this.text}} [{{this.source}}]\n{{/each}}")] },
    { use: "json", label: "JSON", hint: "Hits as a JSON array", params: [] },
    { use: "summary", label: "Summarised", hint: "An LLM condenses the hits", params: [model("model", "Model", "chat"), num("max_tokens", "Max tokens", 400)] },
  ],
  load: [
    { use: "files", label: "Files", hint: "PDF, Markdown, HTML, Office…", params: [list("globs", "Patterns", "**/*.md, **/*.pdf")] },
    { use: "web", label: "Web pages", hint: "Crawl from start URLs", params: [list("urls", "Start URLs", ""), num("depth", "Depth", 1)] },
    { use: "database", label: "Database rows", hint: "Rows as documents", params: [txt("env", "Database env id", ""), prompt("query", "Query", "SELECT id, body FROM articles")] },
    { use: "tool", label: "MCP / HTTP tool", hint: "A tool lists the documents", params: [txt("tool", "Tool", "")] },
  ],
  chunk: [
    { use: "recursive", label: "Recursive", hint: "Paragraphs, then sentences, to size", params: [num("size", "Size (tokens)", 500), num("overlap", "Overlap", 50)] },
    { use: "fixed", label: "Fixed size", hint: "Every N tokens", params: [num("size", "Size (tokens)", 400), num("overlap", "Overlap", 40)] },
    { use: "headings", label: "By headings", hint: "One chunk per section", params: [num("max", "Max tokens", 1200)] },
    { use: "semantic", label: "Semantic", hint: "Split where the topic changes", params: [model("embedding", "Embedding", "embedding"), num("threshold", "Break threshold", 0.8)] },
    { use: "none", label: "Whole document", hint: "No splitting", params: [] },
  ],
  embed: [{ use: "model", label: "Embedding model", hint: "From the model catalog", params: [model("model", "Model", "embedding"), num("batch", "Batch size", 64)] }],
  enrich: [
    { use: "none", label: "None", hint: "Keep loader metadata", params: [] },
    { use: "llm", label: "LLM metadata", hint: "Title, summary, entities, tags", params: [model("model", "Model", "chat"), list("fields", "Fields", "title, summary, entities")] },
  ],
  schedule: [
    { use: "manual", label: "Manually", hint: "Re-index on demand", params: [] },
    { use: "on_change", label: "When sources change", hint: "Watch and re-index the changed parts", params: [] },
    { use: "cron", label: "On a schedule", hint: "Cron expression", params: [txt("cron", "Cron", "0 3 * * *")] },
  ],
  extract: [
    { use: "llm", label: "LLM extraction", hint: "Durable facts from each turn", params: [model("model", "Model", "chat"), prompt("prompt", "Prompt", "List durable facts from this turn (preferences, decisions, open items), one per line.")] },
    { use: "whole_turn", label: "Whole turn", hint: "Store the turn verbatim", params: [] },
    { use: "rules", label: "Rules", hint: "Regex / keyword captures", params: [list("patterns", "Patterns", "")] },
  ],
  classify: [
    { use: "none", label: "None", hint: "One kind of memory", params: [] },
    { use: "llm", label: "LLM", hint: "event · fact · profile (or your own types)", params: [model("model", "Model", "chat"), list("types", "Types", "event, fact, profile")] },
  ],
  merge: [
    { use: "append", label: "Append", hint: "Keep every record", params: [] },
    { use: "dedupe", label: "Dedupe", hint: "Skip near-duplicates", params: [num("similarity", "Similarity", 0.92)] },
    { use: "llm_resolve", label: "Resolve conflicts", hint: "An LLM decides add / update / skip against similar records", params: [model("model", "Model", "chat"), num("similarity", "Compare above", 0.8)] },
  ],
  retain: [
    { use: "forever", label: "Forever", hint: "Never forget", params: [] },
    { use: "ttl", label: "Expire", hint: "Delete after a time", params: [num("days", "Days", 90)] },
    { use: "decay", label: "Decay", hint: "Fade unless recalled", params: [num("half_life_days", "Half-life (days)", 30), num("min_strength", "Forget below", 0.1)] },
    { use: "cap", label: "Cap", hint: "Keep the N most important", params: [num("max", "Max records", 1000)] },
  ],
  consolidate: [
    { use: "none", label: "None", hint: "Records stay as written", params: [] },
    { use: "summarize", label: "Summarise periodically", hint: "Roll old events into summaries", params: [model("model", "Model", "chat"), txt("cron", "When (cron)", "0 4 * * *"), num("older_than_days", "Older than (days)", 7)] },
    { use: "reflect", label: "Reflect", hint: "Derive higher-level insights from recent memories", params: [model("model", "Model", "chat"), num("every_n", "Every N records", 50)] },
  ],
  loop: [
    { use: "react", label: "ReAct", hint: "Reason, act with a tool, observe, repeat", params: [num("max_steps", "Max steps", 30)] },
    { use: "plan_execute", label: "Plan and execute", hint: "Plan first, execute steps, re-plan on failure", params: [model("planner", "Planner model", "chat"), bool("replan", "Re-plan on failure", true), num("max_steps", "Max steps", 30)] },
    { use: "reflexion", label: "Reflexion", hint: "Act, self-critique, retry with the critique", params: [model("critic", "Critic model", "chat"), num("max_trials", "Max trials", 3), prompt("critique", "Critique prompt", "Point out what is wrong or missing in the answer.")] },
    { use: "tree_search", label: "Tree search", hint: "Branch on candidate thoughts, score, expand the best", params: [num("branches", "Branches", 3), num("depth", "Depth", 3), model("evaluator", "Evaluator model", "chat")] },
    { use: "single_shot", label: "Single call", hint: "One model call, no tools", params: [] },
  ],
};

export const optionFor = (slot: Slot, use: string) => STEP_CATALOG[slot].find((o) => o.use === use);

/** A step with every declared param at its default. */
export function makeStep(slot: Slot, use: string): Step {
  if (use === "custom") return { use, fn: { lang: "js", code: `// ${CUSTOM_SIGNATURE[slot]}\nreturn input;` } };
  const o = optionFor(slot, use);
  return { use, params: Object.fromEntries((o?.params ?? []).map((p) => [p.key, p.default])) };
}

export const stepLabel = (slot: Slot, s: Step) => (s.use === "custom" ? "custom" : (optionFor(slot, s.use)?.label ?? s.use));
