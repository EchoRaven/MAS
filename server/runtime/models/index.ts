// The model gateway: resolves a catalog id to a provider, a key and a price,
// and reports usage for every call.
import fs from "node:fs";
import type { ModelSpec } from "@/model/types";
import type { Secrets } from "../../store/secrets";
import { anthropicProvider } from "./anthropic";
import { mockProvider } from "./mock";
import { openaiProvider } from "./openai";
import type { ChatRequest, ChatResponse, Provider } from "./types";

export * from "./types";

const PROVIDERS: Record<ModelSpec["provider"], Provider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: openaiProvider,
  openai_compatible: openaiProvider,
  local: openaiProvider,
  mock: mockProvider,
};

export interface Usage {
  model: string;
  tokens_in: number;
  tokens_out: number;
  usd: number;
}

/**
 * What the server has learned about each model by calling it: a model whose
 * account is out of credit, or whose server is not there, stays out of use for
 * an hour; one that answered recently is preferred. Keyed by provider, model and
 * key so that a new key starts clean.
 */
const HEALTH_TTL = 60 * 60_000;
const health = new Map<string, { ok: boolean; why?: string; at: number }>();
const healthKey = (m: ModelSpec) => `${m.provider}|${m.model}|${m.api.base_url ?? ""}|${m.api.key_env ?? ""}`;
const DEAD = /insufficient_quota|credit|prepayment|402|PerDay|ECONNREFUSED|fetch failed|ENOTFOUND|no longer available|404/i;

let healthFile: string | null = null;

/** Keep what was learned across restarts (it expires after an hour anyway). */
export function persistHealth(file: string) {
  healthFile = file;
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { ok: boolean; why?: string; at: number }>;
    for (const [k, v] of Object.entries(saved)) if (Date.now() - v.at < HEALTH_TTL) health.set(k, v);
  } catch {
    /* nothing saved yet */
  }
}

function saveHealth() {
  if (!healthFile) return;
  try {
    fs.writeFileSync(healthFile, JSON.stringify(Object.fromEntries(health)));
  } catch {
    /* best effort */
  }
}

export function noteHealth(m: ModelSpec, ok: boolean, err?: unknown) {
  const before = health.get(healthKey(m))?.ok;
  if (ok) health.set(healthKey(m), { ok: true, at: Date.now() });
  else {
    const msg = String((err as Error)?.message ?? err ?? "");
    if (!DEAD.test(msg)) return;
    health.set(healthKey(m), { ok: false, why: msg.replace(/\s+/g, " ").slice(0, 160), at: Date.now() });
  }
  if (before !== ok) saveHealth();
}

export function resetHealth() {
  health.clear();
}

export const MOCK_MODEL: ModelSpec = { id: "mock", provider: "mock", model: "mock", api: {}, price_in: 0, price_out: 0, modalities: ["text"] };

export class Models {
  constructor(
    private catalog: ModelSpec[],
    private secrets: Secrets,
    /** dry run: every model is the test model */
    readonly mockAll = false,
  ) {}

  spec(id: string | null | undefined, kind: "chat" | "embedding" | "rerank" = "chat"): ModelSpec {
    // a step that names no model gets the best one that works, not merely the first in the catalog
    const found = (id && this.catalog.find((m) => m.id === id)) || (!id ? (this.usable(kind)[0] ?? this.catalog.find((m) => (m.kind ?? "chat") === kind)) : undefined);
    if (!found) throw new Error(id ? `Unknown model "${id}" (not in the system's model catalog)` : `No ${kind} model in the catalog`);
    if (this.mockAll && found.provider !== "mock") return { ...MOCK_MODEL, id: found.id, kind: found.kind, api: { params: found.api.params?.script ? { script: found.api.params.script } : {} } };
    return found;
  }

  /** Why a model cannot be called from here, or null when it can (credit is not knowable in advance). */
  missingKey(m: ModelSpec): string | null {
    if (m.provider === "mock") return null;
    const h = health.get(healthKey(m));
    if (h && !h.ok && Date.now() - h.at < HEALTH_TTL) return `failed its last call (${h.why})`;
    if (!m.api.key_env || this.secrets.get(m.api.key_env)) return null;
    return m.provider === "anthropic" || m.provider === "openai" || m.provider === "google" ? `needs ${m.api.key_env}` : null;
  }

