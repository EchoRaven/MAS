// The environment contract (mas-env/1) and importers into it.
//
// An environment can be plugged in when it can say:
//   1. how to start / stop it and how to tell it is healthy   (lifecycle.health is required)
//   2. how to put it back to a clean state                    (lifecycle.reset, needed for repeatable runs)
//   3. what agents can use: an MCP server and/or HTTP bases   (exposes)
//   4. how to log in and which test accounts exist            (auth; secrets only by env var name)
//
// Accepted inputs: a mas-env manifest (one, or `envs: [...]`), a DT
// (DecodingTrust) envs/registry.yaml, or a bare docker-compose file. For a DT
// env directory or an env-gen delivery, `scripts/import-env.mjs <dir>` reads
// the whole tree (compose, MCP server, reset routes, seeds) and writes a full
// manifest.
import YAML from "yaml";
import type { EnvData, EnvKind, EnvManifest } from "./types";
import type { Issue } from "./validate";

export const CONTRACT = "mas-env/1" as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const slugId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "env";

export interface ParsedEnvs {
  manifests: EnvManifest[];
  detected: "mas-env" | "dtap" | "compose";
  notes: string[];
}

export class EnvImportError extends Error {}

/** Normalise a hand-written or generated manifest; missing optional parts get empty defaults. */
export function normaliseManifest(raw: Record<string, unknown>): EnvManifest {
  const name = String(raw.name ?? raw.id ?? "Imported env");
  const lifecycle = isObj(raw.lifecycle) ? raw.lifecycle : {};
  const runtime = isObj(raw.runtime) ? raw.runtime : {};
  const exposes = isObj(raw.exposes) ? raw.exposes : {};
  return {
    contract: CONTRACT,
    id: slugId(String(raw.id ?? name)),
    name,
    version: raw.version != null ? String(raw.version) : undefined,
    source: isObj(raw.source) ? (raw.source as EnvManifest["source"]) : { format: "mas-env" },
    kind: (["web_app", "sandbox", "service"].includes(String(raw.kind)) ? raw.kind : "service") as EnvManifest["kind"],
    runtime: { ...runtime, services: Array.isArray(runtime.services) ? (runtime.services as EnvManifest["runtime"]["services"]) : [] },
    lifecycle: { ...(lifecycle as object), health: String(lifecycle.health ?? "") } as EnvManifest["lifecycle"],
    exposes: { http: Array.isArray(exposes.http) ? (exposes.http as EnvManifest["exposes"]["http"]) : [], mcp: isObj(exposes.mcp) ? ({ tools: [], auth: "none", transport: "http", ...exposes.mcp } as EnvManifest["exposes"]["mcp"]) : null },
    auth: isObj(raw.auth) ? (raw.auth as EnvManifest["auth"]) : null,
    state: isObj(raw.state) ? ({ seed: [], ...raw.state } as EnvManifest["state"]) : null,
    tasks: isObj(raw.tasks) ? (raw.tasks as EnvManifest["tasks"]) : null,
  };
}

/** "8078:8083" | 8078 | { published: 8078 } -> 8078 */
function hostPort(p: unknown): number | null {
  if (typeof p === "number") return p;
  if (typeof p === "string") {
    const parts = p.split("/")[0].split(":");
    const n = Number(parts.length >= 2 ? parts[parts.length - 2] : parts[0]);
    return Number.isFinite(n) ? n : null;
  }
  if (isObj(p) && p.published != null) return Number(p.published);
  return null;
}

function fromCompose(raw: Record<string, unknown>, name: string): EnvManifest {
  const services = Object.entries(raw.services as Record<string, Record<string, unknown>>).map(([svc, def]) => {
    const ports = Array.isArray(def?.ports) ? def.ports : [];
    const env = isObj(def?.environment) ? def.environment : {};
    const portEnv = Object.keys(env).find((k) => /PORT$/.test(k));
    return { name: svc, image: typeof def?.image === "string" ? def.image : undefined, port: hostPort(ports[0]), port_env: portEnv };
  });
  const api = services.find((s) => /api|backend|server/.test(s.name) && s.port) ?? services.find((s) => s.port);
  const ui = services.find((s) => /ui|frontend|web/.test(s.name) && s.port && s !== api);
  const http = [api && { name: "api", base: `http://127.0.0.1:${api.port}` }, ui && { name: "ui", base: `http://127.0.0.1:${ui.port}` }].filter(Boolean) as { name: string; base: string }[];
  return normaliseManifest({
    id: name,
    name,
    source: { format: "compose" },
    kind: ui ? "web_app" : "service",
    runtime: { compose: "docker-compose.yml", variant: services.every((s) => s.image) ? "hub" : "build", network: Object.values(raw.services as object).some((d) => (d as Record<string, unknown>)?.network_mode === "host") ? "host" : "bridge", services },
    lifecycle: { start: "docker compose up -d", stop: "docker compose down", health: api ? `GET http://127.0.0.1:${api.port}/health` : "" },
    exposes: { http },
  });
}

