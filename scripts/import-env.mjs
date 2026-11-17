#!/usr/bin/env node
// Build a mas-env/1 manifest from an environment folder. Read-only: it never
// writes into the folder, it prints YAML (or writes to -o <file>).
//
//   node scripts/import-env.mjs <dir> [-o env.mas.yaml]
//
// Recognised layouts
//   env-gen delivery   project.json + docker/docker-compose.yml + mcp_server/app/main.py
//   DT env             .../dt_arena/envs/<env>/docker-compose*.yml, registry at ../registry.yaml,
//                      MCP proxy at ../../mcp_server/<env>/main.py
//   plain compose      <dir>/docker-compose.yml
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("-"));
const outIdx = args.indexOf("-o");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
if (!dir) {
  console.error("usage: node scripts/import-env.mjs <dir> [-o env.mas.yaml]");
  process.exit(2);
}
const root = path.resolve(dir);
const at = (...p) => (path.isAbsolute(p[0]) ? path.join(...p) : path.join(root, ...p));
const exists = (...p) => fs.existsSync(at(...p));
const read = (...p) => fs.readFileSync(at(...p), "utf8");
const readYaml = (...p) => YAML.parse(read(...p));
const firstExisting = (base, names) => names.find((n) => exists(base, n));

/** Tool names of a FastMCP server: functions decorated with @mcp.tool. */
function mcpTools(file) {
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, "utf8");
  const re = /@mcp\.tool[^\n]*\n(?:\s*@[^\n]*\n)*\s*(?:async\s+)?def\s+(\w+)/g;
  const names = [];
  for (let m; (m = re.exec(src)); ) names.push(m[1]);
  return [...new Set(names)];
}

