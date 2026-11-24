// Memory: records written from turns by the memory policy
//   extract -> classify -> merge -> retain, with consolidation
// and read back through the retrieval pipeline.
import type { MemoryPolicy, PluginData, Step, SysEdge, SysNode } from "@/model/types";
import { defaultMemoryPolicy, defaultRetrieval } from "@/model/pipelines";
import type { RunCtx } from "../../context";
import { llmCall, runFn } from "../../functions";
import { Retriever, type Doc } from "../retrieval";
import { S, schema, type Resource, type RtTool, type TurnInfo } from "../types";
import { readState, scopeKey, stateFile, uid, writeState } from "./common";

interface Rec extends Doc {
  meta?: Record<string, unknown>;
  type: string;
  ts: number;
  strength: number;
  recalled?: number;
}

interface MemFile {
  records: Rec[];
  since_consolidate: number;
}

const p = (s: Step, k: string) => s.params?.[k];
const model = (s: Step, k = "model") => (p(s, k) as string) || null;
const lines = (s: string) => s.split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter((l) => l && !/^none\.?$/i.test(l));
const jaccard = (a: string, b: string) => {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean)), wb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / (wa.size + wb.size - inter || 1);
};

export class MemoryPlugin implements Resource {
  constructor(
    private rc: RunCtx,
    private node: SysNode<PluginData>,
  ) {}
  get id() {
    return this.node.id;
  }
  private get policy(): MemoryPolicy {
    return this.node.data.spec.memory ?? defaultMemoryPolicy();
  }
  private file(agent: string) {
    return stateFile(this.rc, this.node.id, `memory-${scopeKey(this.rc, this.node, agent).replace(/[^\w.-]/g, "_")}.json`);
  }
  private load(agent: string): MemFile {
    return readState<MemFile>(this.file(agent), { records: [], since_consolidate: 0 });
  }
  private save(agent: string, m: MemFile) {
    writeState(this.file(agent), m);
  }

  /**
   * Writes to one agent's memory, one after another. A write reads the file, waits on models (importance, a
   * reflection), then saves: two at once read the same file, so each reflected on the same memories and the later
   * save dropped the other's records (a resident reflected four times in eight seconds).
   */
  private queues = new Map<string, Promise<unknown>>();
  private serial<T>(agent: string, job: () => Promise<T>): Promise<T> {
    const key = this.file(agent);
    const run = (this.queues.get(key) ?? Promise.resolve()).then(job, job);
    const tail = run.then(() => undefined, () => undefined);
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return run;
  }

  async search(agent: string, query: string, edge?: SysEdge): Promise<{ text: string; count: number }> {
    const mem = this.load(agent);
    const spec = this.node.data.spec.retrieval ?? defaultRetrieval("memory");
    for (const rec of mem.records) rec.meta = { created: rec.ts, last_accessed: rec.recalled ?? rec.ts, importance: 1, ...(rec.meta ?? {}) };
    const r = await new Retriever(this.rc, agent).run(spec, query, { docs: async () => mem.records }, { override: edge?.binding?.read?.retrieval, topK: edge?.binding?.read?.top_k });
    if (r.hits.length) {
      const ids = new Set(r.hits.map((h) => h.id));
      // onto the file as it is now: a write may have saved while the retrieval awaited (read and save, no await between)
      const now = this.load(agent);
      for (const rec of now.records)
        if (ids.has(rec.id)) {
          rec.recalled = Date.now();
          rec.meta = { ...(rec.meta ?? {}), last_accessed: rec.recalled };
        }
      this.save(agent, now);
    }
    return { text: r.text, count: r.hits.length };
  }

  /** The memory policy on one turn (one agent's writes queued, see serial). */
  async write(agent: string, turnText: string, extractOverride?: import("@/model/types").FunctionSpec | null) {
    return this.serial(agent, () => this.writeNow(agent, turnText, extractOverride));
  }

