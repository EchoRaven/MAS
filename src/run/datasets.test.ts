import { describe, expect, it } from "vitest";
import { builtinDatasets, datasetVersion, sampleCases } from "./datasets";

describe("datasets", () => {
  const cases = Array.from({ length: 50 }, (_, i) => ({ input: `q${i}`, expected: String(i) }));

  it("samples the same cases for the same seed, in their original order, and other cases for another seed", () => {
    const a = sampleCases(cases, 10, 7);
    expect(a).toHaveLength(10);
    expect(sampleCases(cases, 10, 7)).toEqual(a);
    expect(a.map((c) => Number(c.expected))).toEqual([...a.map((c) => Number(c.expected))].sort((x, y) => x - y));
    expect(sampleCases(cases, 10, 8)).not.toEqual(a);
    expect(sampleCases(cases, undefined, 7)).toBe(cases);
    expect(sampleCases(cases, 500, 7)).toBe(cases);
  });

  it("gives a new version when the cases change", () => {
    expect(datasetVersion(cases)).toBe(datasetVersion([...cases]));
    expect(datasetVersion(cases)).not.toBe(datasetVersion([...cases.slice(1)]));
  });

  it("offers the shipped sample sets as read-only datasets, every question read", () => {
    const b = builtinDatasets();
    expect(b.length).toBeGreaterThanOrEqual(5);
    for (const d of b) {
      expect(d.builtin).toBe(true);
      expect(d.cases.length).toBeGreaterThan(0);
      expect(d.id.startsWith("builtin-")).toBe(true);
    }
  });
});
