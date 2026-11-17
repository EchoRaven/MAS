import { describe, expect, it } from "vitest";
import { retrievalSummary } from "@/run/describe";
import { simulate } from "@/run/simulate";
import { emptySystem } from "./defaults";
import { migrateDoc } from "./migrate";
import { defaultRetrieval } from "./pipelines";
import { defaultPlugin } from "./plugins";
import { makeStep, STEP_CATALOG } from "./steps";
import { TEMPLATES } from "./templates";
import type { SystemDoc } from "./types";
import { validate } from "./validate";

describe("step registry", () => {
  it("every preset declares defaults that makeStep fills in", () => {
    for (const [slot, options] of Object.entries(STEP_CATALOG)) {
      for (const o of options) {
        const s = makeStep(slot as keyof typeof STEP_CATALOG, o.use);
        expect(Object.keys(s.params ?? {}).sort()).toEqual(o.params.map((p) => p.key).sort());
      }
    }
    expect(makeStep("rerank", "custom").fn?.code).toMatch(/async \(query, hits, ctx\)/);
  });

  it("summarises a pipeline with per-agent overrides", () => {
    const base = defaultRetrieval("knowledge");
    expect(retrievalSummary(base)).toBe("decompose → vector + keyword (bm25) → reciprocal rank → score threshold → rerank model → mmr 5");
    expect(retrievalSummary(base, { rerank: { use: "none" }, select: { use: "top_k", params: { k: 2 } } })).toMatch(/top k 2$/);
  });
});

describe("pipeline validation", () => {
  const withKb = () => {
    const doc = emptySystem();
    const kb = defaultPlugin("knowledge");
    doc.nodes.push({ id: "kb", position: { x: 0, y: 0 }, data: kb });
    return { doc, kb };
  };

  it("accepts the default knowledge pipeline", () => {
    const { doc } = withKb();
    expect(validate(doc).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("flags a chat model used for embeddings and empty custom code", () => {
    const { doc, kb } = withKb();
    kb.spec.retrieval!.search[0].params!.embedding = "sonnet";
    kb.spec.retrieval!.rerank = { use: "custom", fn: { lang: "js", code: "  " } };
    const msgs = validate(doc).map((i) => i.message).join("\n");
    expect(msgs).toMatch(/sonnet is a chat model, embedding needs embedding/);
    expect(msgs).toMatch(/Rerank: custom code is empty/);
  });

  it("flags text-to-SQL without a table allowlist", () => {
    const doc = TEMPLATES.find((t) => t.id === "supervisor")!.build();
    const db = doc.nodes.find((n) => n.id === "sales")!.data;
    if (db.kind === "env" && db.db) db.db.tables = [];
    expect(validate(doc).some((i) => /every table/.test(i.message))).toBe(true);
  });
});

describe("0.2 -> 0.3", () => {
  it("adds embedding / rerank models and gives old knowledge plugins their pipelines", () => {
    const old = { ...emptySystem(), models: emptySystem().models.filter((m) => !m.kind) } as SystemDoc;
    const kb = defaultPlugin("knowledge");
    delete kb.spec.retrieval;
    delete kb.spec.index;
    old.nodes = [{ id: "kb", position: { x: 0, y: 0 }, data: kb }];
    const doc = migrateDoc(old);
    expect(doc.models.map((m) => m.kind ?? "chat")).toEqual(expect.arrayContaining(["embedding", "rerank"]));
    const spec = (doc.nodes[0].data as typeof kb).spec;
    expect(spec.retrieval?.search.length).toBeGreaterThan(0);
    expect(spec.index?.chunk.use).toBe("recursive");
  });
});

describe("simulation of the new pieces", () => {
  it("shows retrieval, reflexion and database tools in the supervisor template", () => {
    const base = TEMPLATES.find((t) => t.id === "supervisor")!.build();
    const all = Array.from({ length: 10 }, (_, i) => simulate({ ...base, id: `s${i}` }).events).flat();
    const labels = all.filter((e) => e.type === "transform").map((e) => (e.type === "transform" ? e.label : ""));
    expect(labels.some((l) => l.startsWith("retrieve · Company wiki"))).toBe(true);
    expect(labels.some((l) => l.startsWith("critique"))).toBe(true);
    expect(all.some((e) => e.type === "tool" && e.tool === "ask_database")).toBe(true);
  });
});
