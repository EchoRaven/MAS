// Remote and protocol harnesses: A2A agents, LangGraph servers, and ACP
// agents over stdio.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import type { Adapter } from "./types";

type Json = Record<string, unknown>;

const partsText = (parts: unknown): string =>
  ((parts as { kind?: string; type?: string; text?: string; data?: unknown }[] | undefined) ?? [])
    .map((p) => (p.text != null ? p.text : p.data != null ? JSON.stringify(p.data) : ""))
    .filter(Boolean)
    .join("\n");

/** A2A: message/send, one Task at a time; the context id carries the conversation. */
export const a2a: Adapter = async (t) => {
  let url = t.agent.harness.url?.trim();
  if (!url) throw new Error("A2A agent has no URL");
  if (/agent(-card)?\.json$/.test(url)) {
    const card = (await (await fetch(url, { signal: AbortSignal.timeout(15_000) })).json()) as Json;
    url = String(card.url ?? url);
  }
  const text = t.context ? `${t.context}\n\n---\n\n${t.input}` : t.input;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "message/send", params: { message: { role: "user", kind: "message", messageId: crypto.randomUUID(), parts: [{ kind: "text", text }], ...(t.session ? { contextId: t.session } : {}) } } }),
    signal: AbortSignal.any([t.rc.signal, AbortSignal.timeout(600_000)]),
  });
  const body = (await res.json()) as { result?: Json; error?: { message: string } };
  if (body.error) throw new Error(`A2A: ${body.error.message}`);
  const r = body.result ?? {};
  const fromArtifacts = ((r.artifacts as Json[] | undefined) ?? []).map((a) => partsText(a.parts)).join("\n");
  const fromStatus = partsText(((r.status as Json | undefined)?.message as Json | undefined)?.parts);
  const state = (r.status as Json | undefined)?.state;
  if (state === "failed" || state === "rejected") throw new Error(`A2A task ${state}: ${fromStatus}`);
  return { text: fromArtifacts || fromStatus || partsText(r.parts), session: String(r.contextId ?? t.session ?? "") || undefined };
};

/** LangGraph server: POST /runs/wait (stateless) or /threads/{id}/runs/wait. */
export const langgraph: Adapter = async (t) => {
  const base = t.agent.harness.url?.trim().replace(/\/$/, "");
  if (!base) throw new Error("LangGraph agent needs the server URL (harness url), e.g. http://127.0.0.1:2024");
  const assistant = String(t.agent.harness.loop_params?.assistant_id ?? t.agent.name);
  let thread = t.session;
  if (!thread) {
    const r = await fetch(`${base}/threads`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    thread = r.ok ? String(((await r.json()) as Json).thread_id ?? "") : undefined;
  }
  const messages = [...(t.context ? [{ role: "system", content: t.context }] : []), { role: "user", content: t.input }];
  const res = await fetch(thread ? `${base}/threads/${thread}/runs/wait` : `${base}/runs/wait`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assistant_id: assistant, input: { messages } }),
    signal: AbortSignal.any([t.rc.signal, AbortSignal.timeout(900_000)]),
  });
  if (!res.ok) throw new Error(`LangGraph ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const state = (await res.json()) as Json;
  const msgs = (state.messages as { content?: unknown; type?: string; role?: string }[] | undefined) ?? [];
  const last = [...msgs].reverse().find((m) => m.type === "ai" || m.role === "assistant") ?? msgs[msgs.length - 1];
  const content = last?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join("") : JSON.stringify(state);
  return { text, session: thread };
};

/** Agent Client Protocol over stdio: initialize, session/new, session/prompt; text from agent_message_chunk updates. */
export const acp: Adapter = async (t) => {
  const command = t.agent.harness.command?.trim();
  if (!command) throw new Error("ACP agent has no command (e.g. gemini --experimental-acp)");
  if (!t.rc.config.allowLocalExec) throw new Error("ACP agents run on the server: enable MAS_ALLOW_LOCAL_EXEC=1 to allow them");
  const p = spawn("sh", ["-c", command], { cwd: t.cwd, stdio: ["pipe", "pipe", "pipe"] });
  t.rc.signal.addEventListener("abort", () => p.kill(), { once: true });
  let id = 0;
  let buf = "";
  let text = "";
  const pending = new Map<number, (m: Json) => void>();
  const send = (m: Json) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  const request = (method: string, params: unknown) => new Promise<Json>((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(`ACP ${method}: ${(m.error as Json).message}`)) : resolve((m.result ?? {}) as Json)));
    send({ id: n, method, params });
  });
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let m: Json;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.id != null && !m.method) pending.get(Number(m.id))?.(m);
      else if (m.method === "session/update") {
        const u = ((m.params as Json)?.update ?? {}) as Json;
        if (u.sessionUpdate === "agent_message_chunk") text += String(((u.content as Json) ?? {}).text ?? "");
        if (u.sessionUpdate === "tool_call") t.rc.emit({ type: "tool", node: t.node, tool: String(u.title ?? u.kind ?? "tool"), args: "", result: "(inside the ACP agent)" });
      } else if (m.method === "session/request_permission" && m.id != null) send({ id: m.id, result: { outcome: { outcome: "cancelled" } } });
      else if (m.id != null && m.method) send({ id: m.id, error: { code: -32601, message: "not supported by MAS Studio" } });
    }
  });
  try {
    await request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const mcpServers = t.mcp ? [{ type: "http", name: "mas", url: t.mcp.url, headers: [{ name: "Authorization", value: `Bearer ${t.mcp.token}` }] }] : [];
    const session = t.session ?? String((await request("session/new", { cwd: t.cwd, mcpServers })).sessionId);
    const prompt = t.context ? `${t.context}\n\n---\n\n${t.input}` : t.input;
    await request("session/prompt", { sessionId: session, prompt: [{ type: "text", text: prompt }] });
    return { text: text.trim(), session };
  } finally {
    p.kill();
  }
};
