// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Router } from "../http";
import { Store } from "../store/files";
import { datasetRoutes } from "./datasets";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-ds-"));
const server = http.createServer();
let base = "";
beforeAll(async () => {
  const r = new Router("t");
  datasetRoutes(r, new Store(dir));
  server.on("request", (req, res) => void r.handle(req, res));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(base + p, { method, headers: { authorization: "Bearer t", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe("dataset flags", () => {
  it("marks a question as broken and back, without changing the dataset's version", async () => {
    const made = await call("POST", "/api/datasets", { name: "Two", text: "1+1? | 2\nChange from a $5 bill for $9? | -4", format: "auto", grader: "number" });
    const id = String(made.body.id);
    const version = made.body.version;
    const flagged = await call("PUT", `/api/datasets/${id}/flags`, { input: "Change from a $5 bill for $9?", reason: "negative change: the key cannot be right" });
    expect(flagged.body.flags).toEqual([expect.objectContaining({ input: "Change from a $5 bill for $9?", reason: "negative change: the key cannot be right" })]);
    expect((await call("GET", `/api/datasets/${id}/flags`)).body.flags).toHaveLength(1);
    expect((await call("GET", `/api/datasets/${id}`)).body.version).toBe(version);
    expect((await call("PUT", `/api/datasets/${id}/flags`, { input: "not a question here", reason: "x" })).status).toBe(400);
    expect((await call("PUT", `/api/datasets/${id}/flags`, { input: "Change from a $5 bill for $9?", reason: null })).body.flags).toEqual([]);
  });

  it("works for built-in datasets too", async () => {
    const ds = (await call("GET", "/api/datasets/builtin-hard-computation-30")).body as { cases: { input: string }[] };
    const r = await call("PUT", "/api/datasets/builtin-hard-computation-30/flags", { input: ds.cases[0].input, reason: "test" });
    expect(r.body.flags).toHaveLength(1);
  });
});
