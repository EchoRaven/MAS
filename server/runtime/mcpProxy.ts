// The run's MCP endpoint: process and remote harnesses (Claude Code, ACP,
// custom programs) reach the platform's tools for their agent here. Each
// exposure has its own random token and lives as long as the run.
import crypto from "node:crypto";
import type { RtTool } from "./resources/types";

interface Exposure {
  run: string;
  node: string;
  tools: RtTool[];
}

const byToken = new Map<string, Exposure>();

export function expose(run: string, node: string, tools: RtTool[], baseUrl: string): { url: string; token: string; tools: string[] } {
  for (const [t, e] of byToken) if (e.run === run && e.node === node) byToken.delete(t);
  const token = crypto.randomBytes(24).toString("base64url");
  byToken.set(token, { run, node, tools });
  return { url: `${baseUrl}/mcp`, token, tools: tools.map((t) => t.name) };
}

export function revokeRun(run: string) {
  for (const [t, e] of byToken) if (e.run === run) byToken.delete(t);
}

type Rpc = { jsonrpc: "2.0"; id?: number | string; method: string; params?: Record<string, unknown> };

/** Handle one JSON-RPC message for the exposure behind `token`; null for notifications. */
export async function handleMcp(token: string, msg: Rpc): Promise<unknown | null> {
  const ex = byToken.get(token);
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  if (!ex) return fail(-32001, "unknown or expired token");
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: (msg.params?.protocolVersion as string) ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mas-studio", version: "0.1.0" } });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: ex.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const t = ex.tools.find((x) => x.name === name);
      if (!t) return reply({ content: [{ type: "text", text: `unknown tool ${name}` }], isError: true });
      try {
        const text = await t.run((msg.params?.arguments ?? {}) as Record<string, unknown>, { node: ex.node });
        return reply({ content: [{ type: "text", text }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    default:
      return fail(-32601, `method not found: ${msg.method}`);
  }
}
