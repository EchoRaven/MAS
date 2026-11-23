import { describe, expect, it } from "vitest";
import { answerTrail, trailStats, boxedContent, caseSetId, poolRuns, reachedBy, repeatStats, retryableCase, wilson, etaSeconds, failureReasons, finalAnswer, gradeByRule, mcnemarP, pairedDiff, parseCases, parseNumber, SAMPLE_SETS } from "./evals";

describe("grading", () => {
  it("finds the final answer: the last Answer/Final line, else the last line", () => {
    expect(finalAnswer("Reasoning…\nAnswer: 1/3\nConfidence: 0.9")).toBe("1/3");
    expect(finalAnswer("first\nFinal: 12\nmore\n**Final Answer:** 13")).toBe("13");
    expect(finalAnswer("work…\n\n**Final Answer:**\nThere are **3,600** ways for 8 people.")).toBe("There are **3,600** ways for 8 people.");
    expect(finalAnswer("B. Hyperkalaemia\n\nbecause potassium")).toBe("because potassium");
    // an answer given as a list, one item a line, is the whole list
    expect(finalAnswer("Answer: 1. devour\n2. elder\n3. elms")).toBe("devour elder elms");
    expect(finalAnswer("**Final Answer:**\n- apple\n- banana\n\nThat is all.")).toBe("apple banana");
    expect(finalAnswer("Answer: 1. The total is 42\nbecause …")).toBe("1. The total is 42");
    expect(gradeByRule("answer", "Answer: 1. devour\n2. elder\n3. elms", "devour elder elms").pass).toBe(true);
    expect(finalAnswer("")).toBe("");
  });

  it("reads numbers the way answers write them", () => {
    expect(parseNumber("the ball costs $0.05")).toBe(0.05);
    expect(parseNumber("1,234 apples")).toBe(1234);
    expect(parseNumber("1/3")).toBeCloseTo(1 / 3);
    expect(parseNumber("40%")).toBe(0.4);
    expect(parseNumber("no digits")).toBeNull();
  });

  it("grades by number, answer, option letter and containment", () => {
    expect(gradeByRule("number", "so it is\nAnswer: 48", "48").pass).toBe(true);
    expect(gradeByRule("number", "Answer: 0.333333333", "1/3").pass).toBe(true);
    expect(gradeByRule("number", "Answer: 0.33", "1/3").pass).toBe(false);
    expect(gradeByRule("number", "Answer: 1/3", "0.3333333333333").pass).toBe(true);
    expect(gradeByRule("number", "Answer: 2 m/s", "1.5").why).toBe("2 ≠ 1.5");
    // a currency sign between the minus and the digits (GSM-Hard's negative balances)
    expect(gradeByRule("number", "Final: -$70,145,984", "-70145984").pass).toBe(true);
    expect(gradeByRule("number", "Final: $-5.50", "-5.5").pass).toBe(true);
    expect(gradeByRule("number", "Final: $70", "-70").pass).toBe(false);
    // a percentage answers an expected value written as the percent (GSM8K "What percent…? #### 40") or as a fraction
    // AutoGen's stop word after the answer is not the answer
    expect(gradeByRule("answer", "The capital is checked.\nParis\n\nTERMINATE", "Paris").pass).toBe(true);
    expect(gradeByRule("number", "The sum of the digits is 155. TERMINATE", "155").answer).toBe("The sum of the digits is 155.");
    expect(gradeByRule("number", "Final: 40%", "40").pass).toBe(true);
    expect(gradeByRule("number", "Final: 40%", "0.4").pass).toBe(true);
    expect(gradeByRule("number", "Final: 40%", "40%").pass).toBe(true);
    expect(gradeByRule("number", "Final: 40%", "4").pass).toBe(false);
    expect(gradeByRule("number", "Final: 40", "0.4").pass).toBe(false);
    expect(gradeByRule("answer", "Answer: **Paris.**", "paris").pass).toBe(true);
    // real outputs that a last-number rule got wrong
    expect(gradeByRule("number", "…\n**Final Answer:**\nThere are **3,600** ways for 8 people to sit.", "3600").pass).toBe(true);
    expect(gradeByRule("number", "Summing: 1 + 12 + 36 = 49\n\nThere are **49 ways** to make 50 cents.", "49").pass).toBe(true);
    expect(gradeByRule("number", "There are 54 three-digit numbers whose digits add up to 10.", "54").pass).toBe(true);
    expect(gradeByRule("number", "The final answer is $\\boxed{9368}$.", "9368").pass).toBe(true);
    // LaTeX the way models write it (found in review)
    expect(gradeByRule("number", "Final: $\\boxed{\\frac{1}{221}}$", "1/221").pass).toBe(true);
    expect(gradeByRule("number", "Final: $\\boxed{1{,}098{,}240}$", "1098240").pass).toBe(true);
    expect(gradeByRule("number", "Final: \u22125", "-5").pass).toBe(true);
    expect(gradeByRule("answer", "Final: $\\boxed{\\text{B}}$", "B").pass).toBe(true);
    expect(boxedContent("so \\boxed{2} then \\boxed{\\frac{3}{4}} done")).toBe("\\frac{3}{4}");
    expect(boxedContent("\\boxed{unclosed")).toBeNull();
    // the box wins over other numbers: here the fallback would read 3
    expect(gradeByRule("number", "With 3 cases left, $\\boxed{12}$", "12").pass).toBe(true);
    // a whole sentence in bold: the number the question already has (2, 50) is not the answer
    expect(gradeByRule("number", "**The sum of the decimal digits of $2^{50}$ is 76.**", "76", "What is the sum of the decimal digits of 2^50?").pass).toBe(true);
    expect(gradeByRule("number", "It takes 5 minutes for 100 machines.", "5", "If 5 machines take 5 minutes to make 5 widgets, how long for 100 machines and 100 widgets?").pass).toBe(true);
    expect(gradeByRule("number", "A 2 × 12 strip can be tiled in 233 ways.", "233", "In how many ways can a 2 × 12 strip be tiled with 1 × 2 dominoes?").pass).toBe(true);
    expect(gradeByRule("answer", "Answer: B. Hyperkalaemia", "B").pass).toBe(true);
    expect(gradeByRule("answer", "Answer: Because of B", "B").pass).toBe(false);
    expect(gradeByRule("contains", "It is hyperkalaemia, clearly.", "Hyperkalaemia").pass).toBe(true);
  });
});

