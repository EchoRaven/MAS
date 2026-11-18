// @vitest-environment node
import { describe, expect, it } from "vitest";
import { retryWait } from "./openai";

const res = (status: number, headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers) });

describe("retryWait", () => {
  it("waits as long as Gemini's retryDelay says", () => {
    expect(retryWait(res(429), '[{"error":{"details":[{"retryDelay": "36s"}]}}]', 0)).toBe(36_500);
  });
  it("honours Retry-After", () => {
    expect(retryWait(res(429, { "retry-after": "7" }), "{}", 0)).toBe(7000);
  });
  it("backs off on overloads and server errors", () => {
    expect(retryWait(res(503), "high demand", 0)).toBe(2000);
    expect(retryWait(res(503), "high demand", 2)).toBe(8000);
  });
  it("gives up on exhausted credit, daily quotas, client errors, and after five tries", () => {
    expect(retryWait(res(429), '{"error":{"code":"credit_balance_exhausted","type":"insufficient_quota"}}', 0)).toBeNull();
    expect(retryWait(res(429), '"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"', 0)).toBeNull();
    expect(retryWait(res(400), "bad request", 0)).toBeNull();
    expect(retryWait(res(503), "", 5)).toBeNull();
  });
});

describe("OpenAI-compatible tool calls", () => {
  it("send Gemini's thought_signature back with the call", async () => {
    const { openaiProvider } = await import("./openai");
    const bodies: { messages: { tool_calls?: Record<string, unknown>[] }[] }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const call = { id: "c1", type: "function", function: { name: "f", arguments: "{}" }, extra_content: { google: { thought_signature: "sig" } } };
      return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [call] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }) as unknown as typeof fetch;
    try {
      const model = { id: "g", provider: "google" as const, model: "gemini-3-flash-preview", api: {}, price_in: 0, price_out: 0, modalities: ["text"] };
      const first = await openaiProvider.chat(model, "k", { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], tools: [{ name: "f", description: "", input_schema: { type: "object" } }] });
      await openaiProvider.chat(model, "k", { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }, { role: "assistant", content: first.content }, { role: "user", content: [{ type: "tool_result", id: "c1", content: "ok" }] }] });
      expect(bodies[1].messages[1].tool_calls?.[0].extra_content).toEqual({ google: { thought_signature: "sig" } });
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("api.params", () => {
  it("sends the provider's parameters and keeps the platform's own (rpm) out of the request", async () => {
    const { openaiProvider } = await import("./openai");
    const bodies: Record<string, unknown>[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }) as unknown as typeof fetch;
    try {
      const model = { id: "gemma", provider: "google" as const, model: "gemma-4-26b-a4b-it", api: { params: { rpm: 10, top_p: 0.9 } }, price_in: 0, price_out: 0, modalities: ["text"] };
      await openaiProvider.chat(model, "k", { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
      expect(bodies[0].top_p).toBe(0.9);
      expect(bodies[0]).not.toHaveProperty("rpm");
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("streamed replies", () => {
  it("streams a call without tools and puts the reply together, usage included", async () => {
    const { openaiProvider } = await import("./openai");
    const bodies: Record<string, unknown>[] = [];
    const real = globalThis.fetch;
    const sse = [
      'data: {"choices":[{"delta":{"content":"The answer"}}]}\n\ndata: {"choices":[{"delta":{"con',
      'tent":" is 42."},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":5}}\n\ndata: [DONE]\n\n',
    ];
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const enc = new TextEncoder();
      const body = new ReadableStream({ start(c) { for (const s of sse) c.enqueue(enc.encode(s)); c.close(); } });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    try {
      const model = { id: "g", provider: "google" as const, model: "gemma", api: {}, price_in: 0, price_out: 0, modalities: ["text"] };
      const r = await openaiProvider.chat(model, "k", { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
      expect(bodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
      expect(r.content).toEqual([{ type: "text", text: "The answer is 42." }]);
      expect(r.usage).toEqual({ input: 7, output: 5 });
      expect(r.stop).toBe("end");
    } finally {
      globalThis.fetch = real;
    }
  });
});
