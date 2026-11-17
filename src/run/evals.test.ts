import { describe, expect, it } from "vitest";
import { finalAnswer, gradeByRule, parseCases, parseNumber, SAMPLE_SETS } from "./evals";

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
    expect(gradeByRule("answer", "Answer: **Paris.**", "paris").pass).toBe(true);
    // real outputs that a last-number rule got wrong
    expect(gradeByRule("number", "…\n**Final Answer:**\nThere are **3,600** ways for 8 people to sit.", "3600").pass).toBe(true);
    expect(gradeByRule("number", "Summing: 1 + 12 + 36 = 49\n\nThere are **49 ways** to make 50 cents.", "49").pass).toBe(true);
    expect(gradeByRule("number", "There are 54 three-digit numbers whose digits add up to 10.", "54").pass).toBe(true);
    expect(gradeByRule("number", "The final answer is $\\boxed{9368}$.", "9368").pass).toBe(true);
    // a whole sentence in bold: the number the question already has (2, 50) is not the answer
    expect(gradeByRule("number", "**The sum of the decimal digits of $2^{50}$ is 76.**", "76", "What is the sum of the decimal digits of 2^50?").pass).toBe(true);
    expect(gradeByRule("number", "It takes 5 minutes for 100 machines.", "5", "If 5 machines take 5 minutes to make 5 widgets, how long for 100 machines and 100 widgets?").pass).toBe(true);
    expect(gradeByRule("number", "A 2 × 12 strip can be tiled in 233 ways.", "233", "In how many ways can a 2 × 12 strip be tiled with 1 × 2 dominoes?").pass).toBe(true);
    expect(gradeByRule("answer", "Answer: B. Hyperkalaemia", "B").pass).toBe(true);
    expect(gradeByRule("answer", "Answer: Because of B", "B").pass).toBe(false);
    expect(gradeByRule("contains", "It is hyperkalaemia, clearly.", "Hyperkalaemia").pass).toBe(true);
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

  it("the sample sets parse completely", () => {
    for (const s of SAMPLE_SETS) expect(parseCases(s.text).skipped, s.name).toBe(0);
  });
});