describe("number answers", () => {
  it("reads a sum's result and a number word", () => {
    const n = (out: string, want: string) => gradeByRule("number", out, want, "How many letters?").pass;
    expect(n("Total: **3 + 0 + 1 + 0 + 1 + 0 + 0 + 0 + 1 = 6**", "6")).toBe(true);
    expect(n("Answer: 66967 days (= 183 years)", "66967")).toBe(true);
    expect(n("Answer: one", "1")).toBe(true);
    expect(n("Answer: none of them", "1")).toBe(false);
    // a document after the question does not count as numbers the question gave
    const doc = "How many dollars did order 12529 pay?\n---\n" + "2024-01-02 | order 12529 | customer Ashby | lamp | paid $801\n".repeat(3);
    expect(gradeByRule("number", "Order 12529 paid $801.", "801", doc).pass).toBe(true);
    // a last line in parentheses is an aside, not the answer
    expect(gradeByRule("number", "The total for Corrigan is 6604.\n\n(Calculation: 392 + 560 + 507 = 6604. Corrigen was excluded.)", "6604", "What did Corrigan pay?").pass).toBe(true);
  });
});

describe("math answers", () => {
  it("reads intervals, sets, matrices and decimals as MATH's answer key writes them", () => {
    const m = (got: string, want: string) => gradeByRule("math", `Answer: ${got}`, want).pass;
    expect(m("3 < \\lambda \\le 4", "(3,4]")).toBe(true);
    expect(m("3 \\le x < 4", "(3,4]")).toBe(false);
    expect(m("\\{-2, 1+\\sqrt{5}, 1-\\sqrt{5}\\}", "\\{1\\pm\\sqrt{5},-2\\}")).toBe(true);
    expect(m("3+2\\sqrt{2}, 3-2\\sqrt{2}, -3+2\\sqrt{2}, -3-2\\sqrt{2}", "3 \\pm 2 \\sqrt{2}")).toBe(false);
    expect(m("\\begin{pmatrix} 0.2 \\\\ -3.6 \\end{pmatrix}", "\\begin{pmatrix} 1/5 \\\\ -18/5 \\end{pmatrix}")).toBe(true);
    expect(m("\\begin{pmatrix} -3.6 \\\\ 0.2 \\end{pmatrix}", "\\begin{pmatrix} 1/5 \\\\ -18/5 \\end{pmatrix}")).toBe(false);
    expect(m("0.25", "\\frac14")).toBe(true);
    expect(m("2\\sqrt{3}+1", "1+2\\sqrt{3}")).toBe(true);
    expect(m("2\\sqrt{3}-1", "1-2\\sqrt{3}")).toBe(false);
    expect(m("x^{-1}+2", "2+x^{-1}")).toBe(true);
    expect(m("\\frac{9a+11}{20}", "\\frac{11+9a}{20}")).toBe(true);
    expect(m("\\frac{9a+11}{20}", "\\frac{9a-11}{20}")).toBe(false);
    expect(m("864", "864 \\mbox{ inches}^2")).toBe(true);
    expect(m("2516", "2516_8")).toBe(true);
    expect(m("E", "\\text{(E)}")).toBe(true);
    expect(m("D", "\\text{(E)}")).toBe(false);
    expect(m("0.2", "2")).toBe(false);
  });

  const g = (out: string, exp: string) => gradeByRule("math", out, exp).pass;
  it("compares answers after the MATH benchmark's normalisation", () => {
    expect(g("so the answer is $\\boxed{\\dfrac{14}{3}}$.", "\\frac{14}{3}")).toBe(true);
    expect(g("\\boxed{\\left( 3, \\frac{\\pi}{2} \\right)}", "\\left( 3, \\frac{\\pi}{2} \\right)")).toBe(true);
    expect(g("\\boxed{90^\\circ}", "90^\\circ")).toBe(true);
    expect(g("\\boxed{90}", "90^\\circ")).toBe(true);
    expect(g("\\boxed{\\text{Evelyn}}", "\\text{Evelyn}")).toBe(true);
    expect(g("\\boxed{x = 5}", "5")).toBe(true);
    expect(g("\\boxed{\\frac12}", "\\frac{1}{2}")).toBe(true);
    expect(g("\\boxed{0.5}", "\\frac{1}{2}")).toBe(true);
    expect(g("Final: 1,000", "1000")).toBe(true);
    expect(g("\\boxed{p-q}", "p - q")).toBe(true);
    // forms models write that MATH's answer key writes differently
    expect(g("\\boxed{4/3}", "\\frac43")).toBe(true);
    expect(g("\\boxed{3\\sqrt{3}/4}", "\\frac{3\\sqrt{3}}{4}")).toBe(true);
    expect(g("\\boxed{1+\\sqrt{19}, 1-\\sqrt{19}}", "1 \\pm \\sqrt{19}")).toBe(true);
    expect(g("\\boxed{3, 1, 2}", "1,2,3")).toBe(true);
    expect(g("\\boxed{1+\\sqrt{19}}", "1 \\pm \\sqrt{19}")).toBe(false);
    expect(g("\\boxed{3, 1}", "1,2,3")).toBe(false);
    expect(g("\\boxed{3/5}", "\\frac{4}{5}")).toBe(false);
    expect(g("\\boxed{270/7}", "\\frac{270}7\\text{ degrees}")).toBe(true);
    expect(g("\\boxed{\\text{Evelyn}}", "\\text{Evelyn}")).toBe(true);
    expect(g("\\boxed{\\frac{14}{5}}", "\\frac{14}{3}")).toBe(false);
    expect(g("\\boxed{(3, \\pi)}", "\\left( 3, \\frac{\\pi}{2} \\right)")).toBe(false);
  });
});

