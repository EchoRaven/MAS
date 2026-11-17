// The provider-neutral chat shape the runtime speaks. Each provider adapter
// maps it to its own API.
import type { ModelSpec } from "@/model/types";

export type Part =
  | { type: "text"; text: string }
  /** extra: provider fields that must come back with the call (Gemini's thought_signature) */
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown>; extra?: Record<string, unknown> }
  | { type: "tool_result"; id: string; content: string; error?: boolean }
  /** a provider block that must be sent back verbatim (thinking, server tool use and results) */
  | { type: "raw"; provider: string; block: unknown };

export interface ChatMessage {
  role: "user" | "assistant";
  content: Part[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  /** provider-hosted tools, used when the provider has them (Anthropic web search / fetch) */
  server_tools?: ("web_search" | "web_fetch")[];
  max_tokens?: number | null;
  temperature?: number | null;
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: Part[];
  stop: "end" | "tool_use" | "max_tokens" | "refusal" | "pause";
  usage: { input: number; output: number };
}

export interface Provider {
  chat(model: ModelSpec, key: string | undefined, req: ChatRequest): Promise<ChatResponse>;
  embed?(model: ModelSpec, key: string | undefined, texts: string[], signal?: AbortSignal): Promise<number[][]>;
  rerank?(model: ModelSpec, key: string | undefined, query: string, docs: string[], signal?: AbortSignal): Promise<number[]>;
}

export const textOf = (parts: Part[]) =>
  parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");

export const userText = (text: string): ChatMessage => ({ role: "user", content: [{ type: "text", text }] });
