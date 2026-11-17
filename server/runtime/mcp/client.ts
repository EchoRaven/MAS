// A minimal MCP client: initialize, tools/list, tools/call over the
// Streamable HTTP transport (JSON or SSE responses) or stdio (newline-
// delimited JSON-RPC).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const PROTOCOL = "2025-06-18";
const CLIENT = { name: "mas-studio", version: "0.1.0" };

interface Rpc {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
}

class HttpRpc implements Rpc {
  private session?: string;
  private id = 0;
  constructor(
    private url: string,
    private headers: Record<string, string>,
  ) {}
  private async post(body: unknown): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(this.session ? { "mcp-session-id": this.session } : {}), "mcp-protocol-version": PROTOCOL, ...this.headers },
      body: JSON.stringify(body),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    if (res.status === 202) return null;
    if (!res.ok) throw new Error(`MCP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream")) {
      const text = await res.text();
      const datas = text
        .split(/\r?\n\r?\n/)
        .map((block) => block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n"))
        .filter(Boolean);
      const want = (body as { id?: number }).id;
      for (const d of datas) {
        const msg = JSON.parse(d);
        if (msg.id === want) return msg;
      }
      return datas.length ? JSON.parse(datas[datas.length - 1]) : null;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  async request(method: string, params?: unknown) {
    const msg = (await this.post({ jsonrpc: "2.0", id: ++this.id, method, params })) as { result?: unknown; error?: { message: string } } | null;
    if (msg?.error) throw new Error(`MCP ${method}: ${msg.error.message}`);
    return msg?.result;
  }
  async notify(method: string, params?: unknown) {
    await this.post({ jsonrpc: "2.0", method, params });
  }
  async close() {
    if (this.session) await fetch(this.url, { method: "DELETE", headers: { "mcp-session-id": this.session, ...this.headers } }).catch(() => undefined);
  }
}

class StdioRpc implements Rpc {
  private proc: ChildProcessWithoutNullStreams;
  private id = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buf = "";
  private stderr = "";
  constructor(command: string, env: Record<string, string>) {
    this.proc = spawn("sh", ["-c", command], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.on("data", (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          const p = msg.id != null ? this.pending.get(msg.id) : undefined;
          if (p) {
            this.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message));
            else p.resolve(msg.result);
          }
        } catch {
          /* not JSON-RPC: ignore */
        }
      }
    });
    this.proc.stderr.on("data", (d) => (this.stderr = (this.stderr + d).slice(-2000)));
    this.proc.on("exit", (code) => {
      for (const p of this.pending.values()) p.reject(new Error(`MCP server exited (${code}): ${this.stderr.trim().slice(-300)}`));
      this.pending.clear();
    });
  }
  request(method: string, params?: unknown) {
    const id = ++this.id;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP ${method} timed out`));
      }, 120_000);
    });
  }
  async notify(method: string, params?: unknown) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async close() {
    this.proc.kill();
  }
}

export class McpClient {
  private rpc: Rpc;
  private ready?: Promise<void>;
  private toolList?: McpTool[];
  constructor(target: { url: string; headers?: Record<string, string> } | { command: string; env?: Record<string, string> }) {
    this.rpc = "url" in target ? new HttpRpc(target.url, target.headers ?? {}) : new StdioRpc(target.command, target.env ?? {});
  }
  private init() {
    this.ready ??= (async () => {
      await this.rpc.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT });
      await this.rpc.notify("notifications/initialized");
    })();
    return this.ready;
  }
  async tools(): Promise<McpTool[]> {
    await this.init();
    if (!this.toolList) {
      const all: McpTool[] = [];
      let cursor: string | undefined;
      do {
        const r = (await this.rpc.request("tools/list", cursor ? { cursor } : {})) as { tools: McpTool[]; nextCursor?: string };
        all.push(...(r?.tools ?? []));
        cursor = r?.nextCursor;
      } while (cursor);
      this.toolList = all;
    }
    return this.toolList;
  }
  async call(name: string, args: Record<string, unknown>): Promise<{ text: string; error: boolean }> {
    await this.init();
    const r = (await this.rpc.request("tools/call", { name, arguments: args })) as { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };
    const text = (r?.content ?? []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n") || (r?.structuredContent ? JSON.stringify(r.structuredContent) : "");
    return { text, error: !!r?.isError };
  }
  close() {
    return this.rpc.close();
  }
}
