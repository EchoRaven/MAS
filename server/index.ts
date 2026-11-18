// MAS Studio server: stores systems, runs them, streams their events.
//   npm run server        (MAS_PORT, MAS_HOST, MAS_DATA_DIR, MAS_TOKEN…; see docs/server.md)
import http from "node:http";
import path from "node:path";
import { loadConfig } from "./config";
import { Router, send } from "./http";
import { designRoutes } from "./routes/design";
import { datasetRoutes } from "./routes/datasets";
import { evalRoutes } from "./routes/evals";
import { hostedRoutes } from "./routes/hosted";
import { HostedServices } from "./hosting/services";
import { envRoutes } from "./routes/envs";
import { runRoutes } from "./routes/runs";
import { settingsRoutes } from "./routes/settings";
import { systemRoutes } from "./routes/systems";
import { handleMcp } from "./runtime/mcpProxy";
import { persistHealth } from "./runtime/models";
import { EvalManager } from "./runtime/evals";
import { RunManager } from "./runtime/runs";
import { Store } from "./store/files";
import { Secrets } from "./store/secrets";

const config = loadConfig();
const store = new Store(config.dataDir);
const secrets = new Secrets(config.dataDir);
const hosted = new HostedServices(config.dataDir, config.docker, secrets);
hosted.startReaper();
const runs = new RunManager(store, secrets, config, hosted);
persistHealth(path.join(config.dataDir, "model-health.json"));
runs.recover();
const evals = new EvalManager(store, runs, secrets, config.docker);
evals.recover();

const router = new Router(config.token);
router.on("GET", "/api/health", () => ({ ok: true, server: "mas-studio", version: "0.1.0" }), { auth: false });
router.on("GET", "/api/session", () => ({ ok: true, data_dir: config.dataDir, local_exec: config.allowLocalExec, rpm: Number(process.env.MAS_RPM ?? 60) }));
systemRoutes(router, store);
runRoutes(router, store, runs);
envRoutes(router, store, config.dataDir);
settingsRoutes(router, store, secrets, config);
designRoutes(router, store, secrets, config, hosted);
evalRoutes(router, store, evals);
datasetRoutes(router, store);
hostedRoutes(router, hosted);

// MCP for harnesses: authenticated by the per-run exposure token, not the user token
const mcpPost = async (req: import("./http").Req, res: http.ServerResponse) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const msg = (await req.body()) as Parameters<typeof handleMcp>[1] | Parameters<typeof handleMcp>[1][];
    const batch = Array.isArray(msg) ? msg : [msg];
    const out = (await Promise.all(batch.map((m) => handleMcp(token, m)))).filter((x) => x !== null);
    if (!out.length) {
      res.writeHead(202).end();
      return;
    }
    send(res, 200, Array.isArray(msg) ? out : out[0]);
};
router.on("POST", "/mcp", mcpPost, { auth: false });
router.on("DELETE", "/mcp", () => ({ ok: true }), { auth: false });

// user code can leave a promise rejected and unawaited; log it, never exit
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e instanceof Error ? e.message : e));
process.on("uncaughtException", (e) => console.error("uncaught exception:", e.message));

const server = http.createServer((req, res) => void router.handle(req, res));

// Hosted agent programs run in containers on the internal network: they reach the platform's MCP for agents
// (and nothing else of this server) at the network's gateway, authenticated by the per-run tokens.
const gatewayRouter = new Router(config.token);
gatewayRouter.on("POST", "/mcp", mcpPost, { auth: false });
gatewayRouter.on("DELETE", "/mcp", () => ({ ok: true }), { auth: false });
void hosted
  .gateway()
  .then((gw) => {
    if (!gw) return;
    const port = Number(process.env.MAS_MCP_GATEWAY_PORT ?? config.port + 1);
    const g = http.createServer((req, res) => void gatewayRouter.handle(req, res));
    g.on("error", (e) => console.error(`MCP gateway for hosted agents: ${e.message}`));
    g.listen(port, gw, () => {
      hosted.mcpGateway = `http://${gw}:${port}`;
      console.log(`MCP for hosted agents on ${hosted.mcpGateway}/mcp`);
    });
    // models for agent programs in containers: they hold a token for their turn, never a key
    const mport = Number(process.env.MAS_MODEL_GATEWAY_PORT ?? port + 1);
    const modelGateway = hosted.models;
    const m = http.createServer(modelGateway.handle);
    m.on("error", (e) => console.error(`Model gateway: ${e.message}`));
    m.listen(mport, gw, () => {
      modelGateway.url = `http://${gw}:${mport}`;
      console.log(`Model gateway for agents in containers on ${modelGateway.url}`);
    });
  })
  .catch(() => undefined);
server.listen(config.port, config.host, () => {
  console.log(`MAS Studio server on http://${config.host}:${config.port} (data: ${config.dataDir})`);
  console.log(`Token: ${config.dataDir}/token${process.env.MAS_TOKEN ? " (overridden by MAS_TOKEN)" : ""}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
