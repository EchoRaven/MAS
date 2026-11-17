// @vitest-environment node
// The router in front of every /api call: the token, and what it refuses.
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Router } from "./http";

let base = "";
const server = http.createServer();
beforeAll(async () => {
  const r = new Router("secret-token");
  r.on("GET", "/api/health", () => ({ ok: true }), { auth: false });
  r.on("GET", "/api/things/:id", (req) => ({ id: req.params.id }));
  r.on("POST", "/api/echo", async (req) => ({ got: await req.body() }));
  server.on("request", (req, res) => void r.handle(req, res));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const get = (path: string, token?: string) => fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("the API router", () => {
  it("lets the right token in and keeps a wrong or missing one out", async () => {
    expect((await get("/api/health")).status).toBe(200);
    expect((await get("/api/things/a", "secret-token")).status).toBe(200);
    expect((await get("/api/things/a", "secret-tokeN")).status).toBe(401);
    expect((await get("/api/things/a", "")).status).toBe(401);
    expect((await get("/api/things/a")).status).toBe(401);
  });

  it("does not take the token from the URL, where logs and history would keep it", async () => {
    expect((await get("/api/things/a?token=secret-token")).status).toBe(401);
  });

  it("answers a malformed path with 400, not a server error", async () => {
    const r = await get("/api/things/%E0%A4%A", "secret-token");
    expect(r.status).toBe(400);
  });

  it("refuses a body over the limit", async () => {
    const big = "x".repeat(21 * 1024 * 1024);
    const r = await fetch(base + "/api/echo", { method: "POST", headers: { authorization: "Bearer secret-token", "content-type": "application/json" }, body: JSON.stringify({ big }) }).catch((e) => e as Error);
    // the server answers 413, or closes the connection while the body is still arriving
    if (r instanceof Error) expect(r).toBeInstanceOf(Error);
    else expect(r.status).toBe(413);
  });
});
