// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sweepVariants } from "./evals";

describe("a sweep's evaluations", () => {
  it("sets one run variable per value, keeping the others", () => {
    const v = sweepVariants({ vars: { recon: "good" }, on_model: "gemini" }, "n", [2, 4]);
    expect(v).toEqual([{ vars: { recon: "good", n: 2 }, on_model: "gemini" }, { vars: { recon: "good", n: 4 }, on_model: "gemini" }]);
  });
  it("runs the system on each model for on_model, leaving the variables as they are", () => {
    const v = sweepVariants({ vars: { recon: "good" } }, "on_model", ["gemini", "gemini_lite"]);
    expect(v).toEqual([{ vars: { recon: "good" }, on_model: "gemini" }, { vars: { recon: "good" }, on_model: "gemini_lite" }]);
  });
});
