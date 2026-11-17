import { describe, expect, it } from "vitest";
import { Builder, native } from "./builder";
import { autoLayout } from "./layout";

describe("autoLayout", () => {
  it("puts the flow left to right from the entry, and resources underneath their users", () => {
    const b = new Builder("T", "");
    const h = { ...native(), instructions: "" };
    b.agent("w", 999, 0, { name: "Writer", model: "m", harness: h })
      .node("me", "human", 999, 999, { name: "Me", role: "", approves: false })
      .agent("e", 0, 999, { name: "Editor", model: "m", harness: h })
      .plugin("mem", "memory", 5, 5, { name: "Mem" })
      .edge("me", "w", "message")
      .edge("w", "e", "message")
      .edge("e", "w", "message")
      .edge("e", "me", "message")
      .edge("e", "mem", "access", { access: "read_write" });
    const doc = autoLayout(b.doc);
    const at = (id: string) => doc.nodes.find((n) => n.id === id)!.position;
    expect(at("me").x).toBe(0);
    expect(at("w").x).toBeGreaterThan(at("me").x);
    expect(at("e").x).toBeGreaterThan(at("w").x);
    expect(at("mem").x).toBe(at("e").x);
    expect(at("mem").y).toBeGreaterThan(at("e").y);
  });

  it("puts a spawn template under the agent that spawns it, and never makes it the entry", async () => {
    const { TEMPLATES } = await import("./templates");
    const { entryPoints } = await import("./entry");
    const { validate } = await import("./validate");
    const doc = TEMPLATES.find((t) => t.id === "paper-autoagents")!.build();
    const at = (id: string) => doc.nodes.find((n) => n.id === id)!.position;
    expect(at("generated").x).toBe(at("action_observer").x);
    expect(at("generated").y).toBeGreaterThan(at("action_observer").y);
    expect(entryPoints(doc).map((e) => e.node)).toEqual(["user"]);
    expect(validate(doc).filter((i) => i.nodeId === "generated")).toEqual([]);
  });
});
