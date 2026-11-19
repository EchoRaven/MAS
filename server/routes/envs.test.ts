// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Builder, native } from "@/model/builder";
import { Router } from "../http";
import { Store } from "../store/files";
import { EnvPreviews } from "../runtime/preview";
import { Secrets } from "../store/secrets";
import { envRoutes } from "./envs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-envs-"));
const store = new Store(dir);
const server = http.createServer();
let base = "";
let previews: EnvPreviews;

beforeAll(async () => {
  const b = new Builder("Envs", "");
  b.agent("a1", 0, 0, { name: "A1", model: "m", harness: { ...native(), instructions: "" } })
    .node("box", "env", 0, 0, { name: "Box", env_kind: "sandbox", image: "python:3.12-slim", lifecycle: "per_run" })
    .node("own", "env", 0, 0, { name: "Own", env_kind: "sandbox", image: "python:3.12-slim", lifecycle: "persistent", share: "per_agent" })
    .node("db", "env", 0, 0, { name: "DB", env_kind: "database", image: "" })
    .node("dbw", "env", 0, 0, { name: "Writable DB", env_kind: "database", image: "", db: { mode: "tools", templates: [], tables: [], read_only: false, row_limit: 50, model: null, fn: null } });
  store.putSystem({ ...b.doc, id: "sys_envs" });
  const st = (...p: string[]) => path.join(dir, "state", ...p);
  fs.mkdirSync(st("sys_envs", "box", "runs", "run_old"), { recursive: true });
  fs.writeFileSync(st("sys_envs", "box", "runs", "run_old", "old.txt"), "old");
  await new Promise((r) => setTimeout(r, 20));
  fs.mkdirSync(st("sys_envs", "box", "runs", "run_new", "src"), { recursive: true });
  fs.writeFileSync(st("sys_envs", "box", "runs", "run_new", "src", "main.py"), "print('hi')\n");
  fs.mkdirSync(st("sys_envs", "own", "work", "agents", "a1"), { recursive: true });
  fs.writeFileSync(st("sys_envs", "own", "work", "agents", "a1", "mine.txt"), "a1's");
  fs.mkdirSync(st("sys_envs", "db"), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(st("sys_envs", "db", "db.sqlite"));
  db.exec("CREATE TABLE orders (id INTEGER, total REAL); INSERT INTO orders VALUES (1, 9.5), (2, 3);");
  db.close();
  fs.mkdirSync(st("sys_envs", "dbw"), { recursive: true });
  fs.copyFileSync(st("sys_envs", "db", "db.sqlite"), st("sys_envs", "dbw", "db.sqlite"));
  const r = new Router("t");
  previews = new EnvPreviews(store, new Secrets(dir), { host: "127.0.0.1", port: 0, dataDir: dir, token: "t", allowLocalExec: false, docker: "/nonexistent-docker", parallelism: 1 }, dir);
  envRoutes(r, store, dir, previews);
  server.on("request", (req, res) => void r.handle(req, res));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await previews.closeAll();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = async (p: string) => {
  const r = await fetch(`${base}/api/systems/sys_envs/envs/${p}`, { headers: { authorization: "Bearer t" } });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe("env contents", () => {
  it("lists a sandbox's files for the latest run, or a chosen one, and reads a file", async () => {
    const latest = await get("box/contents");
    expect(latest.body).toMatchObject({ kind: "files", run: "run_new", runs: ["run_new", "run_old"], files: [{ path: "src/main.py", size: 12 }] });
    expect((await get("box/contents?run=run_old")).body.files).toEqual([{ path: "old.txt", size: 3 }]);
    expect((await get("box/contents?path=src/main.py")).body.file).toMatchObject({ path: "src/main.py", text: "print('hi')\n", binary: false });
  });

  it("keeps paths inside the env's folder", async () => {
    expect((await get("box/contents?path=../../../../etc/passwd")).status).toBe(400);
    expect((await get("box/contents?run=..%2F..%2F..")).status).toBe(400);
  });

  it("shows each agent's own folder when the sandbox is per agent", async () => {
    expect((await get("own/contents")).body).toMatchObject({ share: "per_agent", agents: ["a1"], agent: "a1", files: [{ path: "mine.txt", size: 4 }] });
  });

  it("shows a database's tables with row counts, and a table's rows", async () => {
    expect((await get("db/contents")).body).toMatchObject({ kind: "database", tables: [{ name: "orders", rows: 2, columns: ["id INTEGER", "total REAL"] }] });
    expect((await get("db/contents?table=orders")).body.sample).toEqual([{ id: 1, total: 9.5 }, { id: 2, total: 3 }]);
  });

  it("previews an env's tools on a throwaway copy: a write through the preview never reaches the real database", async () => {
    const post = async (p: string, body: unknown = {}) => {
      const r = await fetch(`${base}/api/systems/sys_envs/envs/${p}`, { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    };
    const open = await post("dbw/preview");
    expect(open.body).toMatchObject({ copy: true, tools: [expect.objectContaining({ name: "run_sql", needs_confirm: false })] });
    const sid = String(open.body.session);
    expect((await post(`dbw/preview/${sid}/call`, { tool: "run_sql", args: { sql: "DELETE FROM orders" } })).body).toMatchObject({ result: "2 row(s) changed", error: false });
    expect((await post(`dbw/preview/${sid}/call`, { tool: "run_sql", args: { sql: "SELECT COUNT(*) AS n FROM orders" } })).body.result).toContain('"n": 0');
    // the real database still has both rows
    expect((await get("dbw/contents")).body).toMatchObject({ tables: [{ name: "orders", rows: 2 }] });
    // ending the preview removes its copy
    await fetch(`${base}/api/systems/sys_envs/envs/dbw/preview/${sid}`, { method: "DELETE", headers: { authorization: "Bearer t" } });
    expect((await post(`dbw/preview/${sid}/call`, { tool: "run_sql", args: { sql: "SELECT 1" } })).status).toBe(404);
    expect(fs.existsSync(path.join(dir, "previews", sid))).toBe(false);
  });

  it("a preview of a sandbox without a machine says why instead of running on this host", async () => {
    const r = await fetch(`${base}/api/systems/sys_envs/envs/box/preview`, { method: "POST", headers: { authorization: "Bearer t" } });
    const open = (await r.json()) as { session: string; tools: { name: string }[] };
    expect(open.tools.map((t) => t.name)).toEqual(["bash", "edit_file", "run_tests", "list_work"]);
    const call = await fetch(`${base}/api/systems/sys_envs/envs/box/preview/${open.session}/call`, { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify({ tool: "bash", args: { command: "id" } }) });
    expect(((await call.json()) as { result: string; error: boolean })).toMatchObject({ error: true, result: expect.stringMatching(/MAS_ALLOW_LOCAL_EXEC is off/) });
  });
});
