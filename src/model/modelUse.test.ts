import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS } from "./defaults";
import { runAllOn } from "./modelUse";
import { TEMPLATES } from "./templates";

describe("runAllOn", () => {
  it("serves every chat model with one model, keeping the ids and the embedding models", () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-medagents")!.build();
    doc.models.push({ ...DEFAULT_MODELS.find((m) => m.id === "embed")! });
    const out = runAllOn(doc, "gemini", DEFAULT_MODELS);
    const chat = out.models.filter((m) => (m.kind ?? "chat") === "chat");
    expect(chat.length).toBeGreaterThan(1);
    expect(chat.every((m) => m.provider === "google" && m.model === "gemini-2.5-flash")).toBe(true);
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
});
