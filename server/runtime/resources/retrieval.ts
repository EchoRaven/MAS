// The retrieval pipeline, run for real:
//   rewrite -> search (several = hybrid) -> fuse -> filters -> rerank -> select -> format
// Every stage is a registry preset or custom code (Step.fn).
import type { RetrievalSpec, Step } from "@/model/types";
import type { RunCtx } from "../context";
import { llmCall, runFn } from "../functions";
import { renderTemplate } from "../functions/template";
import { testExpr } from "../functions/sandbox";

export interface Doc {
  id: string;
  text: string;
  source?: string;
  ts?: number;
  meta?: Record<string, unknown>;
}

export interface Hit extends Doc {
  score: number;
  /** best raw score from any search, 0..1, for thresholds */
  raw: number;
}

/** What a pipeline searches over. */
export interface Corpus {
  docs(): Promise<Doc[]>;
  /** cached embeddings by doc id */
  vectors?: Map<string, number[]>;
  /** search steps a corpus answers itself (sql, tool) */
  searchOther?(step: Step, query: string): Promise<Hit[]>;
}

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+|[一-鿿]/g) ?? [];
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const p = (s: Step, k: string) => s.params?.[k];

export function bm25(docs: Doc[], query: string, k: number, k1 = 1.2, b = 0.75): Hit[] {
  const q = [...new Set(words(query))];
  if (!q.length || !docs.length) return [];
  const toks = docs.map((d) => words(d.text));
  const avg = toks.reduce((n, t) => n + t.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const w of toks[i]) tf.set(w, (tf.get(w) ?? 0) + 1);
    let s = 0;
    for (const w of q) {
      const f = tf.get(w) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
      s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks[i].length) / avg));
    }
    return { ...d, score: s, raw: 0 };
  });
  const top = scored.filter((h) => h.score > 0).sort((a, b2) => b2.score - a.score).slice(0, k);
  const max = top[0]?.score || 1;
  return top.map((h) => ({ ...h, raw: h.score / max }));
}

const cos = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / (Math.sqrt(na * nb) || 1);
};

export class Retriever {
  constructor(
    private rc: RunCtx,
    private node: string,
  ) {}

  /** custom step code: the input, plus the slot's names bound (query, lists, hits) */
  private async custom<T>(s: Step, input: unknown, named: Record<string, unknown> = {}): Promise<T> {
    return (await runFn(s.fn!, input, this.rc, { node: this.node, vars: named, named, helpers: this.helpers })) as T;
  }
  /** extra ctx helpers for custom steps (e.g. ctx.retrieve from the plugin running the pipeline) */
  helpers: Record<string, unknown> = {};

