// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Secrets } from "../store/secrets";
import { type GatewayAccess, ModelGateway } from "./modelGateway";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-gw-"));
let upstream: http.Server;
let gw: http.Server;
let base = "";
const seen: { path: string; auth: string | undefined; key: string | undefined }[] = [];
const secrets = new Secrets(dir);
let g: ModelGateway;

beforeAll(async () => {
  secrets.set("ANTHROPIC_API_KEY", "sk-real-anthropic");
  upstream = http.createServer((req, res) => {
    seen.push({ path: req.url ?? "", auth: req.headers.authorization, key: req.headers["x-api-key"] as string | undefined });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const up = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  g = new ModelGateway(secrets, {
    anthropic: { upstream: up, key: "ANTHROPIC_API_KEY", auth: "x-api-key", paths: [/^\/v1\/messages$/] },
    openai: { upstream: up, key: "OPENAI_API_KEY", auth: "bearer", paths: [/^\/v1\/chat\/completions$/] },
  });
  gw = http.createServer(g.handle);
  await new Promise<void>((r) => gw.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(gw.address() as { port: number }).port}`;
});
afterAll(() => {
  upstream.close();
  gw.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = async (p: string, headers: Record<string, string>) => {
  const r = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  return { status: r.status, body: await r.text() };
};

describe("model gateway", () => {
  it("swaps a turn's token for the real key, and logs each call; the container never holds the key", async () => {
    const log: GatewayAccess[] = [];
    const token = g.grant("run_1", "coder", ["anthropic"], (a) => log.push(a));
    const r = await post("/anthropic/v1/messages", { "x-api-key": token, "anthropic-version": "2023-06-01" });
    expect(r.status).toBe(200);
    expect(seen.at(-1)).toMatchObject({ path: "/v1/messages", key: "sk-real-anthropic" });
    expect(log).toEqual([expect.objectContaining({ allowed: true, provider: "anthropic", path: "/v1/messages", status: 200 })]);
    expect(r.body).not.toContain("sk-real");
  });

  it("refuses an unknown or revoked token, a provider not granted, a path that is not a model call, and a missing key", async () => {
    const log: GatewayAccess[] = [];
    const before = seen.length;
    expect((await post("/anthropic/v1/messages", { "x-api-key": "made-up" })).status).toBe(401);
    const token = g.grant("run_1", "coder", ["anthropic", "openai"], (a) => log.push(a));
    expect((await post("/anthropic/v1/organizations/keys", { "x-api-key": token })).status).toBe(403);
    expect((await post("/google/v1beta/models/x:generateContent", { "x-api-key": token })).status).toBe(403);
    // OPENAI_API_KEY is not set here
    expect((await post("/openai/v1/chat/completions", { authorization: `Bearer ${token}` })).body).toMatch(/no OPENAI_API_KEY/);
    g.revoke(token);
    expect((await post("/anthropic/v1/messages", { "x-api-key": token })).status).toBe(401);
    expect(seen.length).toBe(before); // nothing reached the provider
    expect(log.map((a) => [a.allowed, a.why])).toEqual([
      [false, "/v1/organizations/keys is not a model endpoint"],
      [false, "provider google is not allowed for this agent"],
      [false, "no OPENAI_API_KEY in Settings → API keys"],
    ]);
  });
});
