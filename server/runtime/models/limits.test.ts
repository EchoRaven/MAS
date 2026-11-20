// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { defaultMaxOutput } from "./index";

describe("the default output limit", () => {
  afterEach(() => {
    delete process.env.MAS_MAX_OUTPUT;
  });
  it("is 16,384 tokens unless MAS_MAX_OUTPUT says otherwise", () => {
    expect(defaultMaxOutput()).toBe(16_384);
    process.env.MAS_MAX_OUTPUT = "4000";
    expect(defaultMaxOutput()).toBe(4000);
    process.env.MAS_MAX_OUTPUT = "lots";
    expect(defaultMaxOutput()).toBe(16_384);
  });
});
