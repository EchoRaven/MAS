import { describe, expect, it } from "vitest";
import { gradeCheck } from "./check";

// a Game of 24 check: the expression uses exactly the four numbers (the expected field) and equals 24
const GAME24 = `const nums = (expected.match(/\\d+/g) || []).map(Number).sort((a, b) => a - b);
const expr = answer.replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/=.*$/, "").trim();
if (!/^[\\d+\\-*/().\\s]+$/.test(expr)) return { pass: false, why: "not an arithmetic expression: " + expr };
const used = (expr.match(/\\d+/g) || []).map(Number).sort((a, b) => a - b);
if (used.join(",") !== nums.join(",")) return { pass: false, why: "uses " + used.join(", ") + ", not " + nums.join(", ") };
const v = Function("return (" + expr + ")")();
return { pass: Math.abs(v - 24) < 1e-9, why: expr + " = " + v };`;

describe("grader check", () => {
  it("passes or fails by what the JS returns, with its reason", async () => {
    expect(await gradeCheck(GAME24, "Work…\nAnswer: (6 - 4) * (5 + 7)", "4 5 6 7", "Use 4 5 6 7 to make 24.")).toMatchObject({ pass: true, answer: "(6 - 4) * (5 + 7)" });
    const wrong = await gradeCheck(GAME24, "Answer: 6 * 4", "4 5 6 7", "Use 4 5 6 7 to make 24.");
    expect(wrong.pass).toBe(false);
    expect(wrong.why).toContain("uses 4, 6");
  });
  it("reads a plain true / false, and names the error when the check cannot run", async () => {
    expect((await gradeCheck("answer === expected", "Answer: x", "x", "q")).pass).toBe(true);
    expect((await gradeCheck("return false", "Answer: x", "x", "q")).why).toBe("the check failed");
    const broken = await gradeCheck("return nope.length", "Answer: x", "x", "q");
    expect(broken.pass).toBe(false);
    expect(broken.why).toMatch(/could not run: .*nope/);
  });
  it("stops a check that does not end", async () => {
    const r = await gradeCheck("while (true) {}", "Answer: x", "x", "q");
    expect(r.pass).toBe(false);
    expect(r.why).toMatch(/could not run/);
  }, 10_000);
});
