// Process harnesses: Claude Code (and the Claude Agent SDK, which drives the
// same CLI protocol), Codex, and custom stdio programs.
import { spawn } from "node:child_process";
import { clip } from "../values";
import type { Adapter, HarnessTurn } from "./types";

interface Proc {
  lines: AsyncGenerator<string>;
  done: Promise<{ code: number | null; stderr: string }>;
}

function run(cmd: string, args: string[], t: HarnessTurn, stdin?: string, env: Record<string, string> = {}): Proc {
  const p = spawn(cmd, args, { cwd: t.cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const onAbort = () => p.kill("SIGTERM");
  t.rc.signal.addEventListener("abort", onAbort, { once: true });
  let stderr = "";
  p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
  const done = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    p.on("error", (e) => reject(new Error(`${cmd}: ${e.message}`)));
    p.on("close", (code) => {
      t.rc.signal.removeEventListener("abort", onAbort);
      resolve({ code, stderr });
    });
  });
  p.stdin.end(stdin ?? "");
  async function* lines() {
    let buf = "";
    for await (const chunk of p.stdout) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        yield buf.slice(0, i);
        buf = buf.slice(i + 1);
      }
    }
    if (buf.trim()) yield buf;
  }
  return { lines: lines(), done };
}

/** API keys saved in Settings, handed to the CLI's environment (the CLI's own login is used otherwise). */
function keyEnv(t: HarnessTurn, ...names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = t.rc.secrets.get(n);
    if (v) out[n] = v;
  }
  return out;
}

const parse = (l: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(l);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
};

/** claude -p … --output-format stream-json; platform tools via --mcp-config. */
export const claudeCode: Adapter = async (t) => {
  const bin = t.agent.harness.command?.trim() || process.env.MAS_CLAUDE_BIN || "claude";
  const args = ["-p", t.input, "--output-format", "stream-json", "--verbose"];
  if (t.context) args.push("--append-system-prompt", t.context);
  if (t.session) args.push("--resume", t.session);
  if (t.agent.harness.max_steps) args.push("--max-turns", String(t.agent.harness.max_steps));
  if (t.mcp) {
    args.push("--mcp-config", JSON.stringify({ mcpServers: { mas: { type: "http", url: t.mcp.url, headers: { Authorization: `Bearer ${t.mcp.token}` } } } }));
    args.push("--allowedTools", t.mcp.tools.map((n) => `mcp__mas__${n}`).join(","));
  }
  const p = run(bin, args, t, undefined, keyEnv(t, "ANTHROPIC_API_KEY"));
  let text = "";
  let session: string | undefined;
  let usage: { tokens_in: number; tokens_out: number; usd: number; estimated: boolean } | undefined;
  for await (const line of p.lines) {
    const ev = parse(line);
    if (!ev) continue;
    if (ev.type === "system" && ev.session_id) session = String(ev.session_id);
    if (ev.type === "assistant") {
      const content = ((ev.message as { content?: unknown[] })?.content ?? []) as { type: string; name?: string; input?: unknown; text?: string }[];
      for (const c of content) if (c.type === "tool_use") t.rc.emit({ type: "tool", node: t.node, tool: String(c.name), args: clip(JSON.stringify(c.input ?? {}), 800), result: "(inside Claude Code)" });
    }
    if (ev.type === "result") {
      text = String(ev.result ?? "");
      session = String(ev.session_id ?? session ?? "");
      const u = (ev.usage ?? {}) as Record<string, number>;
      usage = { tokens_in: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), tokens_out: u.output_tokens ?? 0, usd: Number(ev.total_cost_usd ?? 0), estimated: false };
      if (ev.is_error) throw new Error(`Claude Code: ${text || ev.subtype}`);
    }
  }
  const { code, stderr } = await p.done;
  if (code !== 0 && !text) throw new Error(`Claude Code exited ${code}: ${stderr.slice(-400)}`);
  return { text, session, usage };
};

