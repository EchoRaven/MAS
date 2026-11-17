// Anthropic models through the official SDK. Streams every request (long
// outputs would otherwise hit request timeouts) and collects the final message.
import Anthropic from "@anthropic-ai/sdk";
import type { ModelSpec } from "@/model/types";
import type { ChatMessage, ChatRequest, ChatResponse, Part, Provider } from "./types";

const clients = new Map<string, Anthropic>();

function client(model: ModelSpec, key: string | undefined): Anthropic {
  const id = `${model.api.base_url ?? ""}|${key ?? ""}`;
  let c = clients.get(id);
  if (!c) {
    c = new Anthropic({ apiKey: key, baseURL: model.api.base_url || undefined, defaultHeaders: model.api.headers });
    clients.set(id, c);
  }
  return c;
}

function toBlocks(m: ChatMessage): Anthropic.ContentBlockParam[] {
  return m.content.map((p): Anthropic.ContentBlockParam => {
    switch (p.type) {
      case "text":
        return { type: "text", text: p.text || " " };
      case "tool_call":
        return { type: "tool_use", id: p.id, name: p.name, input: p.input };
      case "tool_result":
        return { type: "tool_result", tool_use_id: p.id, content: p.content, is_error: p.error || undefined };
      case "raw":
        return p.block as Anthropic.ContentBlockParam;
    }
  });
}

function fromBlocks(blocks: Anthropic.ContentBlock[]): Part[] {
  return blocks.map((b): Part => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "tool_use") return { type: "tool_call", id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> };
    return { type: "raw", provider: "anthropic", block: b };
  });
}

const STOP: Record<string, ChatResponse["stop"]> = { end_turn: "end", stop_sequence: "end", tool_use: "tool_use", max_tokens: "max_tokens", refusal: "refusal", pause_turn: "pause", model_context_window_exceeded: "max_tokens" };

/** Adaptive thinking by default on the 5.x Opus / Sonnet / Fable models, unless a temperature is set or params turn it off. */
function thinkingFor(model: ModelSpec, req: ChatRequest): Record<string, unknown> {
  const params = { ...(model.api.params ?? {}) };
  if ("thinking" in params) {
    const t = params.thinking;
    return t === false || t === "off" ? {} : { thinking: typeof t === "string" ? { type: t } : t };
  }
  if (req.temperature != null) return {};
  return /claude-(opus|sonnet|fable)-5/.test(model.model) ? { thinking: { type: "adaptive" } } : {};
}

export const anthropicProvider: Provider = {
  async chat(model, key, req) {
    const { thinking: _ignored, ...extra } = (model.api.params ?? {}) as Record<string, unknown>;
    void _ignored;
    const tools: Anthropic.ToolUnion[] = (req.tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema }));
    for (const s of req.server_tools ?? []) tools.push(s === "web_search" ? { type: "web_search_20260209", name: "web_search" } : { type: "web_fetch_20260209", name: "web_fetch" });
    const params = {
      model: model.model,
      max_tokens: req.max_tokens ?? 16000,
      system: req.system || undefined,
      messages: req.messages.map((m) => ({ role: m.role, content: toBlocks(m) })),
      ...(tools.length ? { tools } : {}),
      ...(req.temperature != null ? { temperature: req.temperature } : {}),
      ...thinkingFor(model, req),
      ...extra,
    } as Anthropic.MessageCreateParamsNonStreaming;
    const msg = await client(model, key).messages.stream(params, { signal: req.signal }).finalMessage();
    return {
      content: fromBlocks(msg.content),
      stop: STOP[msg.stop_reason ?? "end_turn"] ?? "end",
      usage: { input: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0), output: msg.usage.output_tokens },
    };
  },
};
