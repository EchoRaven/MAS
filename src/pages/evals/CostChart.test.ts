import { describe, expect, it } from "vitest";
import { frontier } from "./CostChart";

describe("the cost frontier", () => {
  it("keeps what nothing beats on both accuracy and cost", () => {
    const p = (id: string, acc: number, perCase: number) => ({ id, label: id, setup: "", acc, perCase });
    const points = [p("one agent", 0.63, 0.002), p("vote", 0.73, 0.01), p("debate", 0.7, 0.017), p("five debaters", 0.75, 0.028), p("code", 1, 0.003)];
    // code is more accurate than everything and cheaper than all but one agent; one agent is the cheapest
    expect([...frontier(points)].sort()).toEqual(["code", "one agent"]);
    // without code, the vote and five debaters each buy accuracy the cheaper ones lack
    expect([...frontier(points.filter((x) => x.id !== "code"))].sort()).toEqual(["five debaters", "one agent", "vote"]);
  });
});
