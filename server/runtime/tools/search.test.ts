// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatSearch, geminiSearch, resolveSources } from "./search";

describe("web_search through the Gemini API", () => {
  it("reads the answer, the queries and the numbered sources, and counts the tokens", async () => {
    let sent: { url: string; body: any; key: string | null } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get("x-goog-api-key") };
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Completed in 1889; 330 m." }] }, groundingMetadata: { webSearchQueries: ["eiffel tower height"], groundingChunks: [{ web: { title: "britannica.com", uri: "https://r.example/1" } }, { web: { title: "x" } }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1000 },
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await geminiSearch("k", "Eiffel Tower", fake);
    expect(sent!.body.tools).toEqual([{ google_search: {} }]);
    expect(sent!.key).toBe("k");
    expect(r.text).toContain("Completed in 1889; 330 m.");
    expect(r.text).toContain("[1] britannica.com: https://r.example/1");
    expect(r.text).not.toContain("[2]"); // a chunk without a URL is no source
    expect(r.usage.usd).toBeCloseTo((1000 * 0.25 + 1000 * 1.5) / 1e6);
  });

  it("resolves Google's expiring redirect links to the pages they point to, keeping any that do not resolve", async () => {
    const fake = (async (url: string) =>
      url.endsWith("/ok") ? new Response(null, { status: 302, headers: { location: "https://site.example/page" } }) : new Response("gone", { status: 404 })) as unknown as typeof fetch;
    const out = await resolveSources([
      { title: "site.example", uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ok" },
      { title: "old", uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/gone" },
      { title: "plain", uri: "https://plain.example/x" },
    ], fake);
    expect(out.map((s) => s.uri)).toEqual(["https://site.example/page", "https://vertexaisearch.cloud.google.com/grounding-api-redirect/gone", "https://plain.example/x"]);
  });

  it("says so when no source came back, and fails on a provider error", async () => {
    expect(formatSearch("text", [], [])).toContain("Sources: none returned");
    const bad = (async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })) as unknown as typeof fetch;
    await expect(geminiSearch("k", "q", bad)).rejects.toThrow(/web_search: quota/);
  });
});
