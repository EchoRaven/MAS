import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/model/templates";
import { formatVars, parseVars, readVars } from "./vars";

describe("run variables", () => {
  it("parses key=value lists, with numbers, booleans and JSON", () => {
    expect(parseVars("paradigm=report, rounds=3\nstrict=true\nlist=[1,2]")).toEqual({ vars: { paradigm: "report", rounds: 3, strict: true, list: [1, 2] }, bad: [] });
    expect(parseVars("oops, x = y").bad).toEqual(["oops"]);
    expect(formatVars({ paradigm: "relay", n: 2 })).toBe("paradigm=relay, n=2");
  });

  it("finds the variables a system reads but never sets", () => {
    const eot = TEMPLATES.find((t) => t.id === "paper-eot")!.build();
    expect(readVars(eot)).toEqual(["paradigm"]);
    // DyLAN's functions only pass state to each other through ctx.vars
    expect(readVars(TEMPLATES.find((t) => t.id === "paper-dylan")!.build())).toEqual([]);
  });
});
