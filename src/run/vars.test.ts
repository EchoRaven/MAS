import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/model/templates";
import { fillVars, formatVars, parseVars, readVars, sweepOf } from "./vars";

describe("run variables", () => {
  it("parses key=value lists, with numbers, booleans and JSON", () => {
    expect(parseVars("paradigm=report, rounds=3\nstrict=true\nlist=[1,2]")).toEqual({ vars: { paradigm: "report", rounds: 3, strict: true, list: [1, 2] }, bad: [] });
    expect(parseVars("oops, x = y").bad).toEqual(["oops"]);
    expect(formatVars({ paradigm: "relay", n: 2 })).toBe("n=2, paradigm=relay");
    // the same setup reads the same, whatever order its variables were given in
    expect(formatVars({ topology: "star", n: 4 })).toBe(formatVars({ n: 4, topology: "star" }));
  });

  it("finds the variables a system reads but never sets", () => {
    const eot = TEMPLATES.find((t) => t.id === "paper-eot")!.build();
    expect(readVars(eot)).toEqual(["paradigm"]);
    // DyLAN's functions pass state to each other through ctx.vars; the one it reads is team_size (team optimization)
    expect(readVars(TEMPLATES.find((t) => t.id === "paper-dylan")!.build())).toEqual(["team_size"]);
    // and the ones written as {{vars.x}}: round limits, ensemble sizes, instructions
    expect(readVars(TEMPLATES.find((t) => t.id === "paper-debate")!.build())).toContain("rounds");
    expect(readVars(TEMPLATES.find((t) => t.id === "paper-agent-forest")!.build())).toContain("n");
    expect(readVars(TEMPLATES.find((t) => t.id === "paper-mapcoder")!.build())).toEqual(["k", "t"]);
  });

  it("fills {{vars.x}} and {{vars.x ?? default}} in text, and leaves other braces alone", () => {
    expect(fillVars("Write {{vars.k ?? 3}} plans, {{ vars.style }} style.", { style: "terse" })).toBe("Write 3 plans, terse style.");
    expect(fillVars("Write {{vars.k ?? 3}} plans.", { k: 5 })).toBe("Write 5 plans.");
    expect(fillVars('Tone: {{vars.tone ?? "plain"}}', {})).toBe("Tone: plain");
    expect(fillVars("Use {{input}} and {{vars.missing}} and {x: 1}", {})).toBe("Use {{input}} and {{vars.missing}} and {x: 1}");
    expect(fillVars("Weights {{vars.w}}", { w: [1, 2] })).toBe("Weights [1,2]");
  });

  it("reads a sweep, n=2|4|8, as one variable over several values", () => {
    expect(sweepOf(parseVars("n=2|4|8, topology=star").vars)).toEqual({ name: "n", values: [2, 4, 8], rest: { topology: "star" } });
    expect(sweepOf(parseVars("paradigm=memory|relay").vars)).toMatchObject({ name: "paradigm", values: ["memory", "relay"] });
    expect(sweepOf(parseVars("n=4").vars)).toBeNull();
    expect(sweepOf(parseVars("n=2|4, k=1|3").vars)).toMatchObject({ error: expect.stringMatching(/one variable at a time/) });
  });
});
