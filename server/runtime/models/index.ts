// The model gateway: resolves a catalog id to a provider, a key and a price,
// and reports usage for every call.
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

export const MOCK_MODEL: ModelSpec = { id: "mock", provider: "mock", model: "mock", api: {}, price_in: 0, price_out: 0, modalities: ["text"] };

export class Models {
  constructor(
    private catalog: ModelSpec[],
    private secrets: Secrets,
    /** dry run: every model is the test model */
    readonly mockAll = false,
  ) {}

  spec(id: string | null | undefined, kind: "chat" | "embedding" | "rerank" = "chat"): ModelSpec {
    const found = (id && this.catalog.find((m) => m.id === id)) || (!id ? this.catalog.find((m) => (m.kind ?? "chat") === kind) : undefined);
    if (!found) throw new Error(id ? `Unknown model "${id}" (not in the system's model catalog)` : `No ${kind} model in the catalog`);
    if (this.mockAll && found.provider !== "mock") return { ...MOCK_MODEL, id: found.id, kind: found.kind, api: { params: found.api.params?.script ? { script: found.api.params.script } : {} } };
    return found;
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
    const res = await PROVIDERS[m.provider].chat(m, this.key(m), req);
    return { res, usage: { model: m.id, tokens_in: res.usage.input, tokens_out: res.usage.output, usd: this.price(m, res.usage.input, res.usage.output) } };
  }

  async embed(id: string | null | undefined, texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const m = this.spec(id, "embedding");
    const p = PROVIDERS[m.provider];
    if (!p.embed) throw new Error(`Provider ${m.provider} has no embeddings endpoint`);
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) out.push(...(await p.embed(m, this.key(m), texts.slice(i, i + 64), signal)));
    return out;
  }

  async rerank(id: string | null | undefined, query: string, docs: string[], signal?: AbortSignal): Promise<number[]> {
    const m = this.spec(id, "rerank");
    const p = PROVIDERS[m.provider];
    if (!p.rerank) throw new Error(`Provider ${m.provider} has no rerank endpoint`);
    return p.rerank(m, this.key(m), query, docs, signal);
  }
}
