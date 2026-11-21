// web_search on models other than Anthropic's: a grounded call to the Gemini API (generateContent with its
// google_search tool), which searches, reads and answers with its sources. Anthropic models search with their
// provider's own server tool instead. Needs GEMINI_API_KEY.
import type { Usage } from "../models";

/** The model that runs the search (MAS_SEARCH_MODEL), and its price per million tokens in and out. */
const SEARCH_MODEL = () => process.env.MAS_SEARCH_MODEL || "gemini-3.1-flash-lite";
const PRICE = { in: 0.25, out: 1.5 };

// searches share one pace: at most one a second (60 a minute, the platform's request cap)
let next = 0;
async function pace() {
  const now = Date.now();
  const wait = Math.max(0, next - now);
  next = Math.max(now, next) + 1000;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export interface SearchResult {
  text: string;
  usage: Usage;
}

/** The answer with its numbered sources, as the agent reads it. */
export function formatSearch(answer: string, sources: { title?: string; uri?: string }[], queries: string[]): string {
  const list = sources.map((s, i) => `[${i + 1}] ${s.title ?? "source"}: ${s.uri ?? ""}`).join("\n");
  return [queries.length ? `Searched: ${queries.join("; ")}` : "", answer.trim() || "(no answer)", list ? `Sources:\n${list}` : "Sources: none returned"].filter(Boolean).join("\n\n");
}

/**
 * Google's source links are redirects that expire within minutes, so an agent citing one later cites nothing,
 * and given only the site's name an agent makes up the rest of the URL. Each is resolved at once to the page
 * it points to (the redirect's Location, which is read, never fetched); one that does not resolve stays as is.
 */
export async function resolveSources(sources: { title?: string; uri?: string }[], fetchImpl: typeof fetch = fetch) {
  return Promise.all(
    sources.map(async (s) => {
      if (!s.uri || !/^https:\/\/vertexaisearch\.cloud\.google\.com\//.test(s.uri)) return s;
      try {
        const r = await fetchImpl(s.uri, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
        const to = r.headers.get("location");
        return to && /^https?:\/\//.test(to) ? { ...s, uri: to } : s;
      } catch {
        return s;
      }
    }),
  );
}

export async function geminiSearch(key: string, query: string, fetchImpl: typeof fetch = fetch): Promise<SearchResult> {
  await pace();
  const model = SEARCH_MODEL();
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `Search the web for this and report what the sources say, concisely and factually:\n\n${query}` }] }],
      tools: [{ google_search: {} }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { title?: string; uri?: string } }[]; webSearchQueries?: string[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  if (!res.ok || j.error) throw new Error(`web_search: ${j.error?.message ?? `HTTP ${res.status}`}`);
  const c = j.candidates?.[0];
  const answer = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const sources = await resolveSources((c?.groundingMetadata?.groundingChunks ?? []).map((g) => g.web ?? {}).filter((w) => w.uri), fetchImpl);
  const tokens_in = j.usageMetadata?.promptTokenCount ?? 0;
  const tokens_out = j.usageMetadata?.candidatesTokenCount ?? 0;
  // Google bills each grounded search on top of the tokens; set its price to count it (it is not known here)
  const perQuery = Number(process.env.MAS_SEARCH_USD_PER_QUERY ?? 0) || 0;
  const usd = (tokens_in * PRICE.in + tokens_out * PRICE.out) / 1e6 + perQuery;
  return { text: formatSearch(answer, sources, c?.groundingMetadata?.webSearchQueries ?? []), usage: { model, tokens_in, tokens_out, usd } };
}