describe("pooling the runs of one setup", () => {
  it("numbers a later evaluation's runs after the earlier one's and adds the counts", () => {
    const rec = (id: string, at: string, passes: boolean[][]) => ({
      id, system_id: "s", system_name: "S", grader: "number" as const, mock: false, status: "finished" as const, started_at: at,
      cases: passes.flatMap((run, r) => run.map((p, i) => ({ case: i, repeat: r, input: `q${i}`, expected: "1", status: "done" as const, pass: p, usd: 0.01 }))),
      passed: passes.flat().filter(Boolean).length, graded: passes.flat().length, usd: passes.flat().length * 0.01,
    });
    const first = rec("e1", "2026-11-18T00:00:00Z", [[true, false]]);
    const second = rec("e2", "2026-11-20T00:00:00Z", [[true, true], [false, true]]);
    const p = poolRuns([second, first]);
    expect(p.cases.map((c) => `${c.case}/${c.repeat}`)).toEqual(["0/0", "1/0", "0/1", "1/1", "0/2", "1/2"]);
    expect([p.repeats, p.passed, p.graded]).toEqual([3, 4, 6]);
    expect(p.id).toBe("pool:e1,e2");
    expect(repeatStats(p).per.length).toBe(3);
  });
});

describe("the interval of an accuracy", () => {
  it("is wide on 30 questions and narrows with more", () => {
    const [lo, hi] = wilson(19, 30);
    expect([Math.round(lo * 100), Math.round(hi * 100)]).toEqual([46, 78]);
    const [lo2, hi2] = wilson(190, 300);
    expect(hi2 - lo2).toBeLessThan((hi - lo) / 2.5);
    expect(wilson(30, 30)[1]).toBe(1);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});

describe("what a retry runs again", () => {
  it("includes an output the log cut before its answer, and not a plain wrong answer", () => {
    expect(retryableCase({ status: "done", pass: false, why: "0 ≠ 13", output: "thinking… (18381 more chars)" })).toBe(true);
    expect(retryableCase({ status: "done", pass: true, why: "157 = 157", output: "157 mod 10 is not r… (17187 more chars)" })).toBe(true);
    expect(retryableCase({ status: "done", pass: false, why: "12 ≠ 13", output: "Answer: 12" })).toBe(false);
    expect(retryableCase({ status: "done", pass: false, why: "no output (finished: All idle)" })).toBe(true);
  });
});

describe("who had the answer", () => {
  const nameOf = (id: string) => ({ a: "Alice", b: "Bob" } as Record<string, string>)[id] ?? null;
  it("counts only members that marked the right answer, item by item in a list", () => {
    const msgs = [
      { from: "me", text: "Final: 42" }, // not a member
      { from: "a", text: "I tried 42 once but\nFinal: 41" },
      { from: "b", text: JSON.stringify(["Final: 40", "steps…\nFinal: 42"]) },
    ];
    expect(reachedBy(msgs, nameOf, "number", "42")).toEqual(["Bob"]);
    // a list cut short in the log still counts the items before the cut
    const cut = JSON.stringify(["work \"quoted\"\nFinal: 42", "more work\nFinal: 40"]).slice(0, -8);
    expect(reachedBy([{ from: "a", text: cut }], nameOf, "number", "42")).toEqual(["Alice"]);
    expect(reachedBy([{ from: "a", text: cut }], nameOf, "number", "40")).toEqual([]);
    // a number in passing, with no answer line, does not count
    expect(reachedBy([{ from: "a", text: "42 is close" }], nameOf, "number", "42")).toEqual([]);
    // graders it cannot apply to a message say nothing
    expect(reachedBy(msgs, nameOf, "contains", "42")).toEqual([]);
  });
  it("says why a run ended without an answer", () => {
    const r = failureReasons([
      { pass: false, status: "done", why: "no output (finished: Round limit reached)" },
      { pass: false, status: "done", why: "no output (finished: Round limit reached)" },
      { pass: false, status: "done", why: "no output: google 503: overloaded" },
      { pass: false, status: "done", why: "no output: Solo's reply stopped at the output limit (16380 tokens), with nothing usable in it: raise …" },
    ]);
    expect(r.map((x) => `${x.count} ${x.reason}`)).toEqual(["2 no output: round limit reached", "1 no output", "1 no output: reply cut at the output limit"]);
  });
  it("groups the misses a member had under their own reason", () => {
    const r = failureReasons([
      { pass: false, status: "done", why: "0 ≠ 7", reached: ["Solver"] },
      { pass: false, status: "done", why: "0 ≠ 6", reached: [] },
    ]);
    expect(r.map((x) => x.reason).sort()).toEqual(["a member had it, the team lost it", "wrong answer"]);
  });
});

describe("failure reasons", () => {
  it("a sentence where a letter was expected is its own reason: the system gave no answer line", () => {
    const r = failureReasons([
      { pass: false, status: "done", why: '"The report concludes that the epigastric region lies below the xiphoid process." is not "A"' },
      { pass: false, status: "done", why: '"B" is not "C"' },
      { pass: false, status: "done", why: '"The answer is long but the key is long too, so this is a plain mismatch" is not "the capital of France is Paris"' },
    ]);
    expect(r.map((x) => [x.reason, x.count])).toEqual([["wrong answer", 2], ["a sentence, not an answer: no final answer line", 1]]);
  });

  it("groups failures by their kind, not their details, largest first", () => {
    const cases = [
      { pass: false, status: "done", why: "tests fail: AssertionError" },
      { pass: true, status: "done", why: "155 = 155" },
      { pass: false, status: "done", why: "tests fail: AssertionError: ('', 'abc')" },
      { pass: false, status: "done", why: "800 ≠ 165" },
      { pass: false, status: "done", why: "no output (finished: All idle (no output))" },
      { pass: false, status: "error", why: "the run asked a person for input; evaluations run unattended" },
      { pass: false, status: "done", why: "tests fail: SyntaxError: invalid syntax" },
      { pass: false, status: "done", why: "timed out after 10s" },
      { pass: false, status: "done", why: "tests fail: AssertionError" },
    ] as const;
    const r = failureReasons(cases as never);
    expect(r[0]).toEqual({ reason: "tests fail: AssertionError", count: 3, cases: [0, 2, 8] });
    expect(r.map((x) => x.reason)).toContain("wrong answer");
    expect(r.map((x) => x.reason)).toContain("no output: all idle");
    expect(r.map((x) => x.reason)).toContain("tests fail: SyntaxError");
    expect(r.map((x) => x.reason)).toContain("timed out");
    expect(r.find((x) => x.reason.startsWith("the run asked a person"))?.count).toBe(1);
    expect(r.reduce((n, x) => n + x.count, 0)).toBe(8);
  });
});

describe("cases from text", () => {
  it("reads 'question | expected', tabs and JSON lines, and counts what it could not read", () => {
    const { cases, skipped } = parseCases('# a comment\nWhat is 2+2? | 4\nA | B | C\nCapital of France?\tParis\n{"question": "1+1", "answer": 2}\nno separator here\n{"input": "x"}');
    expect(cases).toEqual([
      { input: "What is 2+2?", expected: "4" },
      { input: "A | B", expected: "C" },
      { input: "Capital of France?", expected: "Paris" },
      { input: "1+1", expected: "2" },
    ]);
    expect(skipped).toBe(2);
  });

  it("reads a CSV with a header naming the question and answer columns", () => {
    const csv = 'id,question,answer,notes\r\n1,"What is 2+2, roughly?",4,easy\n2,"Say ""hi""",hi,\n3,"A question\nover two lines",x,\n4,,missing,\n';
    const { cases, skipped } = parseCases(csv);
    expect(cases).toEqual([
      { input: "What is 2+2, roughly?", expected: "4" },
      { input: 'Say "hi"', expected: "hi" },
      { input: "A question\nover two lines", expected: "x" },
    ]);
    expect(skipped).toBe(1);
    // a plain "q | a" line with a comma is not mistaken for a CSV
    expect(parseCases("Is 1,000 > 999? | yes").cases).toEqual([{ input: "Is 1,000 > 999?", expected: "yes" }]);
  });

  it("reads GSM8K and MMLU-style records as they come", () => {
    const gsm = JSON.stringify({ question: "Natalia sold clips to 48 friends in April, and half as many in May. How many in all?", answer: "In May she sold 48/2 = <<48/2=24>>24.\nIn all 48+24 = <<48+24=72>>72.\n#### 72" });
    const big = JSON.stringify({ question: "q", answer: "steps\n#### 1,250" });
    const mmlu = JSON.stringify({ question: "What is the capital of France?", subject: "geography", choices: ["Berlin", "Madrid", "Paris", "Rome"], answer: 2 });
    const lettered = JSON.stringify({ question: "Pick one", choices: ["x", "y"], answer: "B" });
    const { cases, skipped } = parseCases([gsm, big, mmlu, lettered].join("\n"));
    expect(skipped).toBe(0);
    expect(cases[0]).toEqual({ input: "Natalia sold clips to 48 friends in April, and half as many in May. How many in all?", expected: "72" });
    expect(cases[1].expected).toBe("1250");
    expect(cases[2]).toEqual({ input: "What is the capital of France?\n\nA) Berlin\nB) Madrid\nC) Paris\nD) Rome\n\nAnswer with the letter of the correct option.", expected: "C" });
    expect(cases[3].expected).toBe("B");
    // and the letter grader accepts the usual ways of answering
    expect(gradeByRule("answer", "The answer is C) Paris.\nAnswer: C", "C").pass).toBe(true);
  });

  it("the sample sets parse completely", () => {
    for (const s of SAMPLE_SETS) expect(parseCases(s.text).skipped, s.name).toBe(0);
  });
});

describe("question sets", () => {
  it("the same questions give the same set id, whatever the order and repeats", () => {
    const a = [{ input: "1+1", expected: "2" }, { input: "2+2", expected: "4" }];
    const b = [a[1], a[0], a[1]];
    expect(caseSetId(a)).toBe(caseSetId(b));
    expect(caseSetId(a)).not.toBe(caseSetId([a[0], { input: "2+2", expected: "5" }]));
    expect(caseSetId(a)).toMatch(/_2$/);
  });
});

describe("paired comparison", () => {
  it("gives the exact McNemar p-value", () => {
    expect(mcnemarP(0, 0)).toBe(1);
    expect(mcnemarP(4, 0)).toBeCloseTo(0.125, 10); // 2 × (1/2)^4
    expect(mcnemarP(1, 10)).toBeCloseTo((2 * (1 + 11)) / 2048, 10); // d = 11: P(X ≤ 1) = 12 / 2^11
    expect(mcnemarP(3, 3)).toBe(1);
    expect(mcnemarP(200, 180)).toBeGreaterThan(0.3); // large counts stay finite
  });

  it("counts fixed and lost questions by their text, with repeats by majority", () => {
    const c = (input: string, pass: boolean, repeat = 0, i = 0) => ({ case: i, repeat, input, expected: "", status: "done" as const, pass });
    const ref = { cases: [c("q1", false, 0, 0), c("q2", true, 0, 1), c("q3", true, 0, 2), c("q4", false, 0, 3), c("q5", true, 0, 4)] };
    // q1: 2 of 3 right → fixed; q2: 1 of 3 → lost; q3 right; q4 wrong; q5 only in ref (not shared)
    const sys = { cases: [c("q2", true, 0, 1), c("q1", true, 0, 0), c("q3", true, 0, 2), c("q4", false, 0, 3), c("q1", true, 1, 0), c("q2", false, 1, 1), c("q1", false, 2, 0), c("q2", false, 2, 1)] };
    expect(pairedDiff(sys, ref)).toEqual({ fixed: [0], lost: [1], both: 1, neither: 1, shared: 4, p: 1 });
  });
});

describe("time left", () => {
  it("is the mean case time, times the cases left, over the cases running at once", () => {
    const c = (status: string, seconds?: number) => ({ case: 0, input: "q", expected: "", status, seconds }) as never;
    expect(etaSeconds({ cases: [c("pending"), c("running")] })).toBeNull();
    // done in 100 s and 200 s on average 150; four left, two running at once: 300 s
    expect(etaSeconds({ cases: [c("done", 100), c("done", 200), c("running"), c("running"), c("pending"), c("pending")] })).toBe(300);
  });
});

describe("sourcedLinks", () => {
  it("counts the cited links its own searches or fetches returned", async () => {
    const { sourcedLinks } = await import("./evals");
    const out = "Text [1] [2] [3].\nReferences\n[1] https://a.example/x.\n[2] https://b.example/y\n[3] https://made.up/z";
    const tools = [
      { tool: "web_search", result: "Sources:\n[1] a.example: https://a.example/x" },
      { tool: "fetch", args: '{"url":"https://b.example/y"}', result: "page" },
      { tool: "ask_expert", result: "https://made.up/z" },
    ];
    expect(sourcedLinks(out, tools)).toEqual({ cited: 3, found: 2, searches: 2 });
  });
});

describe("outputShape", () => {
  it("counts words, headings, list items and whether there is a table", async () => {
    const { outputShape } = await import("./evals");
    expect(outputShape("# Title\n\nSome words here.\n\n- one\n- two\n1. three\n\n| a | b |\n|---|---|")).toEqual({ words: 17, headings: 1, items: 3, tables: 1 });
    expect(outputShape("Plain prose, no structure.")).toEqual({ words: 4, headings: 0, items: 0, tables: 0 });
  });
});

describe("firstPicks", () => {
  it("counts the readings where the judge picked the response shown first", async () => {
    const { firstPicks } = await import("./evals");
    const per = [
      { input: "q1", first: "a", second: "b", verdict: "tie" }, // always the first shown: 2 of 2
      { input: "q2", first: "a", second: "a", verdict: "a" }, // a both times: 1 of 2
      { input: "q3", first: "tie", second: "unread", verdict: "tie" }, // no pick
    ] as never;
    expect(firstPicks(per)).toEqual({ first: 3, picked: 4 });
  });
});

describe("poolJudgements", () => {
  it("adds up judgements of the same two setups by one judge and criterion, in one direction, leaving out invalid ones", async () => {
    const { poolJudgements, DEFAULT_CRITERION } = await import("./evals");
    const ev = (id: string, system_name: string, on_model: string, invalid = false) => ({ id, system_name, on_model, ...(invalid ? { invalid: { reason: "bug" } } : {}) });
    const evals = [ev("m1", "MoA", "gemini"), ev("m2", "MoA", "gemini"), ev("s1", "Single", "gemini"), ev("s2", "Single", "gemini"), ev("ml", "MoA", "lite"), ev("bad", "Single", "gemini", true)];
    const j = (a: string, b: string, aw: number, bw: number, t: number, criterion = DEFAULT_CRITERION, unread = false) =>
      ({ a, b, a_name: "", b_name: "", judge: "g", criterion, a_wins: aw, b_wins: bw, ties: t, per: unread ? [{ input: "q", first: "unread", second: "a", verdict: "tie" }] : [], usd: 0, at: "" }) as never;
    const out = poolJudgements(evals, [
      j("m1", "s1", 16, 0, 4),
      j("s2", "m2", 0, 15, 5), // the other direction: flipped onto MoA's side
      j("ml", "s1", 7, 9, 4), // MoA on another model: its own group
      j("m1", "bad", 20, 0, 0), // an invalid evaluation: left out
      j("m1", "s1", 17, 0, 3, "Judge the content, not the length."), // another criterion: its own group
      j("m2", "s2", 1, 1, 18, DEFAULT_CRITERION, true), // a missing verdict: left out
    ]);
    const main = out.find((g) => g.a === "MoA · on gemini" && g.judge === "g")!;
    expect([main.w, main.l, main.t, main.n]).toEqual([31, 0, 9, 2]);
    expect(out.some((g) => g.a.includes("on lite") || g.b.includes("on lite"))).toBe(true);
    expect(out.find((g) => g.judge === "g, own criterion")).toMatchObject({ w: 17, n: 1 });
    expect(out.length).toBe(3);
  });
});

describe("cut-short cases", () => {
  it("group as their own reason among the failures", async () => {
    const { failureReasons } = await import("./evals");
    const out = failureReasons([
      { pass: false, status: "done", why: "5 ≠ 6", cut_short: true },
      { pass: false, status: "done", why: "7 ≠ 8" },
      { pass: true, status: "done", why: "", cut_short: true }, // a pass is not a failure, cut short or not
    ] as never);
    expect(out.map((r) => [r.reason, r.count])).toEqual([["cut short at a limit: the conversation did not end", 1], ["wrong answer", 1]]);
  });
});

describe("answer trails", () => {
  it("reads the last trail a run logged", () => {
    expect(answerTrail(["Starts", "answers by round: 12 → 12 → 15", "done"])).toEqual({ label: "round", answers: ["12", "12", "15"] });
    expect(answerTrail(["answers by correction: 1 → 2", "answers by correction: 3 → 4"])?.answers).toEqual(["3", "4"]);
    expect(answerTrail(["no trail here"])).toBeNull();
  });
  it("takes verdicts worked out before, as a check grader gives them", () => {
    const right = new Set(["(6 - 4) * (5 + 7)"]);
    const t = trailStats([{ answers: ["6 * 4", "(6 - 4) * (5 + 7)"], expected: "4 5 6 7", input: "q" }, { answers: ["(6 - 4) * (5 + 7)", "6 + 4"], expected: "4 5 6 7", input: "q2" }], (a) => right.has(a), "revision");
    expect(t).toMatchObject({ label: "revision", cases: 2, first: 1, last: 1, wrong_to_right: 1, right_to_wrong: 1 });
  });
  it("grades every step as the score does, Decimal reprs and equal numbers included", () => {
    const t = trailStats(
      [
        { answers: ["Decimal('2944533.50')", "2944533.5"], expected: "2944533.5", input: "q1" }, // right both times
        { answers: ["10", "11"], expected: "10", input: "q2" }, // right → wrong
        { answers: ["4", "5", "5"], expected: "5", input: "q3" }, // wrong → right
        { answers: ["7", "7"], expected: "8", input: "q4" }, // wrong, unchanged
      ],
      "number",
      "round",
    );
    expect(t).toMatchObject({ label: "round", cases: 4, first: 2, last: 2, right_to_wrong: 1, wrong_to_right: 1, unchanged: 1 });
    expect(t.mean_steps).toBeCloseTo(1.25);
    expect(t.by_step).toEqual([
      { step: 0, right: 2, cases: 4 },
      { step: 1, right: 2, cases: 4 },
      { step: 2, right: 1, cases: 1 },
    ]);
  });
});
