// Hosted services (code uploaded or cloned, built and run in Docker on this
// server) and connection tests for any endpoint, hosted or remote.
import type { Endpoint, HostManifest } from "@/model/hosting";
import type { Router } from "../http";
import type { HostedServices } from "../hosting/services";
import { McpClient } from "../runtime/mcp/client";
import { HttpError } from "../store/files";

/** Try an endpoint once: an MCP server's tools, or an HTTP answer. */
export async function testEndpoint(hosted: HostedServices, e: Endpoint, kind: "mcp" | "http"): Promise<{ ok: boolean; detail: string; tools?: { name: string; description: string }[]; ms: number }> {
  const t0 = Date.now();
  try {
    const target = await hosted.resolve(e);
    if (kind === "http") {
      if (!("url" in target)) return { ok: false, detail: "This endpoint speaks MCP on stdio, not HTTP", ms: Date.now() - t0 };
      // a hosted service is asked at its health path, if it declares one
      const health = "hosted" in e ? hosted.get(e.hosted.service)?.manifest.expose.health : undefined;
      const res = await fetch(target.url + (health ?? ""), { headers: target.headers, signal: AbortSignal.timeout(15_000) });
      return { ok: res.status < 500, detail: `HTTP ${res.status}`, ms: Date.now() - t0 };
    }
    const client = new McpClient("url" in target ? { url: target.url, headers: target.headers } : { command: target.command, env: target.env });
    try {
      const tools = await client.tools();
      return { ok: true, detail: `${tools.length} tool${tools.length === 1 ? "" : "s"}`, tools: tools.map((x) => ({ name: x.name, description: x.description ?? "" })), ms: Date.now() - t0 };
    } finally {
      await client.close();
    }
  } catch (err) {
    return { ok: false, detail: (err as Error).message.slice(0, 500), ms: Date.now() - t0 };
  }
}

export function hostedRoutes(r: Router, hosted: HostedServices) {
  r.on("GET", "/api/hosted", async () => ({
    services: await Promise.all(hosted.list().map(async (s) => ({ ...s, state: await hosted.state(s.id) }))),
  }));
  r.on("GET", "/api/hosted/:id", async (req) => {
    const s = hosted.get(req.params.id);
    if (!s) throw new HttpError(404, "No such service");
    return { service: s, state: await hosted.state(s.id) };
  });
  // a new service: { name, archive_base64 + filename (.tar.gz / .tgz / .zip) | git (https), manifest? }
  r.on("POST", "/api/hosted", async (req) => hosted.create((await req.body()) as Parameters<HostedServices["create"]>[0]));
  // a new version of its code
  r.on("POST", "/api/hosted/:id/versions", async (req) => hosted.update(req.params.id, (await req.body()) as Parameters<HostedServices["update"]>[1]));
  // how it runs: start, expose, egress, env, memory…
  r.on("PUT", "/api/hosted/:id/config", async (req) => hosted.configure(req.params.id, ((await req.body()) ?? {}) as Partial<HostManifest>));
  r.on("POST", "/api/hosted/:id/build", async (req) => hosted.build(req.params.id));
  r.on("POST", "/api/hosted/:id/start", async (req) => {
    try {
      return await hosted.start(req.params.id);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
  r.on("POST", "/api/hosted/:id/stop", async (req) => (await hosted.stop(req.params.id), { stopped: true }));
  r.on("GET", "/api/hosted/:id/logs", async (req) => ({ logs: await hosted.logs(req.params.id) }));
  r.on("DELETE", "/api/hosted/:id", (req) => (hosted.delete(req.params.id), { ok: true }));
  // test any endpoint, hosted or remote: { endpoint, kind: mcp | http }
  r.on("POST", "/api/connections/test", async (req) => {
    const b = (await req.body()) as { endpoint?: Endpoint; kind?: "mcp" | "http" };
    if (!b.endpoint || !("remote" in b.endpoint || "hosted" in b.endpoint)) throw new HttpError(400, "Give an endpoint: { remote: { url } } or { hosted: { service } }");
    return testEndpoint(hosted, b.endpoint, b.kind === "http" ? "http" : "mcp");
  });
}
