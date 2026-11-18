// OpenAI's chat-completions wire format: OpenAI itself, Gemini's
// OpenAI-compatible endpoint, vLLM / Ollama / any compatible server.
// Also embeddings (/embeddings) and rerank (/rerank, Cohere/Jina/TEI shapes).
import { localUrl } from "@/model/net";
import { providerParams } from "./types";
import type { ModelSpec } from "@/model/types";
import type { ChatMessage, ChatResponse, Part, Provider } from "./types";

const DEFAULT_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
};

const base = (m: ModelSpec) => (m.api.base_url || DEFAULT_BASE[m.provider] || "").replace(/\/$/, "");

/**
 * How long to wait before retrying, or null to give up. Rate limits wait as
 * long as the provider says (Retry-After, or Gemini's retryDelay); overloads
 * and server errors back off; exhausted credit or a daily quota fail at once.
 */
export function retryWait(res: { status: number; headers: Headers }, text: string, attempt: number): number | null {
  if (res.status !== 429 && res.status < 500) return null;
  if (/insufficient_quota|credit_balance|PerDay/i.test(text)) return null;
  if (attempt >= 5) return null;
  const after = Number(res.headers.get("retry-after"));
  if (after > 0) return Math.min(after * 1000, 65_000);
  const delay = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(text);
  if (delay) return Math.min(Number(delay[1]) * 1000 + 500, 65_000);
  return Math.min(1000 * 2 ** (attempt + 1), 30_000);
}

/** The provider's error message, not the whole body. */
function brief(text: string): string {
  let msg = text;
  try {
    const d = JSON.parse(text);
    const e = Array.isArray(d) ? d[0]?.error : d.error;
    if (e?.message) msg = String(e.message);
  } catch {
    /* not JSON */
  }
  // a quota error names what ran out (tokens a minute, requests a day…): keep that, not the boilerplate around it
  const metrics = [...new Set([...msg.matchAll(/Quota exceeded for metric: ([\w./-]+)/g)].map((m) => m[1].split("/").pop()))];
  if (metrics.length) return `${msg.split(".")[0]}. Quota exceeded: ${metrics.join(", ")}`.slice(0, 400);
  return msg.slice(0, 300);
}

/**
 * Some models write their reasoning into the reply (Gemma: "<thought>…</thought>answer").
 * It is not the answer: kept out of the text that goes on to other agents and graders,
 * where it multiplies the tokens of every later call (and ran into a free tier's token quota).
 */
export function splitThought(text: string): { text: string; thought: string | null } {
  const m = /^\s*<(thought|think|thinking)>([\s\S]*?)<\/\1>\s*/i.exec(text);
  return m ? { text: text.slice(m[0].length), thought: m[2].trim() } : { text, thought: null };
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });
}

/** Network failures (not HTTP errors) are retried this many times, 2 s, 4 s, 8 s apart. */
export const NET_RETRIES = 3;
const netBackoff = (attempt: number) => 2000 * 2 ** attempt;

/** A failure of the connection itself, which sending the same request again can fix. */
export function networkError(e: unknown): boolean {
  const code = String((e as { cause?: { code?: string } })?.cause?.code ?? "");
  // no such host, nothing listening, no network at all: asking again in seconds will not change that
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH/.test(code)) return false;
  const m = `${(e as Error)?.message ?? ""} ${code}`;
  return /terminated|fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR|other side closed/i.test(m);
}

async function post(m: ModelSpec, key: string | undefined, path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  return (await send(m, key, path, body, signal)).json();
}

/** POST with the provider's retries (rate limits, overloads); the response, once it is OK. */
async function send(m: ModelSpec, key: string | undefined, path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const url = `${base(m)}${path}`;
  if (!url.startsWith("http")) throw new Error(`Model ${m.id} has no base URL`);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...(m.api.headers ?? {}) },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      // the connection broke before an answer (reset, timed out): try again, a few times, unless the run was stopped.
      // Not for a model server on this machine: a closed socket there means it is not running
      if (signal?.aborted || attempt >= NET_RETRIES || !networkError(e) || localUrl(url)) throw e;
      await sleep(netBackoff(attempt), signal);
      continue;
    }
    if (res.ok) return res;
    const text = await res.text();
    const wait = retryWait(res, text, attempt);
    if (wait != null) {
      await sleep(wait, signal);
      continue;
    }
    throw new Error(`${m.provider} ${res.status}: ${brief(text)}`);
  }
}

