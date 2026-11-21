// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { defaultMaxOutput, outputLimit } from "./index";
import { providerParams } from "./types";

describe("a model's own output limit", () => {
  const spec = (params: Record<string, unknown>) => ({ id: "g", provider: "mock", model: "mock", api: { params }, price_in: 0, price_out: 0, modalities: ["text"] }) as never;
  it("is the model's own, none when it says null, else the default; and the provider never sees it", () => {
    expect(outputLimit(spec({ max_output: null }))).toBeUndefined();
    expect(outputLimit(spec({ max_output: 8000 }))).toBe(8000);
    expect(outputLimit(spec({}))).toBe(32_768);
    expect(Object.keys(providerParams(spec({ rpm: 10, max_output: null, temperature: 0 })))).toEqual(["temperature"]);
  });
});

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