  /** Call each model whose health is not yet known, once, cheaply, so usable() can tell the working from the dead. */
  async probe(kinds: ("chat" | "embedding" | "rerank")[] = ["chat", "embedding", "rerank"]): Promise<void> {
    const unknown = this.catalog.filter((m) => kinds.includes((m.kind ?? "chat") as "chat") && m.provider !== "mock" && !this.missingKey(m) && !health.get(healthKey(m)));
    const call = (m: ModelSpec) => {
      const signal = AbortSignal.timeout(15_000);
      if (m.kind === "embedding") return this.embed(m.id, ["ok"], signal);
      if (m.kind === "rerank") return this.rerank(m.id, "ok", ["ok"], signal);
      return this.chat(m.id, { messages: [{ role: "user", content: [{ type: "text", text: "Reply OK." }] }], max_tokens: 5, signal });
    };
    await Promise.all(
      unknown.map((m) =>
        call(m).catch((e) =>
          // a probe that times out or cannot connect says the model is not usable now
          noteHealth(m, false, /abort|timeout/i.test(String(e)) ? new Error("fetch failed: timed out") : e),
        ),
      ),
    );
  }

  /** Catalog models that can be called, the ones that answered recently first. */
  usable(kind: "chat" | "embedding" | "rerank" = "chat"): ModelSpec[] {
    const proven = (m: ModelSpec) => (health.get(healthKey(m))?.ok ? 0 : 1);
    return this.catalog.filter((m) => (m.kind ?? "chat") === kind && m.provider !== "mock" && !this.missingKey(m)).sort((a, b) => proven(a) - proven(b));
  }

  private key(m: ModelSpec): string | undefined {
    if (m.provider === "mock") return undefined;
    const key = this.secrets.get(m.api.key_env);
    if (!key && m.api.key_env && (m.provider === "anthropic" || m.provider === "openai" || m.provider === "google")) throw new Error(`Model "${m.id}" needs ${m.api.key_env}: set it under Settings → Secrets`);
    return key;
  }

  price(m: ModelSpec, input: number, output: number) {
    return (input * m.price_in + output * m.price_out) / 1e6;
  }

  async chat(id: string | null | undefined, req: ChatRequest): Promise<{ res: ChatResponse; usage: Usage }> {
    const m = this.spec(id, "chat");
    let res: ChatResponse;
    try {
      res = await PROVIDERS[m.provider].chat(m, this.key(m), req);
      noteHealth(m, true);
    } catch (e) {
      noteHealth(m, false, e);
      throw e;
    }
    return { res, usage: { model: m.id, tokens_in: res.usage.input, tokens_out: res.usage.output, usd: this.price(m, res.usage.input, res.usage.output) } };
  }

  async embed(id: string | null | undefined, texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const m = this.spec(id, "embedding");
    const p = PROVIDERS[m.provider];
    if (!p.embed) throw new Error(`Provider ${m.provider} has no embeddings endpoint`);
    const out: number[][] = [];
    try {
      for (let i = 0; i < texts.length; i += 64) out.push(...(await p.embed(m, this.key(m), texts.slice(i, i + 64), signal)));
      noteHealth(m, true);
    } catch (e) {
      noteHealth(m, false, e);
      throw e;
    }
    return out;
  }

  async rerank(id: string | null | undefined, query: string, docs: string[], signal?: AbortSignal): Promise<number[]> {
    const m = this.spec(id, "rerank");
    const p = PROVIDERS[m.provider];
    if (!p.rerank) throw new Error(`Provider ${m.provider} has no rerank endpoint`);
    try {
      const out = await p.rerank(m, this.key(m), query, docs, signal);
      noteHealth(m, true);
      return out;
    } catch (e) {
      noteHealth(m, false, e);
      throw e;
    }
  }
}
