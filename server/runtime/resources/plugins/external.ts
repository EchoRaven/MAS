// Plugins whose backend lives elsewhere:
//   mcp   tools come from an MCP server (url, or a stdio command)
//   http  POST {url}/tools/{name} with the arguments; hooks at {url}/hooks/{hook}
//   code  a command run per call: JSON {tool, args, plugin, run_id} on stdin, result on stdout
import { spawn } from "node:child_process";
import type { PluginData, SysEdge, SysNode } from "@/model/types";
import type { RunCtx } from "../../context";
import { McpClient } from "../../mcp/client";
import { asText } from "../../values";
import { S, schema, type Resource, type RtTool, type TurnInfo } from "../types";

function secretHeaders(rc: RunCtx, config: Record<string, string> = {}): Record<string, string> {
  // config.auth_env names a secret sent as a bearer token
  const key = rc.secrets.get(config.auth_env);
  return key ? { authorization: `Bearer ${key}` } : {};
}

export function runCommand(command: string, stdin: string, timeoutMs = 60_000, env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("sh", ["-c", command], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim().slice(-500) || `exited with ${code}`));
    });
    p.stdin.end(stdin);
  });
}

export class ExternalPlugin implements Resource {
  private mcp?: McpClient;
  constructor(
    private rc: RunCtx,
    private node: SysNode<PluginData>,
  ) {}
  get id() {
    return this.node.id;
  }
  private get backend() {
    return this.node.data.spec.backend;
  }
  private client(): McpClient {
    const b = this.backend;
    // an MCP server started as a command runs on this machine: the same opt-in as every other host command
    if (!b.url && !this.rc.config.allowLocalExec) throw new Error(`${this.node.data.name} starts its MCP server as a command on the server (${b.command}); set MAS_ALLOW_LOCAL_EXEC=1 to allow it, or give the plugin an MCP URL`);
    this.mcp ??= b.url ? new McpClient({ url: b.url, headers: secretHeaders(this.rc, b.config) }) : new McpClient({ command: b.command!, env: Object.fromEntries(Object.entries(b.config ?? {}).filter(([k]) => k.endsWith("_env")).map(([, v]) => [v, this.rc.secrets.get(v) ?? ""])) });
    return this.mcp;
  }

  async tools(edge: SysEdge): Promise<RtTool[]> {
    const b = this.backend;
    const declared = this.node.data.spec.tools;
    if (b.kind === "mcp") {
      if (!b.url && !b.command) throw new Error(`${this.node.data.name}: MCP backend needs a url or a command`);
      const tools = await this.client().tools();
      const effect = (name: string) => declared.find((t) => t.name === name)?.effect ?? "write";
      return tools
        .filter((t) => !declared.length || declared.some((d) => d.name === t.name))
        .filter((t) => edge.access !== "read" || effect(t.name) === "read" || effect(t.name) === "pure")
        .map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema ?? schema({}), effect: effect(t.name), source: this.id, run: async (a) => {
          const r = await this.client().call(t.name, a);
          if (r.error) throw new Error(r.text);
          return r.text;
        } }));
    }
    return declared
      .filter((t) => edge.access !== "read" || t.effect === "read" || t.effect === "pure")
      .map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: schema({ input: { ...S, description: "What the tool should act on" } }, []),
        effect: t.effect,
        source: this.id,
        run: async (args: Record<string, unknown>) => {
          if (b.kind === "http") {
            if (!b.url) throw new Error("HTTP backend has no url");
            const res = await fetch(`${b.url.replace(/\/$/, "")}/tools/${encodeURIComponent(t.name)}`, { method: "POST", headers: { "content-type": "application/json", ...secretHeaders(this.rc, b.config) }, body: JSON.stringify(args), signal: AbortSignal.timeout(60_000) });
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
            return text;
          }
          if (b.kind === "code") {
            if (!b.command) throw new Error("code backend has no command");
            return runCommand(b.command, JSON.stringify({ tool: t.name, args, plugin: this.id, run_id: this.rc.runId }));
          }
          throw new Error(`${this.node.data.name} has no implementation for ${t.name}: set its backend to MCP, HTTP or code`);
        },
      }));
  }

  private async httpHook(hook: string, body: unknown): Promise<string | null> {
    const b = this.backend;
    if (b.kind !== "http" || !b.url) return null;
    const res = await fetch(`${b.url.replace(/\/$/, "")}/hooks/${hook}`, { method: "POST", headers: { "content-type": "application/json", ...secretHeaders(this.rc, b.config) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`hook ${hook}: HTTP ${res.status}`);
    const text = await res.text();
    return text ? asText(text) : null;
  }

  async beforeTurn(turn: { node: string; input: string }) {
    return this.httpHook("before_turn", { agent: turn.node, input: turn.input, run_id: this.rc.runId });
  }
  async afterTurn(turn: TurnInfo) {
    await this.httpHook("after_turn", { agent: turn.node, input: turn.input, output: turn.output, run_id: this.rc.runId });
  }
  async close() {
    await this.mcp?.close();
  }
}