  private async writeNow(agent: string, turnText: string, extractOverride?: import("@/model/types").FunctionSpec | null) {
    const pol = this.policy;
    const rc = this.rc;
    // extract
    let facts: { text: string; type?: string }[];
    const helpers = { retrieve: async (q: unknown) => (await this.search(agent, typeof q === "string" ? q : JSON.stringify(q))).text.split("\n").filter(Boolean) };
    const fn = (f: import("@/model/types").FunctionSpec, input: unknown, named: Record<string, unknown>) => runFn(f, input, rc, { node: agent, named, helpers });
    if (extractOverride) facts = toFacts(await fn(extractOverride, turnText, { turn: turnText }));
    else if (pol.extract.use === "custom") facts = toFacts(await fn(pol.extract.fn!, turnText, { turn: turnText }));
    else if (pol.extract.use === "whole_turn") facts = [{ text: turnText }];
    else if (pol.extract.use === "rules") {
      const pats = String(p(pol.extract, "patterns") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      facts = pats.flatMap((pat) => [...turnText.matchAll(new RegExp(pat, "gi"))].map((m) => ({ text: m[0] })));
    } else facts = lines(await llmCall(rc, this.id, `${p(pol.extract, "prompt") ?? "List durable facts from this turn, one per line."} Reply "none" if there are none.\n\n${turnText}`, model(pol.extract))).map((text) => ({ text }));
    if (!facts.length) return { extracted: 0, added: 0, updated: 0, known: 0 };

    const mem = this.load(agent);
    let added = 0;
    let updated = 0;
    let known = 0;
    for (const f of facts) {
      // classify
      let type = f.type ?? "fact";
      const now = Date.now();
      const meta: Record<string, unknown> = { created: now, last_accessed: now, importance: 1 };
      if (pol.classify.use === "custom") type = String(await fn(pol.classify.fn!, { text: f.text, meta }, { record: { text: f.text, meta } })).trim();
      else if (pol.classify.use === "llm") {
        const types = String(p(pol.classify, "types") ?? "event, fact, profile");
        type = (await llmCall(rc, this.id, `Classify this memory as one of: ${types}. Reply with the type only.\n\n${f.text}`, model(pol.classify))).trim().toLowerCase().split(/\s/)[0] || type;
      }
      // a numeric class is an importance score (Generative Agents style)
      if (/^\d+(\.\d+)?$/.test(type)) {
        meta.importance = Number(type);
        type = "fact";
      }
      const rec: Rec = { id: uid(), text: f.text, type, ts: now, strength: 1, meta };
      // merge
      const sims = mem.records.map((r) => ({ r, s: jaccard(r.text, rec.text) })).sort((a, b) => b.s - a.s);
      if (pol.merge.use === "custom") {
        const similar = sims.slice(0, 5).map((x) => x.r);
        const d = (await fn(pol.merge.fn!, rec, { record: rec, similar })) as { action: string; record?: Rec } | null;
        if (d?.action === "skip") {
          known++;
          continue;
        }
        if (d?.action === "update" && d.record?.id) {
          const i = mem.records.findIndex((r) => r.id === d.record!.id);
          if (i >= 0) mem.records[i] = { ...mem.records[i], ...d.record, ts: Date.now() };
          updated++;
          continue;
        }
      } else if (pol.merge.use === "dedupe") {
        if (sims[0] && sims[0].s >= Number(p(pol.merge, "similarity") ?? 0.92)) {
          known++;
          continue;
        }
      } else if (pol.merge.use === "llm_resolve") {
        const close = sims.filter((x) => x.s >= Number(p(pol.merge, "similarity") ?? 0.8) * 0.5).slice(0, 5);
        if (close.length) {
          const out = await llmCall(rc, this.id, `New memory: "${rec.text}"\nExisting:\n${close.map((x, i) => `[${i}] ${x.r.text}`).join("\n")}\nReply ADD, SKIP, or UPDATE <index>: <merged text>.`, model(pol.merge));
          if (/^\s*SKIP/i.test(out)) {
            known++;
            continue;
          }
          const up = /UPDATE\s*\[?(\d+)\]?\s*:\s*(.+)/i.exec(out);
          if (up && close[Number(up[1])]) {
            Object.assign(close[Number(up[1])].r, { text: up[2].trim(), ts: Date.now(), strength: 1 });
            updated++;
            continue;
          }
        }
      }
      mem.records.push(rec);
      added++;
    }
    mem.since_consolidate += added;
    mem.records = this.retain(mem.records);
    await this.consolidate(agent, mem);
    this.save(agent, mem);
    return { extracted: facts.length, added, updated, known };
  }

  private retain(recs: Rec[]): Rec[] {
    const s = this.policy.retain;
    const now = Date.now();
    switch (s.use) {
      case "ttl":
        return recs.filter((r) => now - r.ts < Number(p(s, "days") ?? 90) * 86400_000);
      case "decay": {
        const half = Number(p(s, "half_life_days") ?? 30) * 86400_000;
        const min = Number(p(s, "min_strength") ?? 0.1);
        return recs.filter((r) => 0.5 ** ((now - Math.max(r.ts, r.recalled ?? 0)) / half) >= min);
      }
      case "cap":
        return recs.slice(-Number(p(s, "max") ?? 1000));
      default:
        return recs;
    }
  }

  private async consolidate(agent: string, mem: MemFile) {
    const s = this.policy.consolidate;
    if (s.use === "reflect" && mem.since_consolidate >= Number(p(s, "every_n") ?? 50)) {
      const recent = mem.records.slice(-Number(p(s, "every_n") ?? 50));
      const out = await llmCall(this.rc, this.id, `What 1-3 high-level insights follow from these memories? One per line.\n\n${recent.map((r) => `- ${r.text}`).join("\n")}`, model(s));
      for (const text of lines(out)) mem.records.push({ id: uid(), text, type: "reflection", ts: Date.now(), strength: 1 });
      mem.since_consolidate = 0;
      this.rc.emit({ type: "transform", at: agent, label: `reflect · ${this.node.data.name}`, detail: "insights added" });
    } else if (s.use === "summarize") {
      const cutoff = Date.now() - Number(p(s, "older_than_days") ?? 7) * 86400_000;
      const old = mem.records.filter((r) => r.ts < cutoff && r.type !== "summary");
      if (old.length >= 5) {
        const text = await llmCall(this.rc, this.id, `Summarise these memories in a short paragraph:\n\n${old.map((r) => `- ${r.text}`).join("\n")}`, model(s));
        const ids = new Set(old.map((r) => r.id));
        mem.records = [...mem.records.filter((r) => !ids.has(r.id)), { id: uid(), text, type: "summary", ts: Date.now(), strength: 1 }];
      }
    } else if (s.use === "custom" && s.fn) {
      const helpers = { retrieve: async (q: unknown) => (await this.search(agent, typeof q === "string" ? q : JSON.stringify(q))).text.split("\n").filter(Boolean) };
      const out = await runFn(s.fn, mem.records, this.rc, { node: agent, named: { records: mem.records }, helpers });
      if (Array.isArray(out)) mem.records = out as Rec[];
    }
  }

  async tools(edge: SysEdge): Promise<RtTool[]> {
    const all: RtTool[] = [
      { name: "memory_search", description: "Search remembered facts", input_schema: schema({ query: S }), effect: "read", source: this.id, run: async (a, c) => (await this.search(c.node, String(a.query ?? ""), edge)).text || "No matching memories." },
      { name: "memory_write", description: "Remember a fact for later", input_schema: schema({ text: S }), effect: "write", source: this.id, run: (a, c) =>
        this.serial(c.node, async () => {
          const mem = this.load(c.node);
          mem.records.push({ id: uid(), text: String(a.text ?? ""), type: "fact", ts: Date.now(), strength: 1 });
          this.save(c.node, mem);
          return "Remembered.";
        }) },
    ];
    const declared = new Set(this.node.data.spec.tools.map((t) => t.name));
    return all.filter((t) => declared.has(t.name) && (edge.access !== "read" || t.effect === "read"));
  }

  async beforeTurn(turn: { node: string; input: string; edge: SysEdge }) {
    const r = await this.search(turn.node, turn.input, turn.edge);
    return r.count ? `Relevant memories (${this.node.data.name}):\n${r.text}` : null;
  }

  async afterTurn(turn: TurnInfo) {
    const r = await this.write(turn.node, `Input: ${turn.input}\nReply: ${turn.output}`, turn.binding.write?.extract);
    // say what the policy did even when it stored nothing, so its work (and cost) is never invisible
    const parts = [`${r.extracted} found`, r.added && `${r.added} new`, r.updated && `${r.updated} updated`, r.known && `${r.known} already known`].filter(Boolean);
    this.rc.emit({ type: "transform", at: turn.node, edge: turn.edge.id, label: `remember · ${this.node.data.name}`, detail: parts.join(" · ") });
    return { wrote: r.added + r.updated > 0 };
  }
}

function toFacts(v: unknown): { text: string; type?: string }[] {
  if (v == null) return [];
  if (typeof v === "string") return lines(v).map((text) => ({ text }));
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? { text: x } : { text: String((x as { text?: unknown }).text ?? JSON.stringify(x)), type: (x as { type?: string }).type }));
  return [{ text: JSON.stringify(v) }];
}
