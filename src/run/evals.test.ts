import { describe, expect, it } from "vitest";
import { boxedContent, caseSetId, failureReasons, finalAnswer, gradeByRule, mcnemarP, pairedDiff, parseCases, parseNumber, SAMPLE_SETS } from "./evals";

describe("grading", () => {
  it("finds the final answer: the last Answer/Final line, else the last line", () => {
    expect(finalAnswer("Reasoning…\nAnswer: 1/3\nConfidence: 0.9")).toBe("1/3");
    expect(finalAnswer("first\nFinal: 12\nmore\n**Final Answer:** 13")).toBe("13");
    expect(finalAnswer("work…\n\n**Final Answer:**\nThere are **3,600** ways for 8 people.")).toBe("There are **3,600** ways for 8 people.");
    expect(finalAnswer("B. Hyperkalaemia\n\nbecause potassium")).toBe("because potassium");
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

describe("math answers", () => {
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
    expect(r.map((x) => x.reason)).toContain("no output");
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
