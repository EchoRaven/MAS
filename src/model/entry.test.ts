import { describe, expect, it } from "vitest";
import { Builder, native } from "./builder";
import { entryCandidates, entryPoints } from "./entry";
import { TEMPLATES } from "./templates";

const chain = () => {
  const b = new Builder("Entry", "");
  b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
    .agent("a", 200, 0, { name: "A", model: "sonnet", harness: { ...native(), instructions: "" } })
    .agent("b", 400, 0, { name: "B", model: "sonnet", harness: { ...native(), instructions: "" } })
    .edge("me", "a", "message")
    .edge("a", "b", "message");
  return b.doc;
};

describe("where a run starts", () => {
  it("prefers a person at the edge of the system", () => {
    expect(entryPoints(chain())).toEqual([{ node: "me", why: "human" }]);
  });

  it("falls back to on_start agents, then to what nothing feeds", () => {
    const doc = chain();
    doc.nodes = doc.nodes.filter((n) => n.id !== "me");
    doc.edges = doc.edges.filter((e) => e.source !== "me");
    expect(entryPoints(doc)).toEqual([{ node: "a", port: "in", why: "no_input" }]);
    const agent = doc.nodes.find((n) => n.id === "b")!;
    if (agent.data.kind === "agent") agent.data.triggers = ["on_start"];
    expect(entryPoints(doc)).toEqual([{ node: "b", port: "in", why: "on_start" }]);
  });

  it("a named entry point wins, and its port is checked", () => {
    const doc = chain();
    doc.entry = { node: "b" };
    expect(entryPoints(doc)).toEqual([{ node: "b", port: "in", why: "chosen" }]);
    doc.entry = { node: "b", port: "nope" };
    expect(entryPoints(doc)[0].port).toBe("in");
    // an entry point that was deleted falls back to the inferred one
    doc.entry = { node: "gone" };
    expect(entryPoints(doc)).toEqual([{ node: "me", why: "human" }]);
  });

  it("offers every top-level component that can receive the input", () => {
    expect(entryCandidates(chain()).map((n) => n.id)).toEqual(["me", "a", "b"]);
  });

  it("every built-in template has somewhere to start", () => {
    for (const t of TEMPLATES.filter((x) => x.id !== "blank")) {
      const entries = entryPoints(t.build());
      expect(entries.length, t.id).toBeGreaterThan(0);
    }
  });
});
