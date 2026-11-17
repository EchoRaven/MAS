// MAS Studio server: stores systems, runs them, streams their events.
//   npm run server        (MAS_PORT, MAS_HOST, MAS_DATA_DIR, MAS_TOKEN…; see docs/server.md)
import http from "node:http";
import { loadConfig } from "./config";
import { Router, send } from "./http";
import { runRoutes } from "./routes/runs";
import { settingsRoutes } from "./routes/settings";
import { systemRoutes } from "./routes/systems";
import { handleMcp } from "./runtime/mcpProxy";
import { RunManager } from "./runtime/runs";
import { Store } from "./store/files";
import { Secrets } from "./store/secrets";

const config = loadConfig();
const store = new Store(config.dataDir);
const secrets = new Secrets(config.dataDir);
const runs = new RunManager(store, secrets, config);
runs.recover();

const router = new Router(config.token);
router.on("GET", "/api/health", () => ({ ok: true, server: "mas-studio", version: "0.1.0" }), { auth: false });
router.on("GET", "/api/session", () => ({ ok: true, data_dir: config.dataDir, local_exec: config.allowLocalExec }));
systemRoutes(router, store);
runRoutes(router, store, runs);
settingsRoutes(router, store, secrets, config);

// MCP for harnesses: authenticated by the per-run exposure token, not the user token
router.on(
  "POST",
  "/mcp",
  async (req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const msg = (await req.body()) as Parameters<typeof handleMcp>[1] | Parameters<typeof handleMcp>[1][];
    const batch = Array.isArray(msg) ? msg : [msg];
    const out = (await Promise.all(batch.map((m) => handleMcp(token, m)))).filter((x) => x !== null);
    if (!out.length) {
      res.writeHead(202).end();
      return;
    }
    send(res, 200, Array.isArray(msg) ? out : out[0]);
  },
  { auth: false },
);
router.on("DELETE", "/mcp", () => ({ ok: true }), { auth: false });

// user code can leave a promise rejected and unawaited; log it, never exit
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e instanceof Error ? e.message : e));
process.on("uncaughtException", (e) => console.error("uncaught exception:", e.message));

const server = http.createServer((req, res) => void router.handle(req, res));
server.listen(config.port, config.host, () => {
  console.log(`MAS Studio server on http://${config.host}:${config.port} (data: ${config.dataDir})`);
  console.log(`Token: ${config.dataDir}/token${process.env.MAS_TOKEN ? " (overridden by MAS_TOKEN)" : ""}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