  async rewrite(s: Step, input: string): Promise<string[]> {
    switch (s.use) {
      case "custom": {
        const r = await this.custom<string | string[]>(s, input, { query: input });
        return Array.isArray(r) ? r.map(String) : [String(r ?? input)];
      }
      case "template":
        return [await renderTemplate(String(p(s, "template") ?? "{{input.text}}"), { input, query: input })];
      case "multi_query": {
        const n = num(p(s, "n"), 3);
        const out = await llmCall(this.rc, this.node, `Write ${n} different search queries for finding information relevant to the text below. One per line, nothing else.\n\n${input}`, (p(s, "model") as string) || null);
        return [input, ...out.split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, n)];
      }
      case "hyde":
        return [await llmCall(this.rc, this.node, `Write a short passage that would answer this:\n\n${input}`, (p(s, "model") as string) || null)];
      case "decompose": {
        const out = await llmCall(this.rc, this.node, `Split this into at most ${num(p(s, "max"), 4)} self-contained sub-questions, one per line, nothing else:\n\n${input}`, (p(s, "model") as string) || null);
        const parts = out.split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean);
        return parts.length ? parts : [input];
      }
      default:
        return [input];
    }
  }

  async search(s: Step, query: string, corpus: Corpus): Promise<Hit[]> {
    const k = num(p(s, "k"), 20);
    switch (s.use) {
      case "custom":
        return ((await this.custom<Hit[]>(s, query, { query })) ?? []).map((h, i) => ({ id: String(h.id ?? i), text: String(h.text ?? ""), score: num(h.score, 0), raw: num(h.score, 0), source: h.source, meta: h.meta }));
      case "keyword":
        return bm25(await corpus.docs(), query, k, num(p(s, "k1"), 1.2), num(p(s, "b"), 0.75));
      case "recent":
        return (await corpus.docs())
          .slice()
          .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
          .slice(0, k)
          .map((d, i) => ({ ...d, score: 1 / (i + 1), raw: 1 }));
      case "vector": {
        const docs = await corpus.docs();
        if (!docs.length) return [];
        const model = (p(s, "embedding") as string) || null;
        try {
          corpus.vectors ??= new Map();
          const missing = docs.filter((d) => !corpus.vectors!.has(d.id));
          if (missing.length) {
            const vs = await this.rc.models.embed(model, missing.map((d) => d.text), this.rc.signal);
            missing.forEach((d, i) => corpus.vectors!.set(d.id, vs[i]));
          }
          const [qv] = await this.rc.models.embed(model, [query], this.rc.signal);
          return docs
            .map((d) => {
              const sc = cos(qv, corpus.vectors!.get(d.id)!);
              return { ...d, score: sc, raw: Math.max(0, sc) };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
        } catch (e) {
          this.rc.emit({ type: "log", node: this.node, level: "warn", text: `Vector search unavailable (${(e as Error).message}); used keyword search instead` });
          return bm25(docs, query, k);
        }
      }
      case "graph":
        // no graph store yet: lexical match stands in, and says so
        this.rc.emit({ type: "log", node: this.node, level: "warn", text: "Graph search has no graph store yet; used keyword search" });
        return bm25(await corpus.docs(), query, k);
      default:
        if (corpus.searchOther) return corpus.searchOther(s, query);
        throw new Error(`Search "${s.use}" is not available here`);
    }
  }

  fuse(s: Step, lists: Hit[][]): Hit[] {
    if (s.use === "custom") throw new Error("custom fuse handled by caller");
    const byId = new Map<string, Hit>();
    if (s.use === "concat") {
      for (const l of lists) for (const h of l) if (!byId.has(h.id)) byId.set(h.id, h);
      return [...byId.values()];
    }
    const weights = String(p(s, "weights") ?? "").split(",").map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));
    const k = num(p(s, "k"), 60);
    lists.forEach((l, li) => {
      const max = Math.max(...l.map((h) => h.score), 1e-9);
      l.forEach((h, rank) => {
        const add = s.use === "weighted" ? (weights[li] ?? 1) * (h.score / max) : 1 / (k + rank + 1);
        const prev = byId.get(h.id);
        byId.set(h.id, prev ? { ...prev, score: prev.score + add, raw: Math.max(prev.raw, h.raw) } : { ...h, score: add });
      });
    });
    return [...byId.values()].sort((a, b) => b.score - a.score);
  }

  async filter(s: Step, hits: Hit[]): Promise<Hit[]> {
    switch (s.use) {
      case "custom":
        return (await this.custom<Hit[]>(s, hits, { hits })) ?? [];
      case "threshold":
        return hits.filter((h) => h.raw >= num(p(s, "min"), 0.3));
      case "recency": {
        const half = num(p(s, "half_life_days"), 30) * 86400_000;
        const now = Date.now();
        return hits.map((h) => ({ ...h, score: h.ts ? h.score * 0.5 ** ((now - h.ts) / half) : h.score })).sort((a, b) => b.score - a.score);
      }
      case "metadata": {
        const where = String(p(s, "where") ?? "");
        return where ? hits.filter((h) => testExpr(where, { ...(h.meta ?? {}), hit: h, source: h.source }).ok) : hits;
      }
      case "permission": {
        const field = String(p(s, "field") ?? "acl");
        const user = this.rc.vars.user_id;
        return hits.filter((h) => {
          const acl = h.meta?.[field];
          return acl == null || (Array.isArray(acl) ? acl.includes(user) : acl === user);
        });
      }
      default:
        return hits;
    }
  }

  async rerank(s: Step, query: string, hits: Hit[]): Promise<Hit[]> {
    if (!hits.length) return hits;
    switch (s.use) {
      case "custom":
        return (await this.custom<Hit[]>(s, query, { query, hits })) ?? hits;
      case "model":
        try {
          const scores = await this.rc.models.rerank((p(s, "model") as string) || null, query, hits.map((h) => h.text), this.rc.signal);
          return hits.map((h, i) => ({ ...h, score: scores[i] })).sort((a, b) => b.score - a.score).slice(0, num(p(s, "top_n"), 10));
        } catch (e) {
          this.rc.emit({ type: "log", node: this.node, level: "warn", text: `Rerank skipped: ${(e as Error).message}` });
          return hits;
        }
      case "llm": {
        const list = hits.map((h, i) => `[${i}] ${h.text.slice(0, 400)}`).join("\n");
        const out = await llmCall(this.rc, this.node, `Rate how relevant each passage is to the query, 0-10. Reply with one line per passage: index score.\n\nQuery: ${query}\n\n${list}`, (p(s, "model") as string) || null);
        const scores = new Map<number, number>();
        for (const m of out.matchAll(/\[?(\d+)\]?\s*[:\-]?\s*(\d+(?:\.\d+)?)/g)) scores.set(Number(m[1]), Number(m[2]));
        return hits.map((h, i) => ({ ...h, score: scores.get(i) ?? 0 })).sort((a, b) => b.score - a.score).slice(0, num(p(s, "top_n"), 8));
      }
      default:
        return hits;
    }
  }

  async select(s: Step, hits: Hit[], corpus: Corpus, topK?: number | null): Promise<Hit[]> {
    const k = topK ?? num(p(s, "k"), 5);
    switch (s.use) {
      case "custom":
        return (await this.custom<Hit[]>(s, hits, { hits })) ?? [];
      case "budget": {
        let left = num(p(s, "tokens"), 3000) * 4;
        const out: Hit[] = [];
        for (const h of hits) {
          if (h.text.length > left) break;
          left -= h.text.length;
          out.push(h);
        }
        return out;
      }
      case "mmr": {
        const lambda = num(p(s, "lambda"), 0.7);
        const sim = (a: Hit, b: Hit) => {
          const va = corpus.vectors?.get(a.id), vb = corpus.vectors?.get(b.id);
          if (va && vb) return cos(va, vb);
          const wa = new Set(words(a.text)), wb = new Set(words(b.text));
          const inter = [...wa].filter((w) => wb.has(w)).length;
          return inter / (wa.size + wb.size - inter || 1);
        };
        const max = Math.max(...hits.map((h) => h.score), 1e-9);
        const pool = [...hits];
        const out: Hit[] = [];
        while (out.length < k && pool.length) {
          let best = 0, bestScore = -Infinity;
          pool.forEach((h, i) => {
            const score = lambda * (h.score / max) - (1 - lambda) * Math.max(0, ...out.map((o) => sim(h, o)));
            if (score > bestScore) [best, bestScore] = [i, score];
          });
          out.push(pool.splice(best, 1)[0]);
        }
        return out;
      }
      default:
        return hits.slice(0, k);
    }
  }

  async format(s: Step, hits: Hit[], query: string): Promise<string> {
    switch (s.use) {
      case "custom":
        return String((await this.custom<string>(s, hits, { hits, query })) ?? "");
      case "json":
        return JSON.stringify(hits.map(({ id, text, source, score, meta }) => ({ id, text, source, score, meta })), null, 1);
      case "template":
        return renderTemplate(String(p(s, "template") ?? ""), { hits, query });
      case "summary":
        return hits.length ? llmCall(this.rc, this.node, `Condense these passages into what matters for "${query}" (at most ${num(p(s, "max_tokens"), 400)} tokens), keeping sources:\n\n${hits.map((h) => `- [${h.source ?? h.id}] ${h.text}`).join("\n")}`, (p(s, "model") as string) || null) : "";
      default:
        // the source goes first: after a long passage, a label at the end gets attached to the wrong text
        return hits.map((h) => `- ${h.source ? `[${h.source}] ` : ""}${h.text.replace(/\s*\n\s*/g, " ")}`).join("\n");
    }
  }

  /** The whole pipeline. `override` comes from the access edge (binding.read.retrieval). */
  async run(spec: RetrievalSpec, query: string, corpus: Corpus, opts: { override?: Partial<RetrievalSpec> | null; topK?: number | null } = {}): Promise<{ hits: Hit[]; text: string }> {
    const r = { ...spec, ...(opts.override ?? {}) } as RetrievalSpec;
    const queries = await this.rewrite(r.rewrite, query);
    const lists: Hit[][] = [];
    for (const q of queries) for (const s of r.search) lists.push(await this.search(s, q, corpus));
    let hits = r.fuse.use === "custom" ? ((await this.custom<Hit[]>(r.fuse, lists, { lists })) ?? []) : this.fuse(r.fuse, lists);
    for (const f of r.filters) hits = await this.filter(f, hits);
    hits = await this.rerank(r.rerank, query, hits);
    hits = await this.select(r.select, hits, corpus, opts.topK);
    return { hits, text: await this.format(r.format, hits, query) };
  }
}
