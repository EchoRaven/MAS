import { describe, expect, it } from "vitest";
import type { EvalRecord } from "./evals";
import { csvGrid, markdownTable } from "./exportEvals";

const rec = (passes: boolean[][], usd: number): EvalRecord => ({
  id: "e",
  system_id: "s",
  system_name: "S",
  grader: "number",
  mock: false,
  repeats: passes[0].length,
  status: "finished",
  started_at: "2026-11-17T00:00:00Z",
  usd,
  passed: passes.flat().filter(Boolean).length,
  graded: passes.flat().length,
  cases: passes.flatMap((reps, q) => reps.map((pass, r) => ({ case: q, repeat: r, input: q ? 'Say "hi", twice' : "1+1?", expected: String(q), status: "done" as const, pass }))),
});

describe("exporting evaluations", () => {
  it("a Markdown table with accuracy, spread and cost per correct answer", () => {
    const md = markdownTable([{ label: "Debate | v2", setup: "all on gemini_lite", rec: rec([[true, true], [true, false]], 0.3) }]);
    expect(md.split("\n")[2]).toBe("| Debate \\| v2 | all on gemini_lite | 75% | 100, 50 (sd 35.4) | $0.30 | $0.10 |");
  });

  it("a CSV with one row per question and the share of runs that passed", () => {
    const csv = csvGrid([
      { label: "A", setup: "x", rec: rec([[true, true], [true, false]], 0.1) },
      { label: "B", setup: "y", rec: rec([[false, false], [true, true]], 0.1) },
    ]);
    expect(csv).toBe('#,question,expected,A (x),B (y)\n1,1+1?,0,1,0\n2,"Say ""hi"", twice",1,0.5,1\n');
  });
});
