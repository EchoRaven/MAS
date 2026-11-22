import { finalAnswer } from "@/run/evals";
import { describe, expect, it } from "vitest";
import { simulate } from "@/run/simulate";
import { TEMPLATES } from "../templates";
import { PAPER_TEMPLATES } from ".";
import { MEASURED } from "./measured";

const calls = (id: string) => {
  const t = PAPER_TEMPLATES.find((x) => x.id === id)!;
  return simulate({ ...t.build(), id: "fixed" }).events.filter((e) => e.type === "usage").length;
};

describe("paper reproductions", () => {
  it("every one cites its paper and says how it maps and where it differs", () => {
    for (const t of PAPER_TEMPLATES) {
      // a scholarly source: arXiv, or bioRxiv / a DOI / the journal or proceedings for papers that are not on arXiv
      expect(t.paper?.url).toMatch(/^https:\/\/(arxiv\.org\/abs\/|www\.biorxiv\.org\/content\/10\.|doi\.org\/10\.|www\.nature\.com\/articles\/|aclanthology\.org\/|proceedings\.iclr\.cc\/)/);
      expect(t.notes?.mapped.length).toBeGreaterThan(0);
      expect(t.notes?.differs.length).toBeGreaterThan(0);
    }
    expect(TEMPLATES.filter((t) => t.paper)).toHaveLength(PAPER_TEMPLATES.length);
  });

  it("Mixture-of-Agents waits for every proposer: 3 + 3 + 1 model calls", () => {
    expect(calls("paper-moa")).toBe(7);
  });

  it("Agent Forest samples its model N times in one component (10 by default), then votes", () => {
    expect(calls("paper-agent-forest")).toBe(10);
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

  it("MedAgents' decision ends with the answer, so graders read the letter and not the reasoning", () => {
    // it once gave the answer first and a sentence of why last: 0 of 57 MMLU questions graded right
    const doc = PAPER_TEMPLATES.find((x) => x.id === "paper-medagents")!.build();
    const decider = doc.nodes.find((n) => n.id === "decider")!.data as { harness: { instructions: string } };
    expect(decider.harness.instructions).toMatch(/last line 'Answer: X'/);
    expect(finalAnswer("The report agrees the coronal suture joins frontal and parietal bones.\nAnswer: A")).toBe("A");
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

  // Function code lives in template strings, where one escape too many turns \s into a literal backslash and a guard
  // silently never fires: compile every function, and run the loop templates' guards on scripted replies.
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (...x: unknown[]) => Promise<unknown>;
  const fnCode = (id: string) => {
    const doc = TEMPLATES.find((t) => t.id === id)!.build();
    return Object.values(doc.nodes as unknown as Record<string, { data?: { fn?: { code: string } }; fn?: { code: string } }>).map((n) => n.data?.fn?.code ?? n.fn?.code).find(Boolean)!;
  };
  const script = (replies: string[], tool?: (name: string, a: { content?: string }) => Promise<string>) => {
    let n = 0;
    const seen: string[] = [];
    const logs: string[] = [];
    return { seen, logs, ctx: { vars: {}, log: (m: string) => logs.push(m), tool: tool ?? (async () => ""), call: async (_who: string, text: string) => (seen.push(text), replies[n++] ?? "") } };
  };

  it("every template's JS compiles (functions, hooks, loops, extractors)", () => {
    let n = 0;
    const walk = (o: unknown, id: string) => {
      if (!o || typeof o !== "object") return;
      const c = o as { lang?: string; code?: unknown };
      if (c.lang === "js" && typeof c.code === "string") {
        // as the sandbox runs it: a single expression without return is wrapped
        const body = /\breturn\b/.test(c.code) || c.code.includes(";") || c.code.includes("\n") ? c.code : `return (${c.code});`;
        expect(() => new AsyncFn("input", "ctx", body), id).not.toThrow();
        n++;
      }
      for (const v of Object.values(o)) walk(v, id);
    };
    for (const t of TEMPLATES) walk(t.build(), t.id);
    expect(n).toBeGreaterThan(50);
  });

  it("CRITIC shows the critic the code without comment lines and the execution, and stops when the result holds twice", async () => {
    let file = "";
    const s = script(["```python\n# compute\nanswer = 12\n```", "Wrong: +1.", "answer = 13\n```", "Fine.", "answer = 13\n```", "Fine.", "answer = 13\n```"], async (name, a) => {
      if (name === "edit_file") return (file = a.content ?? ""), "ok";
      return "__ANSWER__=" + /answer = (\d+)/.exec(file)![1];
    });
    const out = String(await new AsyncFn("input", "ctx", fnCode("paper-critic"))({ text: "3*4+1?" }, s.ctx));
    expect(out).toMatch(/Answer: 13$/);
    expect(s.seen[1]).not.toContain("# compute");
    expect(s.seen[1]).toContain("Execution: Done\nOutput: answer = 12");
    expect(s.seen[2].endsWith("Here's a better solution:\n```python\n")).toBe(true);
    expect(s.logs).toContain("answers by correction: 12 → 13 → 13 → 13");
  });

  it("intrinsic self-correction keeps only the model's own turn, and logs every round's boxed answer", async () => {
    const s = script(["work \\boxed{12}", "Problem: step 2.\n\n[User]\ninvented turn", "\\boxed{\\frac{26}{2}}", "fine", "\\boxed{13}"]);
    expect(await new AsyncFn("input", "ctx", fnCode("paper-self-correct"))({ text: "q" }, s.ctx)).toBe("\\boxed{13}");
    expect(s.seen[2]).toContain("Problem: step 2.");
    expect(s.seen[2]).not.toContain("invented turn");
    expect(s.logs).toContain("answers by round: 12 → \\frac{26}{2} → 13");
  });

  it("Meta-Prompting keeps the conductor's own message when it copies the conversation, and answers from FINAL ANSWER", async () => {
    const s = script(['[User]\ncopied…\n\n[Meta-Expert]\nExpert Linguist:\n"""\nsort b a\n"""', '>> FINAL ANSWER:\n"""\na b\n"""\n[User]\nthanks']);
    const expertGot: string[] = [];
    const call = s.ctx.call;
    s.ctx.call = async (who: string, text: string) => (who === "Expert" ? (expertGot.push(text), "a b") : call(who, text));
    expect(await new AsyncFn("input", "ctx", fnCode("paper-meta-prompting"))({ text: "sort b a" }, s.ctx)).toBe("Answer: a b");
    expect(expertGot).toEqual(["sort b a"]);
    expect(s.seen[1]).not.toContain("copied…");
  });

  it("every measurement belongs to a template, and reaches it", () => {
    for (const id of Object.keys(MEASURED)) {
      const t = PAPER_TEMPLATES.find((x) => x.id === id);
      expect(t, id).toBeTruthy();
      expect(t!.notes?.measured, id).toEqual(MEASURED[id]);
    }
  });
});