function hostPort(p) {
  if (typeof p === "number") return p;
  if (typeof p === "string") {
    const parts = p.split("/")[0].split(":");
    const raw = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    const env = /\$\{(\w+):-(\d+)\}/.exec(raw);
    if (env) return { port: Number(env[2]), port_env: env[1] };
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (p && typeof p === "object" && p.published != null) return Number(p.published);
  return null;
}

function composeServices(composePath) {
  const c = YAML.parse(fs.readFileSync(composePath, "utf8")) ?? {};
  const services = Object.entries(c.services ?? {}).map(([name, def]) => {
    const env = Array.isArray(def?.environment)
      ? Object.fromEntries(def.environment.map((kv) => String(kv).split("=")))
      : (def?.environment ?? {});
    let port = null;
    let port_env;
    const hp = hostPort((def?.ports ?? [])[0]);
    if (hp && typeof hp === "object") ({ port, port_env } = hp);
    else port = hp;
    if (port == null) {
      // host networking: the port is an env knob like ${NETFLIX_API_PORT:-8078}
      for (const [k, v] of Object.entries(env)) {
        const m = /\$\{(\w+):-(\d+)\}/.exec(String(v));
        if (/PORT$/.test(k) && m) { port = Number(m[2]); port_env = m[1]; break; }
        if (/PORT$/.test(k) && /^\d+$/.test(String(v))) { port = Number(v); port_env = k; break; }
      }
    }
    const svc = { name };
    if (typeof def?.image === "string") svc.image = def.image;
    svc.port = port;
    if (port_env) svc.port_env = port_env;
    return svc;
  });
  const host = Object.values(c.services ?? {}).some((d) => d?.network_mode === "host");
  const build = Object.values(c.services ?? {}).some((d) => d?.build);
  return { services, network: host ? "host" : "bridge", variant: build ? "build" : "hub" };
}

/** Which control routes a FastAPI backend serves. */
function controlRoutes(file) {
  if (!file || !fs.existsSync(file)) return {};
  const src = fs.readFileSync(file, "utf8");
  const has = (r) => src.includes(`"${r}"`) || src.includes(`'${r}'`);
  return {
    health: has("/health") ? "/health" : undefined,
    reset: has("/api/v1/reset") ? "/api/v1/reset" : undefined,
    init_tenant: has("/api/v1/admin/init-tenant") ? "/api/v1/admin/init-tenant" : undefined,
    login: has("/auth/login") ? "/auth/login" : undefined,
    oauth: src.includes("/.well-known/jwks.json") || src.includes("jwks"),
  };
}

const rel = (p) => path.relative(root, p) || ".";
const listSeeds = (patterns) => patterns.flatMap(([d, re]) => (fs.existsSync(path.join(root, d)) ? fs.readdirSync(path.join(root, d)).filter((f) => re.test(f)).map((f) => path.join(d, f)) : []));

function envgen() {
  const project = readYaml("project.json");
  const composeRel = "docker/docker-compose.yml";
  const { services, network, variant } = composeServices(path.join(root, composeRel));
  const api = services.find((s) => /backend|api/.test(s.name) && s.port) ?? services.find((s) => s.port);
  const ui = services.find((s) => /frontend|ui|web/.test(s.name) && s.port && s !== api);
  const apiBase = api ? `http://127.0.0.1:${api.port}` : "";
  const routes = controlRoutes(path.join(root, "app/backend/main.py"));
  const mcpDir = "mcp_server/app";
  const tools = mcpTools(path.join(root, mcpDir, "main.py"));
  let mcpPort = 8890;
  if (exists(mcpDir, "start.sh")) {
    const m = /PORT[:=-]+\$?\{?PORT:-?(\d+)|PORT=(\d+)/.exec(read(mcpDir, "start.sh"));
    if (m) mcpPort = Number(m[1] ?? m[2]);
  }
  const config = exists("config.yaml") ? readYaml("config.yaml") : {};
  const snapshots = exists("snapshots") ? "snapshots" : undefined;
  const name = String(project.name ?? project.project_name ?? path.basename(root));
  return {
    contract: "mas-env/1",
    id: path.basename(root).replace(/[^a-z0-9]+/gi, "_").toLowerCase(),
    name,
    version: config.release_tag != null ? String(config.release_tag) : undefined,
    source: { format: "envgen", path: root },
    kind: ui ? "web_app" : "service",
    runtime: { compose: composeRel, variant, network, services },
    lifecycle: {
      start: `docker compose -f ${composeRel} up -d`,
      stop: `docker compose -f ${composeRel} down`,
      health: apiBase ? `GET ${apiBase}${routes.health ?? "/health"}` : "",
      reset: routes.reset ? `POST ${apiBase}${routes.reset}` : exists("app/backend/reset.sh") ? "exec app/backend/reset.sh" : undefined,
      init_tenant: routes.init_tenant ? `POST ${apiBase}${routes.init_tenant}` : undefined,
    },
    exposes: {
      http: [apiBase && { name: "api", base: apiBase }, ui && { name: "ui", base: `http://127.0.0.1:${ui.port}` }].filter(Boolean),
      mcp: tools.length
        ? {
            transport: "http",
            start: `cd ${mcpDir} && ./start.sh`,
            url: `http://127.0.0.1:${mcpPort}/mcp`,
            auth: routes.oauth ? "oauth_jwks" : "none",
            // start.sh defaults API_BASE_URL to 8080; the compose stack publishes the API elsewhere
            env: { API_BASE_URL: apiBase, PORT: String(mcpPort) },
            tools,
          }
        : null,
    },
    auth: routes.login ? { mode: "embedded", login: `POST ${apiBase}${routes.login}`, test_users: [] } : { mode: "none" },
    state: { seed: listSeeds([["app/database/init", /\.sql$/], ["app/backend", /^seed_.*\.json$/]]), ...(snapshots ? { snapshots } : {}) },
    tasks: exists("tasks") && fs.readdirSync(path.join(root, "tasks")).length ? { dir: "tasks" } : null,
  };
}

function dt() {
  const envName = path.basename(root);
  const composeName = firstExisting(root, ["docker-compose.yml", "docker-compose.yaml", "docker-compose-hub.yml", "docker-compose-hub.yaml"]);
  const { services, network, variant } = composeServices(path.join(root, composeName));
  const registryPath = path.join(root, "..", "registry.yaml");
  const reg = fs.existsSync(registryPath) ? (YAML.parse(fs.readFileSync(registryPath, "utf8")) ?? {}) : {};
  const entry = reg[envName] ?? reg.environments?.[envName] ?? {};
  const api = entry.api_base_url ?? (services.find((s) => /api|backend/.test(s.name) && s.port) ? `http://127.0.0.1:${services.find((s) => /api|backend/.test(s.name) && s.port).port}` : "");
  const ui = entry.ui_base_url;
  const mcpDir = path.join(root, "..", "..", "mcp_server", envName);
  const tools = mcpTools(path.join(mcpDir, "main.py"));
  const routes = controlRoutes(firstExisting(root, ["api/main.py", "backend/main.py"]) ? path.join(root, firstExisting(root, ["api/main.py", "backend/main.py"])) : null);
  return {
    contract: "mas-env/1",
    id: envName,
    name: envName,
    source: { format: "dtap", path: root },
    kind: ui ? "web_app" : "service",
    runtime: { compose: composeName, variant, network, services },
    lifecycle: {
      start: `docker compose -f ${composeName} up -d`,
      stop: `docker compose -f ${composeName} down`,
      health: api ? `GET ${api}${entry.health_path ?? routes.health ?? "/health"}` : "",
      reset: routes.reset ? `POST ${api}${routes.reset}` : exists("reset.sh") ? "exec reset.sh" : undefined,
      init_tenant: routes.init_tenant ? `POST ${api}${routes.init_tenant}` : undefined,
    },
    exposes: {
      http: [api && { name: "api", base: api }, ui && { name: "ui", base: ui }].filter(Boolean),
      mcp: fs.existsSync(mcpDir)
        ? { transport: "stdio", start: `cd ${path.relative(root, mcpDir)} && uv run python main.py`, auth: "bearer_env", env: { API_BASE_URL: api, USER_ACCESS_TOKEN: "${USER_ACCESS_TOKEN}" }, tools }
        : null,
    },
    auth: routes.login ? { mode: "embedded", login: `POST ${api}${routes.login}` } : null,
    state: { seed: listSeeds([["init", /\.(sql|json)$/]]) },
  };
}

function compose() {
  const composeName = firstExisting(root, ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]);
  const { services, network, variant } = composeServices(path.join(root, composeName));
  const api = services.find((s) => /api|backend|server/.test(s.name) && s.port) ?? services.find((s) => s.port);
  const apiBase = api ? `http://127.0.0.1:${api.port}` : "";
  return {
    contract: "mas-env/1",
    id: path.basename(root).replace(/[^a-z0-9]+/gi, "_").toLowerCase(),
    name: path.basename(root),
    source: { format: "compose", path: root },
    kind: "service",
    runtime: { compose: composeName, variant, network, services },
    lifecycle: { start: `docker compose -f ${composeName} up -d`, stop: `docker compose -f ${composeName} down`, health: apiBase ? `GET ${apiBase}/health` : "" },
    exposes: { http: apiBase ? [{ name: "api", base: apiBase }] : [], mcp: null },
  };
}

let manifest;
if (exists("project.json") && exists("docker", "docker-compose.yml")) manifest = envgen();
else if (root.includes(`${path.sep}envs${path.sep}`) && firstExisting(root, ["docker-compose.yml", "docker-compose.yaml", "docker-compose-hub.yml", "docker-compose-hub.yaml"])) manifest = dt();
else if (firstExisting(root, ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"])) manifest = compose();
else {
  console.error(`No env layout recognised in ${rel(root)} (want an env-gen delivery, a DT env folder or a compose file)`);
  process.exit(1);
}

const clean = (o) => JSON.parse(JSON.stringify(o)); // drops undefined
const text = `# mas-env/1 manifest, generated by scripts/import-env.mjs from ${manifest.source.format}\n` + YAML.stringify(clean(manifest), { lineWidth: 0 });
if (outFile) {
  fs.writeFileSync(outFile, text);
  console.error(`wrote ${outFile}`);
} else process.stdout.write(text);