/** codex exec --json (resume with codex exec resume <id>). */
export const codex: Adapter = async (t) => {
  const bin = t.agent.harness.command?.trim() || process.env.MAS_CODEX_BIN || "codex";
  const prompt = t.context ? `${t.context}\n\n---\n\n${t.input}` : t.input;
  const args = t.session ? ["exec", "resume", t.session, "--json", prompt] : ["exec", "--json", "--skip-git-repo-check", prompt];
  const p = run(bin, args, t, undefined, keyEnv(t, "OPENAI_API_KEY", "CODEX_API_KEY"));
  let text = "";
  let session = t.session;
  let usage: { tokens_in: number; tokens_out: number; usd: number; estimated: boolean } | undefined;
  for await (const line of p.lines) {
    const ev = parse(line);
    if (!ev) continue;
    if (ev.type === "thread.started") session = String(ev.thread_id);
    const item = ev.item as { type?: string; text?: string; command?: string; aggregated_output?: string } | undefined;
    if (ev.type === "item.completed" && item?.type === "agent_message") text = String(item.text ?? "");
    if (ev.type === "item.completed" && item?.type === "command_execution") t.rc.emit({ type: "tool", node: t.node, tool: "shell", args: String(item.command ?? ""), result: clip(String(item.aggregated_output ?? ""), 1500) });
    if (ev.type === "turn.completed") {
      const u = (ev.usage ?? {}) as Record<string, number>;
      usage = { tokens_in: u.input_tokens ?? 0, tokens_out: u.output_tokens ?? 0, usd: 0, estimated: true };
    }
  }
  const { code, stderr } = await p.done;
  if (code !== 0 && !text) throw new Error(`Codex exited ${code}: ${stderr.slice(-400)}`);
  return { text, session, usage };
};

/**
 * Custom program: one JSON line in ({type: "deliver", input, context, session, run_id, agent, mcp}),
 * JSON lines out: {type: "output", text} · {type: "status"|"log", text} · {type: "usage", tokens_in, tokens_out, usd}
 * · {type: "session", id}. A program that prints plain text is a one-shot command: its stdout is the reply.
 */
export const customStdio: Adapter = async (t) => {
  const command = t.agent.harness.command?.trim();
  if (!command) throw new Error("custom harness has no command");
  if (!t.rc.config.allowLocalExec) throw new Error("custom programs run on the server: enable MAS_ALLOW_LOCAL_EXEC=1 to allow them");
  const p = run("sh", ["-c", command], t, JSON.stringify({ type: "deliver", input: t.input, context: t.context, session: t.session, run_id: t.rc.runId, agent: t.node, mcp: t.mcp }) + "\n", t.mcp ? { MAS_MCP_URL: t.mcp.url, MAS_MCP_TOKEN: t.mcp.token } : {});
  const outputs: string[] = [];
  const plain: string[] = [];
  let session = t.session;
  let usage: { tokens_in: number; tokens_out: number; usd: number; estimated: boolean } | undefined;
  for await (const line of p.lines) {
    const ev = parse(line);
    if (!ev || typeof ev.type !== "string") {
      plain.push(line);
      continue;
    }
    if (ev.type === "output") outputs.push(String(ev.text ?? ""));
    else if (ev.type === "session") session = String(ev.id);
    else if (ev.type === "usage") usage = { tokens_in: Number(ev.tokens_in ?? 0), tokens_out: Number(ev.tokens_out ?? 0), usd: Number(ev.usd ?? 0), estimated: ev.usd == null };
    else if (ev.type === "log" || ev.type === "status") t.rc.emit({ type: "log", node: t.node, level: "info", text: clip(String(ev.text ?? ""), 500) });
  }
  const { code, stderr } = await p.done;
  if (code !== 0) throw new Error(`program exited ${code}: ${stderr.slice(-400)}`);
  return { text: outputs.length ? outputs.join("\n") : plain.join("\n").trim(), session, usage };
};
