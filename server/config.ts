// Server settings, from the environment. Everything the server writes lives
// under MAS_DATA_DIR (default: <repo>/.data).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  /** bearer token every /api call must carry */
  token: string;
  /** may sandboxes fall back to running commands on this machine when Docker is unavailable? */
  allowLocalExec: boolean;
  /** docker binary used for sandbox envs */
  docker: string;
  /** concurrent component turns per run */
  parallelism: number;
}

function loadToken(dataDir: string): string {
  if (process.env.MAS_TOKEN) return process.env.MAS_TOKEN;
  const file = path.join(dataDir, "token");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const token = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(file, token + "\n", { mode: 0o600 });
  return token;
}

export function loadConfig(): Config {
  const dataDir = path.resolve(process.env.MAS_DATA_DIR ?? path.join(root, ".data"));
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    host: process.env.MAS_HOST ?? "127.0.0.1",
    port: Number(process.env.MAS_PORT ?? 5190),
    dataDir,
    token: loadToken(dataDir),
    allowLocalExec: process.env.MAS_ALLOW_LOCAL_EXEC === "1",
    docker: process.env.MAS_DOCKER ?? "docker",
    parallelism: Number(process.env.MAS_PARALLELISM ?? 4),
  };
}
