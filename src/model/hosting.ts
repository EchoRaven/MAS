// Endpoints: where a component outside the platform's own code lives. One
// shape for MCP servers, plugin backends, catalog tools and envs, with two
// sources:
//   remote   a URL somewhere else (with auth headers or a bearer secret)
//   hosted   a service running on this server: code someone uploaded (or a
//            git repository), built and run in Docker, isolated
// At run time either one resolves to a URL to call, or to a command that
// speaks MCP on stdio.

/** agent-stdio: an agent program (the custom-stdio protocol), a fresh container per turn */
export type ExposeKind = "mcp-stdio" | "mcp-http" | "http" | "agent-stdio";

export type Endpoint =
  | { remote: { url: string; headers?: Record<string, string>; bearer_env?: string } }
  | { hosted: { service: string; path?: string } };

/**
 * How a hosted project runs: mas-host.yaml (or .json) at the top of the
 * project, or set on the service. Everything but start can be inferred.
 */
export interface HostManifest {
  name?: string;
  /** auto: a compose file if there is one (several containers), else a Dockerfile, else python (requirements.txt / pyproject.toml) or node (package.json) */
  runtime?: "auto" | "compose" | "dockerfile" | "python" | "node";
  /** replaces the inferred install step (pip install -r requirements.txt, npm ci) */
  install?: string;
  /** the command that starts the service, run in /app */
  start?: string;
  /** service: for a compose project, the service that is reached (its port, path and health) */
  expose: { kind: ExposeKind; port?: number; path?: string; health?: string; service?: string };
  /**
   * hosts the service needs to reach ("api.github.com", "*.example.com", "host:8443").
   * Empty (the default): no network at all. Otherwise these hosts only, through the
   * platform's egress proxy (HTTPS_PROXY); nothing else, and nothing private.
   */
  egress?: string[];
  /** environment variables: a value, or { secret: NAME } for a secret from Settings */
  env?: Record<string, string | { secret: string }>;
  memory?: string;
  cpus?: number;
  /** mcp-http / http: stop the container after this many minutes without use (it starts again when next used); 0 = never. Default 30 */
  idle_minutes?: number;
}

export const DEFAULT_MANIFEST: HostManifest = { runtime: "auto", expose: { kind: "mcp-stdio" }, egress: [], env: {} };

/** What is wrong with a manifest, if anything: the reasons, for the person who wrote it. */
export function checkManifest(m: HostManifest): string[] {
  const why: string[] = [];
  const kinds: ExposeKind[] = ["mcp-stdio", "mcp-http", "http", "agent-stdio"];
  if (!m.expose || !kinds.includes(m.expose.kind)) why.push(`expose.kind must be one of ${kinds.join(", ")}`);
  if (m.expose && m.expose.kind !== "mcp-stdio" && m.expose.kind !== "agent-stdio" && !(Number.isInteger(m.expose.port) && m.expose.port! > 0 && m.expose.port! < 65536)) why.push(`${m.expose.kind} needs expose.port (the port the service listens on)`);
  if (m.runtime && !["auto", "compose", "dockerfile", "python", "node"].includes(m.runtime)) why.push("runtime must be auto, compose, dockerfile, python or node");
  if (m.runtime !== "dockerfile" && m.runtime !== "compose" && m.start !== undefined && !String(m.start).trim()) why.push("start is empty");
  for (const h of m.egress ?? []) if (!/^[A-Za-z0-9.-]+(:\d+)?$/.test(h)) why.push(`egress host "${h}" is not a host name`);
  for (const [k, v] of Object.entries(m.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) why.push(`env name "${k}" is not a valid variable name`);
    if (typeof v === "object" && !(v && typeof v.secret === "string" && v.secret)) why.push(`env ${k}: { secret: NAME } needs a name`);
  }
  if (m.memory && !/^\d+[kmg]$/i.test(m.memory)) why.push('memory must look like "512m" or "2g"');
  if (m.idle_minutes != null && !(Number.isFinite(m.idle_minutes) && m.idle_minutes >= 0)) why.push("idle_minutes must be 0 (never) or a number of minutes");
  return why;
}

/** The runtime to build with, from what the project contains. */
export const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

export function detectRuntime(files: string[], asked: HostManifest["runtime"] = "auto"): "compose" | "dockerfile" | "python" | "node" | null {
  if (asked && asked !== "auto") return asked;
  if (COMPOSE_FILES.some((f) => files.includes(f))) return "compose";
  if (files.includes("Dockerfile")) return "dockerfile";
  if (files.includes("requirements.txt") || files.includes("pyproject.toml") || files.some((f) => f.endsWith(".py"))) return "python";
  if (files.includes("package.json")) return "node";
  return null;
}

/** The Dockerfile for a project without its own: a slim base, the project in /app, its dependencies installed. */
export function generatedDockerfile(runtime: "python" | "node", files: string[], m: HostManifest): string {
  const install =
    m.install ??
    (runtime === "python"
      ? files.includes("requirements.txt")
        ? "pip install --no-cache-dir -r requirements.txt"
        : files.includes("pyproject.toml")
          ? "pip install --no-cache-dir ."
          : ""
      : files.includes("package-lock.json")
        ? "npm ci --omit=dev"
        : "npm install --omit=dev");
  const base = runtime === "python" ? "python:3.12-slim" : "node:22-slim";
  return [
    `FROM ${base}`,
    "WORKDIR /app",
    "COPY . /app",
    ...(install ? [`RUN ${install}`] : []),
    // the service runs as an unprivileged user
    "RUN useradd -m -u 10001 svc 2>/dev/null || adduser -D -u 10001 svc 2>/dev/null || true",
    "USER 10001",
    `CMD ["sh", "-c", ${JSON.stringify(m.start ?? "")}]`,
    "",
  ].join("\n");
}
