// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { defaultMaxOutput } from "./index";

describe("the default output limit", () => {
  afterEach(() => {
    delete process.env.MAS_MAX_OUTPUT;
  });
  it("is 32,768 tokens unless MAS_MAX_OUTPUT says otherwise", () => {
    expect(defaultMaxOutput()).toBe(32_768);
    process.env.MAS_MAX_OUTPUT = "4000";
    expect(defaultMaxOutput()).toBe(4000);
    process.env.MAS_MAX_OUTPUT = "lots";
    expect(defaultMaxOutput()).toBe(32_768);
  });
});
