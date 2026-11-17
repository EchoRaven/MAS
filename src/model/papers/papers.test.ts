import { describe, expect, it } from "vitest";
import { simulate } from "@/run/simulate";
import { TEMPLATES } from "../templates";
import { PAPER_TEMPLATES } from ".";

const calls = (id: string) => {
  const t = PAPER_TEMPLATES.find((x) => x.id === id)!;
  return simulate({ ...t.build(), id: "fixed" }).events.filter((e) => e.type === "usage").length;
};

describe("paper reproductions", () => {
  it("every one cites its paper and says how it maps and where it differs", () => {
    for (const t of PAPER_TEMPLATES) {
      expect(t.paper?.url).toMatch(/^https:\/\/arxiv\.org\/abs\//);
      expect(t.notes?.mapped.length).toBeGreaterThan(0);
      expect(t.notes?.differs.length).toBeGreaterThan(0);
    }
    expect(TEMPLATES.filter((t) => t.paper)).toHaveLength(PAPER_TEMPLATES.length);
  });

  it("Mixture-of-Agents waits for every proposer: 3 + 3 + 1 model calls", () => {
    expect(calls("paper-moa")).toBe(7);
  });

  it("the debate runs three debaters for two rounds", () => {
    expect(calls("paper-debate")).toBe(6);
  });

  it("role-play and phase groups loop and stop", () => {
    for (const id of ["paper-camel", "paper-chatdev"]) {
      const ev = simulate({ ...PAPER_TEMPLATES.find((x) => x.id === id)!.build(), id: "fixed" }).events;
      expect(ev.some((e) => e.type === "transform" && e.label === "rounds done")).toBe(true);
    }
  });
});
