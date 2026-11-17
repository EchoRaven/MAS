import { describe, expect, it } from "vitest";
import { simulate } from "@/run/simulate";
import { TEMPLATES } from "../templates";
import { PAPER_TEMPLATES } from ".";

const calls = (id: string) => {
  const t = PAPER_TEMPLATES.find((x) => x.id === id)!;
  return simulate({ ...t.build(), id: "fixed" }).events.filter((e) => e.type === "usage").length;
};

describe("paper reproductions", () => {
  it("every one cites its paper and says how it maps and where it differs", () => {
    for (const t of PAPER_TEMPLATES) {
      // a scholarly source: arXiv, or bioRxiv / a DOI / the journal for papers that are not on arXiv
      expect(t.paper?.url).toMatch(/^https:\/\/(arxiv\.org\/abs\/|www\.biorxiv\.org\/content\/10\.|doi\.org\/10\.|www\.nature\.com\/articles\/|aclanthology\.org\/)/);
      expect(t.notes?.mapped.length).toBeGreaterThan(0);
      expect(t.notes?.differs.length).toBeGreaterThan(0);
    }
    expect(TEMPLATES.filter((t) => t.paper)).toHaveLength(PAPER_TEMPLATES.length);
  });

  it("Mixture-of-Agents waits for every proposer: 3 + 3 + 1 model calls", () => {
    expect(calls("paper-moa")).toBe(7);
  });

  it("the debate runs three debaters for two rounds", () => {
    expect(calls("paper-debate")).toBe(6);
  });

  it("ChatEval's referees are chained by full handoffs, so each one reads the whole debate", () => {
    const doc = PAPER_TEMPLATES.find((x) => x.id === "paper-chateval")!.build();
    const chained = doc.edges.filter((e) => e.kind === "handoff" && e.carry === "full");
    // referee -> referee -> referee -> out of the panel
    expect(chained).toHaveLength(3);
    expect(chained.map((e) => e.target)).toEqual(["critic", "scientist", "panel"]);
  });

  it("every repair loop has a stop condition, not just a round cap", () => {
    for (const id of ["paper-agentcoder", "paper-mapcoder", "paper-agentverse"]) {
      const doc = PAPER_TEMPLATES.find((x) => x.id === id)!.build();
      const loops = doc.nodes.filter((n) => n.data.kind === "group" && n.data.iterate);
      expect(loops.length, id).toBeGreaterThan(0);
      for (const g of loops) expect((g.data as { iterate: { until?: string | null } }).iterate.until, `${id} / ${g.id}`).toBeTruthy();
    }
  });

  it("Voyager's skill library takes only programs the critic verified", () => {
    const doc = PAPER_TEMPLATES.find((x) => x.id === "paper-voyager")!.build();
    const code = doc.edges.find((e) => e.target === "skills")!.binding!.write!.extract!.code;
    const extract = new Function("input", code) as (s: string) => unknown;
    expect(extract("Input: SUCCESS\ndef mean(xs): return sum(xs) / len(xs)\nReply: Next, compute the median.")).toEqual([{ text: "def mean(xs): return sum(xs) / len(xs)", type: "skill" }]);
    expect(extract("Input: The output is wrong: it divides by zero.\nReply: Try again.")).toEqual([]);
    // the curriculum's two ways out are mutually exclusive
    const out = doc.edges.filter((e) => e.source === "curriculum" && e.kind === "message");
    expect(out.map((e) => e.filter)).toEqual(['!text.includes("GOAL REACHED")', 'text.includes("GOAL REACHED")']);
  });

  it("role-play and phase groups loop and stop", () => {
    for (const id of ["paper-camel", "paper-chatdev"]) {
      const ev = simulate({ ...PAPER_TEMPLATES.find((x) => x.id === id)!.build(), id: "fixed" }).events;
      expect(ev.some((e) => e.type === "transform" && e.label === "rounds done")).toBe(true);
    }
  });
});
