import { describe, expect, it } from "vitest";
import { failureReasons } from "./evals";
import { checkResult, resultTypeFor } from "./result";

describe("declared results", () => {
  it("checks each kind of answer", () => {
    expect(checkResult({ type: "code" }, "ALL TESTS PASSED")).toMatchObject({ ok: false });
    expect(checkResult({ type: "code" }, "ALL TESTS PASSED\n\n```python\ndef f(x):\n    return x\n```")).toMatchObject({ ok: true });
    expect(checkResult({ type: "code" }, "def f(x):\n    return x")).toMatchObject({ ok: true });
    expect(checkResult({ type: "number" }, "Thinking…\nFinal: 1,234")).toMatchObject({ ok: true, why: "the number 1234" });
    expect(checkResult({ type: "number" }, "Final: I could not decide")).toMatchObject({ ok: false });
    expect(checkResult({ type: "json" }, 'Here:\n```json\n{"a": 1}\n```')).toMatchObject({ ok: true });
    expect(checkResult({ type: "json" }, "{not json")).toMatchObject({ ok: false });
    expect(checkResult({ type: "choice" }, "Answer: B. Hyperkalaemia")).toMatchObject({ ok: true, why: "the choice B" });
    expect(checkResult({ type: "choice", choices: ["buy", "sell", "hold"] }, "Final: hold")).toMatchObject({ ok: true });
    expect(checkResult({ type: "choice", choices: ["buy", "sell", "hold"] }, "Final: wait")).toMatchObject({ ok: false });
    expect(checkResult({ type: "text" }, "   ")).toMatchObject({ ok: false, why: "the run gave no answer" });
  });

  it("knows what the rule graders need", () => {
    expect(resultTypeFor("code")).toBe("code");
    expect(resultTypeFor("number")).toBe("number");
    expect(resultTypeFor("answer")).toBeNull();
  });

  it("groups failures from the wrong kind of answer first, whatever the grader said", () => {
    const r = failureReasons([
      { pass: false, status: "done", why: "tests fail: SyntaxError: invalid syntax", result_ok: false },
      { pass: false, status: "done", why: "tests fail: SyntaxError: invalid syntax", result_ok: false },
      { pass: false, status: "done", why: "tests fail: AssertionError", result_ok: true },
    ]);
    expect(r[0]).toEqual({ reason: "not the declared result type", count: 2, cases: [0, 1] });
  });
});
