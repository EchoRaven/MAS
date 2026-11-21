import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS } from "./defaults";
import { remapModels, runAllOn } from "./modelUse";
import { TEMPLATES } from "./templates";

describe("runAllOn", () => {
  it("serves every chat model with one model, keeping the ids and the embedding models", () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-medagents")!.build();
    doc.models.push({ ...DEFAULT_MODELS.find((m) => m.id === "embed")! });
    const out = runAllOn(doc, "gemini", DEFAULT_MODELS);
    const chat = out.models.filter((m) => (m.kind ?? "chat") === "chat");
    expect(chat.length).toBeGreaterThan(1);
    expect(chat.every((m) => m.provider === "google" && m.model === "gemini-3.8-flash")).toBe(true);
    expect(out.models.map((m) => m.id)).toEqual(doc.models.map((m) => m.id));
    expect(out.models.find((m) => m.id === "embed")!.provider).toBe("openai");
    // the original is untouched
    expect(doc.models.find((m) => m.id === "sonnet")!.provider).toBe("anthropic");
  });

  it("refuses an unknown or non-chat model", () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-debate")!.build();
    expect(() => runAllOn(doc, "nope", DEFAULT_MODELS)).toThrow(/Unknown model/);
    expect(() => runAllOn(doc, "embed", DEFAULT_MODELS)).toThrow(/not a chat model/);
  });

  it("remapModels serves chosen models with different ones, and checks the map", () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-reconcile")!.build();
    const out = remapModels(doc, { sonnet: "gemini", gpt: "gemini_lite", gemini: "gemini_3_flash" }, DEFAULT_MODELS);
    const model = (id: string) => out.models.find((m) => m.id === id)!.model;
    expect([model("sonnet"), model("gpt"), model("gemini")]).toEqual(["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-3-flash-preview"]);
    expect(() => remapModels(doc, { nope: "gemini" }, DEFAULT_MODELS)).toThrow(/no model "nope"/);
    expect(() => remapModels(doc, { sonnet: "embed" }, DEFAULT_MODELS)).toThrow(/same kind/);
  });

  it("serves one node with a model of its own (node:<id>), apart from the slot it shared", () => {
    // MoA's aggregator and its first proposers share the opus slot
    const doc = TEMPLATES.find((t) => t.id === "paper-moa")!.build();
    const out = remapModels(doc, { opus: "gemini_lite", gpt: "gemini_lite", local: "gemini_lite", "node:aggregator": "gemini" }, DEFAULT_MODELS);
    const modelOf = (nodeId: string) => {
      const slot = (out.nodes.find((n) => n.id === nodeId)!.data as { model: string }).model;
      return out.models.find((m) => m.id === slot)!.model;
    };
    expect(modelOf("aggregator")).toBe("gemini-3.8-flash");
    expect(modelOf("l1_1")).toBe("gemini-3.1-flash-lite"); // the proposer that shared opus with it
    expect((doc.nodes.find((n) => n.id === "aggregator")!.data as { model: string }).model).toBe("opus"); // the original is untouched
    expect(() => remapModels(doc, { "node:nope": "gemini" }, DEFAULT_MODELS)).toThrow(/no node "nope"/);
    expect(() => remapModels(doc, { "node:aggregator": "embed" }, DEFAULT_MODELS)).toThrow(/not a chat model/);
  });
});
