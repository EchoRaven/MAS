// An env imported through mas-env/1 (DT, env-gen, compose): health-checked,
// reset per run when it says how, and used through its MCP server.
import { mcpClientFor } from "../../../hosting/resolve";
import type { EnvData, SysEdge, SysNode } from "@/model/types";
import type { RunCtx } from "../../context";
import { McpClient } from "../../mcp/client";
import { runCommand } from "../plugins/external";
import type { Resource, RtTool } from "../types";

export class McpEnv implements Resource {
  private client?: McpClient;
  private ready?: Promise<void>;
  constructor(
    private rc: RunCtx,
    private node: SysNode<EnvData>,
  ) {}
  get id() {
    return this.node.id;
  }
  private get m() {
    return this.node.data.manifest!;
  }

  private async healthy(): Promise<boolean> {
    try {
      const res = await fetch(this.m.lifecycle.health, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private prepare() {
    this.ready ??= (async () => {
      const m = this.m;
      if (m.lifecycle.health && !(await this.healthy())) {
        if (!m.lifecycle.start || !this.rc.config.allowLocalExec) throw new Error(`${this.node.data.name} is not running (health check ${m.lifecycle.health} failed)${m.lifecycle.start ? "; start it with: " + m.lifecycle.start : ""}`);
        this.rc.emit({ type: "log", node: this.id, level: "info", text: `Starting ${this.node.data.name}: ${m.lifecycle.start}` });
        await runCommand(m.lifecycle.start, "", 600_000);
        for (let i = 0; i < 60 && !(await this.healthy()); i++) await new Promise((r) => setTimeout(r, 2000));
        if (!(await this.healthy())) throw new Error(`${this.node.data.name} did not become healthy`);
      }
      if (m.lifecycle.reset && this.node.data.lifecycle === "per_run") {
        const http = /^(POST|GET|PUT)\s+(\S+)/i.exec(m.lifecycle.reset);
        if (http) await fetch(http[2], { method: http[1].toUpperCase(), signal: AbortSignal.timeout(60_000) }).catch((e) => this.rc.emit({ type: "log", node: this.id, level: "warn", text: `Reset failed: ${e.message}` }));
        else if (this.rc.config.allowLocalExec) await runCommand(m.lifecycle.reset, "", 300_000);
        this.rc.emit({ type: "transform", at: this.id, label: "reset", detail: m.lifecycle.reset });
      }
      const mcp = m.exposes.mcp;
      if (!mcp) return;
      if (mcp.endpoint) {
        this.client = await mcpClientFor(this.rc, mcp.endpoint);
        return;
      }
      const token = mcp.auth === "bearer_env" ? this.rc.secrets.get(Object.values(mcp.env ?? {})[0] ?? `${this.id.toUpperCase()}_TOKEN`) : undefined;
      if (mcp.transport === "http" && mcp.url) this.client = new McpClient({ url: mcp.url, headers: token ? { authorization: `Bearer ${token}` } : {} });
      else if (mcp.start) {
        if (!this.rc.config.allowLocalExec) throw new Error(`${this.node.data.name} starts its MCP server as a command on the server (${mcp.start}); set MAS_ALLOW_LOCAL_EXEC=1 to allow it`);
        this.client = new McpClient({ command: mcp.start, env: Object.fromEntries(Object.entries(mcp.env ?? {}).map(([k, v]) => [k, this.rc.secrets.get(v) ?? v])) });
      }
    })();
    return this.ready;
  }

  async tools(edge: SysEdge): Promise<RtTool[]> {
    await this.prepare();
    if (!this.client) return [];
    const allow = edge.binding?.tools?.length ? new Set(edge.binding.tools) : null;
    const tools = await this.client.tools();
    return tools
      .filter((t) => !allow || allow.has(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description ?? "",
        input_schema: t.inputSchema ?? { type: "object", properties: {} },
        effect: "write" as const,
        source: this.id,
        run: async (a: Record<string, unknown>) => {
          const r = await this.client!.call(t.name, a);
          if (r.error) throw new Error(r.text);
          return r.text;
        },
      }));
  }

  async close() {
    await this.client?.close();
  }
}
