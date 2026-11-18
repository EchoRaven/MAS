// The model gateway: how an agent program in a container reaches a model
// provider without holding a key. The container calls
// http://<gateway>/<provider>/<api path> with a token issued for its turn;
// the gateway checks the token and the path, swaps in the real key from
// Settings, and makes the TLS request from this host. Every request, allowed
// or refused, goes to the run's log. Paths other than the provider's model
// endpoints (account, billing, admin, files…) are refused.
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import type { Secrets } from "../store/secrets";

export interface ModelRoute {
  /** the upstream base URL, https://api.anthropic.com */
  upstream: string;
  /** the secret that holds the key */
  key: string;
  /** how the key is sent upstream */
  auth: "x-api-key" | "bearer" | "x-goog-api-key";
  /** API paths a model call may use; anything else is refused */
  paths: RegExp[];
}

export const MODEL_ROUTES: Record<string, ModelRoute> = {
  anthropic: { upstream: "https://api.anthropic.com", key: "ANTHROPIC_API_KEY", auth: "x-api-key", paths: [/^\/v1\/messages(\/count_tokens)?$/, /^\/v1\/models(\/[\w.-]+)?$/] },
  openai: { upstream: "https://api.openai.com", key: "OPENAI_API_KEY", auth: "bearer", paths: [/^\/v1\/(chat\/completions|responses|embeddings)$/, /^\/v1\/responses\/[\w-]+$/, /^\/v1\/models(\/[\w.:-]+)?$/] },
  google: { upstream: "https://generativelanguage.googleapis.com", key: "GEMINI_API_KEY", auth: "x-goog-api-key", paths: [/^\/v1(beta)?\/models\/[\w.-]+:(generateContent|streamGenerateContent|countTokens|embedContent)$/, /^\/v1beta\/openai\/(chat\/completions|embeddings|models)$/] },
};

export interface GatewayAccess {
  at: string;
  method: string;
  provider: string;
  path: string;
  allowed: boolean;
  status?: number;
  why?: string;
}

interface Grant {
  run: string;
  agent: string;
  providers: Set<string>;
  onAccess?: (a: GatewayAccess) => void;
}

const HOP = new Set(["host", "connection", "keep-alive", "proxy-authorization", "transfer-encoding", "upgrade", "authorization", "x-api-key", "x-goog-api-key", "content-length"]);

export class ModelGateway {
  private grants = new Map<string, Grant>();
  /** where containers reach it: http://<gateway>:<port>, once listening */
  url: string | null = null;

  constructor(
    private secrets: Secrets,
    private routes: Record<string, ModelRoute> = MODEL_ROUTES,
  ) {}

  /** A token for one turn of one agent, for the given providers. Revoke it when the turn ends. */
  grant(run: string, agent: string, providers: string[], onAccess?: (a: GatewayAccess) => void): string {
    const token = `mas-gw-${crypto.randomBytes(24).toString("hex")}`;
    this.grants.set(token, { run, agent, providers: new Set(providers), onAccess });
    return token;
  }
  revoke(token: string) {
    this.grants.delete(token);
  }

  /** The base URL a container sets for a provider (ANTHROPIC_BASE_URL, OPENAI_BASE_URL…). */
  baseUrl(provider: string): string {
    if (!this.url) throw new Error("The model gateway is not listening (is Docker available?)");
    return `${this.url}/${provider}`;
  }

  handle = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://gateway");
    const [, provider, ...rest] = url.pathname.split("/");
    const apiPath = `/${rest.join("/")}`;
    const h = req.headers;
    const bearer = (h.authorization ?? "").replace(/^Bearer\s+/i, "");
    const token = String(h["x-api-key"] ?? h["x-goog-api-key"] ?? (bearer || url.searchParams.get("key") || ""));
    const grant = this.grants.get(token);
    const log = (a: Omit<GatewayAccess, "at" | "method" | "provider" | "path">) => grant?.onAccess?.({ at: new Date().toISOString(), method: req.method ?? "GET", provider: provider ?? "", path: apiPath, ...a });
    const refuse = (status: number, why: string) => {
      log({ allowed: false, status, why });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "gateway", message: why } }));
    };
    if (!grant) return refuse(401, "no valid token for this turn");
    const route = this.routes[provider ?? ""];
    if (!route || !grant.providers.has(provider)) return refuse(403, `provider ${provider} is not allowed for this agent`);
    if (!route.paths.some((p) => p.test(apiPath))) return refuse(403, `${apiPath} is not a model endpoint`);
    const key = this.secrets.get(route.key);
    if (!key) return refuse(403, `no ${route.key} in Settings → API keys`);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) if (!HOP.has(k.toLowerCase()) && typeof v === "string") headers[k] = v;
    if (route.auth === "bearer") headers.authorization = `Bearer ${key}`;
    else headers[route.auth] = key;
    const query = new URLSearchParams(url.search);
    query.delete("key");
    const target = new URL(`${route.upstream.replace(/\/$/, "")}${apiPath}${query.size ? `?${query}` : ""}`);
    const up = (target.protocol === "https:" ? https : http).request(target, { method: req.method, headers }, (r) => {
      log({ allowed: true, status: r.statusCode });
      res.writeHead(r.statusCode ?? 502, Object.fromEntries(Object.entries(r.headers).filter(([k]) => !["connection", "transfer-encoding"].includes(k))) as http.OutgoingHttpHeaders);
      r.pipe(res);
    });
    up.on("error", (e) => {
      if (res.headersSent) return void res.destroy();
      refuse(502, `upstream: ${e.message}`);
    });
    req.pipe(up);
  };
}