/** DT envs/registry.yaml: { <env>: { api_base_url, ui_base_url, health_path } }, possibly under a top-level key. */
function fromDtRegistry(entries: Record<string, Record<string, unknown>>): EnvManifest[] {
  return Object.entries(entries).map(([id, e]) => {
    const api = String(e.api_base_url ?? e.base_url ?? "");
    const ui = e.ui_base_url ? String(e.ui_base_url) : undefined;
    return normaliseManifest({
      id,
      name: id,
      source: { format: "dtap", path: `dt_arena/envs/${id}` },
      kind: ui ? "web_app" : "service",
      runtime: { compose: `dt_arena/envs/${id}/docker-compose.yml`, variant: "hub", network: "host", services: [] },
      lifecycle: { start: "docker compose up -d", stop: "docker compose down", health: api ? `GET ${api}${String(e.health_path ?? "/health")}` : "" },
      exposes: {
        http: [{ name: "api", base: api }, ...(ui ? [{ name: "ui", base: ui }] : [])],
        mcp: { transport: "stdio", start: `cd dt_arena/mcp_server/${id} && uv run python main.py`, auth: "bearer_env", env: { API_BASE_URL: api }, tools: [] },
      },
    });
  });
}

const looksLikeRegistry = (o: Record<string, unknown>) => Object.values(o).length > 0 && Object.values(o).every((v) => isObj(v) && ("api_base_url" in v || "base_url" in v));

export function parseEnvFile(text: string, filename = "env.yaml"): ParsedEnvs {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    throw new EnvImportError(`YAML syntax error: ${(err as Error).message}`);
  }
  if (!isObj(raw)) throw new EnvImportError("Expected a mapping at the top level");
  if (raw.contract === CONTRACT || (raw.lifecycle && raw.exposes)) return { manifests: [normaliseManifest(raw)], detected: "mas-env", notes: [] };
  if (Array.isArray(raw.envs)) return { manifests: raw.envs.filter(isObj).map(normaliseManifest), detected: "mas-env", notes: [] };
  if (isObj(raw.services)) {
    const base = filename.replace(/\.(ya?ml)$/i, "").replace(/docker-compose(-hub)?/i, "") || "compose";
    return {
      manifests: [fromCompose(raw, slugId(base) || "compose_env")],
      detected: "compose",
      notes: ["Read from a compose file: services, ports and a guessed health URL. Run scripts/import-env.mjs on the env's folder to also pick up its MCP tools, reset routes and seed data."],
    };
  }
  const reg = isObj(raw.environments) ? raw.environments : isObj(raw.envs) ? raw.envs : raw;
  if (looksLikeRegistry(reg as Record<string, unknown>)) {
    return {
      manifests: fromDtRegistry(reg as Record<string, Record<string, unknown>>),
      detected: "dtap",
      notes: ["Read from a DT registry: base URLs and health path only. The MCP tool list and reset route come from the env's folder (scripts/import-env.mjs)."],
    };
  }
  throw new EnvImportError("Not a mas-env manifest, a DT registry.yaml or a docker-compose file");
}

/** Does this manifest meet the contract? Errors block import; warnings are shown. */
export function checkContract(m: EnvManifest): Issue[] {
  const out: Issue[] = [];
  if (!m.id) out.push({ severity: "error", message: "No id" });
  if (!m.lifecycle.health) out.push({ severity: "error", message: "No health check (lifecycle.health): the platform cannot tell when the env is ready" });
  if (!m.exposes.mcp && m.exposes.http.length === 0) out.push({ severity: "error", message: "Exposes nothing to agents: give an MCP server or at least one HTTP base" });
  if (!m.lifecycle.reset) out.push({ severity: "warning", message: "No reset: runs cannot start from a clean state, so results are not repeatable" });
  if (!m.lifecycle.start && !m.runtime.compose) out.push({ severity: "warning", message: "No start command or compose file: it must already be running" });
  if (m.exposes.mcp && m.exposes.mcp.tools.length === 0) out.push({ severity: "warning", message: "The MCP server lists no tools yet; they will be discovered when it starts" });
  if (m.exposes.mcp?.auth === "oauth_jwks" && !m.auth?.login) out.push({ severity: "warning", message: "MCP uses OAuth but the manifest has no login route for test users" });
  if (m.auth?.test_users?.some((u) => !u.password_env)) out.push({ severity: "info", message: "Some test users have no password_env; passwords are never stored in the manifest" });
  return out;
}

const ENV_KIND: Record<EnvManifest["kind"], EnvKind> = { web_app: "app", sandbox: "sandbox", service: "service" };

export function envFromManifest(m: EnvManifest): EnvData {
  return {
    kind: "env",
    name: m.name,
    env_kind: ENV_KIND[m.kind],
    image: m.runtime.services.find((s) => s.image)?.image ?? "",
    lifecycle: "per_run",
    snapshot: m.lifecycle.reset ? "on_checkpoint" : "never",
    egress: [],
    manifest: m,
  };
}

export function manifestToYaml(m: EnvManifest): string {
  return YAML.stringify(JSON.parse(JSON.stringify(m)), { lineWidth: 0 });
}