/**
 * A streamed chat completion, read into the shape of an unstreamed one. A
 * provider that ignores stream and answers with JSON is read as JSON.
 */
async function readStream(res: Response): Promise<unknown> {
  if (!/event-stream/.test(res.headers.get("content-type") ?? "")) return res.json();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let finish = "stop";
  let usage: { prompt_tokens: number; completion_tokens: number } | undefined;
  // tool calls arrive in pieces, by index: the id and name once, the arguments as text in parts, and provider
  // extras (Gemini's extra_content.google.thought_signature) whole, which must be sent back with the call
  type Call = { id: string; type: string; function: { name: string; arguments: string } } & Record<string, unknown>;
  const calls: Call[] = [];
  type CallDelta = { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } } & Record<string, unknown>;
  const take = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string | null; tool_calls?: CallDelta[] }; finish_reason?: string | null }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
    const c = chunk.choices?.[0];
    if (c?.delta?.content) text += c.delta.content;
    for (const d of c?.delta?.tool_calls ?? []) {
      const i = d.index ?? calls.length;
      const cur = (calls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      const { index: _i, id, type, function: fn, ...extra } = d;
      void _i;
      if (id) cur.id = id;
      if (type) cur.type = type;
      if (fn?.name) cur.function.name += fn.name;
      if (fn?.arguments) cur.function.arguments += fn.arguments;
      Object.assign(cur, extra);
    }
    if (c?.finish_reason) finish = c.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      take(buf.slice(0, nl).replace(/\r$/, ""));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) take(buf.trim());
  const done = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  return { choices: [{ message: { content: text, ...(done.length ? { tool_calls: done } : {}) }, finish_reason: finish }], usage };
}

type OAMessage = { role: string; content?: string | null; tool_calls?: unknown[]; tool_call_id?: string };

function toMessages(system: string | undefined, msgs: ChatMessage[]): OAMessage[] {
  const out: OAMessage[] = system ? [{ role: "system", content: system }] : [];
  for (const m of msgs) {
    const text = m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
    if (m.role === "assistant") {
      const calls = m.content.filter((p): p is Extract<Part, { type: "tool_call" }> => p.type === "tool_call");
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) }, ...(c.extra ?? {}) })) } : {}) });
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
      ...providerParams(model),
    };
    // the reply is streamed: the headers come at once, so a model that thinks for minutes before answering is
    // not cut off by the HTTP client's 300-second wait for headers (Gemma on hard questions was)
    // a stream the provider cuts off halfway ("terminated") is asked for again: a chat request can be repeated
    let streamed: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        streamed = await readStream(await send(model, key, "/chat/completions", { ...body, stream: true, stream_options: { include_usage: true } }, req.signal));
        break;
      } catch (e) {
        if (req.signal?.aborted || attempt >= NET_RETRIES || !networkError(e) || localUrl(base(model))) throw e;
        await sleep(netBackoff(attempt), req.signal);
      }
    }
    const data = streamed as {
      choices: { message: { content?: string | null; tool_calls?: ({ id: string; type?: string; function: { name: string; arguments: string } } & Record<string, unknown>)[] }; finish_reason: string }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const choice = data.choices[0];
    const content: Part[] = [];
    const reply = splitThought(choice.message.content ?? "");
    if (reply.text) content.push({ type: "text", text: reply.text });
    for (const c of choice.message.tool_calls ?? []) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(c.function.arguments || "{}");
      } catch {
        input = { _raw: c.function.arguments };
      }
      // keep provider extras (Gemini returns extra_content.google.thought_signature, which must be sent back)
      const { id: _id, type: _type, function: _fn, ...extra } = c;
      void _id, void _type, void _fn;
      content.push({ type: "tool_call", id: c.id, name: c.function.name, input, ...(Object.keys(extra).length ? { extra } : {}) });
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
