// Process harnesses: Claude Code (and the Claude Agent SDK, which drives the
// same CLI protocol), Codex, and custom stdio programs.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { hardenedFlags, INTERNAL_NETWORK } from "../isolation";
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

/**
 * Claude Code and Codex in a container of their own, per turn: the server's Node runtime and the CLI's package
 * mounted read-only, the agent's folder at /work, a home of its own that outlives the turn (so a session can be
 * resumed), hardened like a sandbox, on the internal network. It reaches models through the model gateway with a
 * token for this turn (no key inside) and the platform's tools through the MCP gateway; nothing else.
 */
async function inContainer(t: HarnessTurn, cli: "claude" | "codex", args: string[]): Promise<{ cmd: string; args: string[]; env: Record<string, string>; done: () => void }> {
  const hosted = t.rc.hosted;
  const gw = hosted?.models;
  if (!hosted || !gw?.url || !hosted.mcpGateway) throw new Error(`${cli === "claude" ? "Claude Code" : "Codex"} runs in a container, but the gateways are not listening (is Docker available?). To run it on this machine instead, set MAS_ALLOW_LOCAL_EXEC=1 and MAS_AGENT_RUNTIME=host`);
  const pkg = process.env[cli === "claude" ? "MAS_CLAUDE_PKG" : "MAS_CODEX_PKG"];
  if (!pkg || !fs.existsSync(path.join(pkg, "node_modules", ".bin", cli))) throw new Error(`Set ${cli === "claude" ? "MAS_CLAUDE_PKG" : "MAS_CODEX_PKG"} to the folder where the ${cli} package is installed (it holds node_modules/.bin/${cli}); it is mounted read-only into the agent's container`);
  const nodeDir = path.dirname(path.dirname(process.execPath));
  const home = t.rc.store.stateDir(t.rc.doc.id, t.node, "home");
  fs.mkdirSync(home, { recursive: true });
  const provider = cli === "claude" ? "anthropic" : "openai";
  const token = gw.grant(t.rc.runId, t.node, [provider], (a) =>
    t.rc.emit({ type: "log", node: t.node, level: a.allowed ? "info" : "warn", text: `gateway: ${a.method} ${a.provider}${a.path} → ${a.allowed ? a.status : `refused (${a.why})`}` }),
  );
  const env: Record<string, string> =
    cli === "claude"
      ? { ANTHROPIC_BASE_URL: gw.baseUrl("anthropic"), ANTHROPIC_API_KEY: token, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1" }
      : { OPENAI_BASE_URL: `${gw.baseUrl("openai")}/v1`, OPENAI_API_KEY: token, CODEX_API_KEY: token };
  env.PATH = "/opt/node/bin:/usr/local/bin:/usr/bin:/bin";
  if (cli === "codex") {
    // Codex takes its endpoint from its config, not the environment: a provider pointing at the gateway
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".codex", "config.toml"),
      `# written by MAS Studio for each turn: models through the gateway, with this turn's token\nmodel_provider = "mas"\n\n[model_providers.mas]\nname = "MAS Studio gateway"\nbase_url = "${gw.baseUrl("openai")}/v1"\nenv_key = "OPENAI_API_KEY"\nwire_api = "responses"\nrequest_max_retries = 1\nstream_max_retries = 1\n`,
    );
  }
  const spec = { name: `mas-agent-${t.rc.runId}-${t.node}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 120), image: process.env.MAS_AGENT_IMAGE || "python:3.12-slim", workDir: t.cwd, egress: [], home: "/home/agent", labels: { "mas.run": t.rc.runId, "mas.agent": t.node } };
  const docker = [
    "run", "-i", "--rm", "--name", spec.name,
    ...hardenedFlags(spec, INTERNAL_NETWORK, Object.keys(env)),
    "-v", `${nodeDir}:/opt/node:ro`, "-v", `${pkg}:/opt/cli:ro`, "-v", `${t.cwd}:/work`, "-v", `${home}:/home/agent`, "-w", "/work",
    spec.image, `/opt/cli/node_modules/.bin/${cli}`, ...args,
  ];
  return { cmd: t.rc.config.docker, args: docker, env, done: () => gw.revoke(token) };
}

/** Host or container: containers unless MAS_AGENT_RUNTIME=host, which also needs MAS_ALLOW_LOCAL_EXEC=1. */
function onHost(t: HarnessTurn, what: string): boolean {
  if (process.env.MAS_AGENT_RUNTIME !== "host") return false;
  if (!t.rc.config.allowLocalExec) throw new Error(`${what} on this machine needs MAS_ALLOW_LOCAL_EXEC=1 (MAS_AGENT_RUNTIME=host); without it, it runs in a container`);
  return true;
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
    const host = onHost(t, "Claude Code");
    const url = host ? t.mcp.url : `${t.rc.hosted?.mcpGateway ?? ""}/mcp`;
    args.push("--mcp-config", JSON.stringify({ mcpServers: { mas: { type: "http", url, headers: { Authorization: `Bearer ${t.mcp.token}` } } } }));
    args.push("--allowedTools", t.mcp.tools.map((n) => `mcp__mas__${n}`).join(","));
  }
  const box = onHost(t, "Claude Code") ? null : await inContainer(t, "claude", args);
  const p = box ? run(box.cmd, box.args, t, undefined, box.env) : run(bin, args, t, undefined, keyEnv(t, "ANTHROPIC_API_KEY"));
  p.done.finally(() => box?.done()).catch(() => undefined);
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
  let failure: string | undefined;
  const box = onHost(t, "Codex") ? null : await inContainer(t, "codex", args);
  const p = box ? run(box.cmd, box.args, t, undefined, box.env) : run(bin, args, t, undefined, keyEnv(t, "OPENAI_API_KEY", "CODEX_API_KEY"));
  p.done.finally(() => box?.done()).catch(() => undefined);
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
    // Codex reports a failed turn as an event on stdout, not on stderr
    if (ev.type === "turn.failed" || ev.type === "error") failure = String((ev.error as { message?: string } | undefined)?.message ?? ev.message ?? JSON.stringify(ev)).slice(0, 600);
    if (ev.type === "turn.completed") {
      const u = (ev.usage ?? {}) as Record<string, number>;
      usage = { tokens_in: u.input_tokens ?? 0, tokens_out: u.output_tokens ?? 0, usd: 0, estimated: true };
    }
  }
  const { code, stderr } = await p.done;
  if (code !== 0 && !text) throw new Error(`Codex exited ${code}: ${failure ?? stderr.slice(-400)}`);
  return { text, session, usage };
};

/**
 * Custom program: one JSON line in ({type: "deliver", input, context, session, run_id, agent, mcp}),
 * JSON lines out: {type: "output", text} · {type: "status"|"log", text} · {type: "usage", tokens_in, tokens_out, usd}
 * · {type: "session", id}. A program that prints plain text is a one-shot command: its stdout is the reply.
 */
export const customStdio: Adapter = async (t) => {
  let command = t.agent.harness.command?.trim();
  let mcp = t.mcp;
  let env: Record<string, string> = {};
  const hosted = t.agent.harness.endpoint && "hosted" in t.agent.harness.endpoint ? t.agent.harness.endpoint.hosted.service : null;
  if (hosted) {
    // a hosted agent program: its own container per turn; it reaches the platform's MCP at the internal network's gateway
    if (!t.rc.hosted) throw new Error(`Hosted service ${hosted} is not available on this server`);
    const c = await t.rc.hosted.agentCommand(hosted);
    command = c.command;
    env = c.env;
    if (mcp) {
      const gw = t.rc.hosted.mcpGateway;
      if (!gw) throw new Error("The MCP gateway for hosted agents is not listening (is Docker available?)");
      mcp = { ...mcp, url: `${gw}/mcp` };
    }
  } else {
    if (!command) throw new Error("custom harness has no command");
    if (!t.rc.config.allowLocalExec) throw new Error("custom programs run on the server: enable MAS_ALLOW_LOCAL_EXEC=1 to allow them, or host the program (Connections) and set the harness endpoint");
  }
  if (!command) throw new Error("custom harness has no command");
  const p = run("sh", ["-c", command], t, JSON.stringify({ type: "deliver", input: t.input, context: t.context, session: t.session, run_id: t.rc.runId, agent: t.node, mcp }) + "\n", { ...env, ...(mcp ? { MAS_MCP_URL: mcp.url, MAS_MCP_TOKEN: mcp.token } : {}) });
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
