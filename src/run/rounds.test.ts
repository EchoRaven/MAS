import { describe, expect, it } from "vitest";
import { Builder, native } from "@/model/builder";
import type { RunEvent } from "./events";
import { roundsOf } from "./rounds";

// me -> loop (group: coder -> loop) -> me, iterating until the tests pass
function doc() {
  const b = new Builder("Loop", "");
  b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
    .group("loop", 200, 0, { name: "Fix", iterate: { max_rounds: 3, until: 'output.text.includes("PASS")', feed: "input_and_output" } })
    .agent("coder", 0, 0, { name: "Coder", model: "m", harness: { ...native(), loop: "single_shot", instructions: "" } }, "loop")
    .edge("me", "loop", "message")
    .edge("loop", "me", "message");
  return b.doc;
}

const msg = (t: number, from: string, to: string, text: string): RunEvent => ({ t, type: "message", from, to, kind: "message", text }) as RunEvent;
const use = (t: number, node: string, usd: number): RunEvent => ({ t, type: "usage", node, tokens_in: 1, tokens_out: 1, usd, estimated: false });
const tr = (t: number, label: string, detail: string): RunEvent => ({ t, type: "transform", at: "loop", label, detail });

describe("rounds of iterating groups", () => {
  it("folds each round's cost, value and verdict, and restarts the count when the group is entered again", () => {
    const events: RunEvent[] = [
      msg(0, "me", "loop", "task"),
      use(1, "coder", 0.01),
      msg(2, "coder", "loop", "FAIL: 2 tests"),
      tr(2, "round 2 of ≤3", 'until output.text.includes("PASS") — not yet'),
      use(3, "coder", 0.02),
      use(3.5, "coder", 0.01),
      msg(4, "coder", "loop", "PASS"),
      tr(4, "rounds done", 'output.text.includes("PASS") holds (round 2)'),
      msg(5, "me", "loop", "second task"),
      use(6, "coder", 0.01),
    ];
    const [g] = roundsOf(events, doc());
    expect(g).toMatchObject({ group: "loop", max_rounds: 3, until: 'output.text.includes("PASS")' });
    expect(g.rounds.map((r) => [r.entry, r.n, r.outcome, r.calls, r.result])).toEqual([
      [1, 1, "next", 1, "FAIL: 2 tests"],
      [1, 2, "done", 2, "PASS"],
      [2, 1, "running", 1, null],
    ]);
    expect(g.rounds[1].usd).toBeCloseTo(0.03);
    expect(g.rounds[1].verdict).toContain("holds (round 2)");
    expect(g.rounds[0].end).toBe(2);
  });

  it("leaves out groups that never ran, and groups that do not iterate", () => {
    expect(roundsOf([], doc())).toEqual([]);
  });
});
