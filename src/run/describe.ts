// One-line descriptions of pipeline runs for the simulated event stream.
import type { MemoryPolicy, RetrievalSpec } from "@/model/pipelines";
import { stepLabel, type Slot, type Step } from "@/model/steps";

const lbl = (slot: Slot, s: Step) => stepLabel(slot, s).toLowerCase();

/** "multi-query → vector + keyword → rrf → rerank model → mmr 5" with per-agent overrides applied. */
export function retrievalSummary(base: RetrievalSpec, override?: Partial<RetrievalSpec> | null, topK?: number | null): string {
  const r = { ...base, ...(override ?? {}) };
  const parts = [
    r.rewrite.use !== "none" ? lbl("rewrite", r.rewrite) : null,
    r.search.map((s) => lbl("search", s)).join(" + "),
    r.search.length > 1 ? lbl("fuse", r.fuse) : null,
    ...r.filters.map((f) => lbl("filter", f)),
    r.rerank.use !== "none" ? lbl("rerank", r.rerank) : null,
    `${lbl("select", r.select)} ${topK ?? r.select.params?.k ?? ""}`.trim(),
  ];
  return parts.filter(Boolean).join(" → ");
}

export function memorySummary(m: MemoryPolicy): string {
  return [lbl("extract", m.extract), m.classify.use !== "none" ? lbl("classify", m.classify) : null, lbl("merge", m.merge), lbl("retain", m.retain)].filter(Boolean).join(" → ");
}
