import { describe, expect, it } from "vitest";
import { clip } from "./values";

describe("clip", () => {
  it("keeps a long text's beginning and its end, where the answer is", () => {
    const text = "Question restated. " + "thinking ".repeat(5000) + "Final: 13";
    const c = clip(text, 3000);
    expect(c.startsWith("Question restated.")).toBe(true);
    expect(c.endsWith("Final: 13")).toBe(true);
    expect(c).toMatch(/… \(\d+ chars cut\) …/);
    expect(c.length).toBeLessThan(3100);
    expect(clip("short", 3000)).toBe("short");
  });
});
