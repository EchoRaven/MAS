// OpenAI's chat-completions wire format: OpenAI itself, Gemini's
// OpenAI-compatible endpoint, vLLM / Ollama / any compatible server.
// Also embeddings (/embeddings) and rerank (/rerank, Cohere/Jina/TEI shapes).
import type { ModelSpec } from "@/model/types";
import type { ChatMessage, ChatResponse, Part, Provider } from "./types";

const DEFAULT_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
};

const base = (m: ModelSpec) => (m.api.base_url || DEFAULT_BASE[m.provider] || "").replace(/\/$/, "");

async function post(m: ModelSpec, key: string | undefined, path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const url = `${base(m)}${path}`;
  if (!url.startsWith("http")) throw new Error(`Model ${m.id} has no base URL`);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...(m.api.headers ?? {}) },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${m.provider} ${res.status}: ${text.slice(0, 300)}`);
  }
}

type OAMessage = { role: string; content?: string | null; tool_calls?: unknown[]; tool_call_id?: string };

function toMessages(system: string | undefined, msgs: ChatMessage[]): OAMessage[] {
  const out: OAMessage[] = system ? [{ role: "system", content: system }] : [];
  for (const m of msgs) {
    const text = m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
    if (m.role === "assistant") {
      const calls = m.content.filter((p): p is Extract<Part, { type: "tool_call" }> => p.type === "tool_call");
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) });
    } else {
      for (const p of m.content) if (p.type === "tool_result") out.push({ role: "tool", tool_call_id: p.id, content: p.content });
      if (text) out.push({ role: "user", content: text });
    }
  }
  return out;
}

export const openaiProvider: Provider = {
  async chat(model, key, req) {
    const body = {
      model: model.model,
      messages: toMessages(req.system, req.messages),
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}),
      ...(req.max_tokens ? { max_completion_tokens: req.max_tokens } : {}),
      ...(req.temperature != null ? { temperature: req.temperature } : {}),
      ...(model.api.params ?? {}),
    };
    const data = (await post(model, key, "/chat/completions", body, req.signal)) as {
      choices: { message: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason: string }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const choice = data.choices[0];
    const content: Part[] = [];
    if (choice.message.content) content.push({ type: "text", text: choice.message.content });
    for (const c of choice.message.tool_calls ?? []) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(c.function.arguments || "{}");
      } catch {
        input = { _raw: c.function.arguments };
      }
      content.push({ type: "tool_call", id: c.id, name: c.function.name, input });
    }
    const stop: ChatResponse["stop"] = choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : choice.finish_reason === "content_filter" ? "refusal" : "end";
    return { content, stop, usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 } };
  },

  async embed(model, key, texts, signal) {
    const data = (await post(model, key, "/embeddings", { model: model.model, input: texts }, signal)) as { data: { embedding: number[]; index: number }[] };
    return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  },

  async rerank(model, key, query, docs, signal) {
    const data = (await post(model, key, "/rerank", { model: model.model, query, documents: docs, texts: docs }, signal)) as
      | { results: { index: number; relevance_score: number }[] }
      | { index: number; score: number }[];
    const scores = new Array(docs.length).fill(0);
    if (Array.isArray(data)) for (const r of data) scores[r.index] = r.score;
    else for (const r of data.results) scores[r.index] = r.relevance_score;
    return scores;
  },
};
