// Where an endpoint is reached during a run. A remote endpoint needs only the
// run's secrets; a hosted one needs the server's hosted services. A hosted
// service always runs in its own container, so it needs no MAS_ALLOW_LOCAL_EXEC.
import type { Endpoint } from "@/model/hosting";
import type { RunCtx } from "../runtime/context";
import { McpClient } from "../runtime/mcp/client";

export type Resolved = { url: string; headers: Record<string, string> } | { command: string; env: Record<string, string> };

export async function resolveEndpoint(rc: Pick<RunCtx, "secrets" | "hosted">, e: Endpoint): Promise<Resolved> {
  if ("remote" in e) {
    const headers = { ...(e.remote.headers ?? {}) };
    if (e.remote.bearer_env) {
      const key = rc.secrets.get(e.remote.bearer_env);
      if (!key) throw new Error(`The connection to ${e.remote.url} needs the secret ${e.remote.bearer_env} (Settings → API keys)`);
      headers.authorization = `Bearer ${key}`;
    }
    return { url: e.remote.url, headers };
  }
  if (!rc.hosted) throw new Error(`Hosted service ${e.hosted.service} is not available on this server`);
  return rc.hosted.resolve(e);
}

/** An MCP client for an endpoint, whichever way it is reached. */
export async function mcpClientFor(rc: Pick<RunCtx, "secrets" | "hosted">, e: Endpoint): Promise<McpClient> {
  const r = await resolveEndpoint(rc, e);
  const client = new McpClient("url" in r ? { url: r.url, headers: r.headers } : { command: r.command, env: r.env });
  // each call through it is a use of the hosted service: a run longer than its idle time must not have it stopped
  // midway, as happened when only the first connection was noted (Generative Agents' town, over an hour)
  if ("hosted" in e && rc.hosted) {
    const call = client.call.bind(client);
    client.call = async (name, args) => {
      rc.hosted?.touchEndpoint(e);
      return call(name, args);
    };
  }
  return client;
}
