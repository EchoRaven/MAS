// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Builder, native } from "@/model/builder";
import { Router } from "../http";
import { Store } from "../store/files";
import { envRoutes } from "./envs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-envs-"));
const store = new Store(dir);
const server = http.createServer();
let base = "";

beforeAll(async () => {
  const b = new Builder("Envs", "");
  b.agent("a1", 0, 0, { name: "A1", model: "m", harness: { ...native(), instructions: "" } })
    .node("box", "env", 0, 0, { name: "Box", env_kind: "sandbox", image: "python:3.12-slim", lifecycle: "per_run" })
    .node("own", "env", 0, 0, { name: "Own", env_kind: "sandbox", image: "python:3.12-slim", lifecycle: "persistent", share: "per_agent" })
    .node("db", "env", 0, 0, { name: "DB", env_kind: "database", image: "" });
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
  const r = new Router("t");
  envRoutes(r, store, dir);
  server.on("request", (req, res) => void r.handle(req, res));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
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
});
