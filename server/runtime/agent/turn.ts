// One agent turn: input stages -> context (instructions, injected memory /
// knowledge / room) -> harness loop with tools -> output stages -> history
// and after-turn writes.
import path from "node:path";
import type { AgentData, SysEdge, SysNode } from "@/model/types";
import { fillVars } from "@/run/vars";
import { nameOf } from "../context";
import { runFn } from "../functions";
import { ADAPTERS } from "../harness";
import { textOf, userText, type ChatMessage } from "../models";
import type { RtTool } from "../resources/types";
import { asText, isMsg, type Msg } from "../values";
import { schemaById } from "./jsonschema";
import { customLoop, planExecute, react, reflexion, singleShot, treeSearch, type LoopInput } from "./loops";
import { AgentIO } from "./model";
import { runStages, StageError } from "./stages";
import { agentTools, type ToolServices } from "./tools";

export interface TurnServices extends ToolServices {
  /** expose this agent's tools over MCP for process harnesses */
  exposeTools(node: string, tools: RtTool[]): { url: string; token: string; tools: string[] } | undefined;
}

/** What an agent remembers between its turns in one run. */
export class AgentState {
  history = new Map<string, ChatMessage[]>();
  summary = new Map<string, string>();
  sessions = new Map<string, string>();
  plans = new Map<string, string>();
  started = new Set<string>();
}

export interface TurnResult {
  output: unknown;
  text: string;
  port?: string;
  dropped?: boolean;
  /** handoff edges the agent chose */
  transfers: string[];
  /** the conversation so far: what was carried in, then this turn (what a full handoff passes on) */
  conversation?: ChatMessage[];
}

async function trimHistory(svc: TurnServices, state: AgentState, node: SysNode<AgentData>, io: AgentIO) {
  const c = node.data.context;
  const h = state.history.get(node.id) ?? [];
  const window = Math.max(2, c.history_window || 30);
  if (h.length <= window) return;
  const old = h.splice(0, h.length - window);
  if (c.history_strategy === "summary" || c.history_strategy === "window_then_summary") {
    const prev = state.summary.get(node.id) ?? "";
    const text = old.map((m) => `${m.role}: ${textOf(m.content)}`).join("\n");
    const res = await io.model({ system: "You keep running summaries of conversations.", messages: [userText(`${prev ? `Summary so far:\n${prev}\n\n` : ""}Add these messages to the summary, keeping decisions, facts and open items. Reply with the new summary only.\n\n${text}`)], tools: false });
    state.summary.set(node.id, textOf(res.content));
    svc.rc.emit({ type: "transform", at: node.id, label: "history summarised", detail: `${old.length} older messages` });
  }
}

export async function runAgentTurn(svc: TurnServices, state: AgentState, node: SysNode<AgentData>, input: unknown, via?: SysEdge): Promise<TurnResult> {
  const { rc, hub } = svc;
  const a = node.data;
  const transfers = new Set<string>();

  // input stages
  const pre = await runStages(rc, node.id, a.pipeline.pre, input, "in");
  if (pre.dropped) return { output: null, text: "", dropped: true, transfers: [] };
  const inputMsg = pre.value;
  const inputText = asText(inputMsg);

  const { tools, server_tools, access } = await agentTools(svc, node, transfers);
  // code often calls ctx.observe without awaiting it: it must never reject
  const observe = async (text: unknown) => {
    for (const e of access) {
      try {
        await hub.get(e.target).observe?.(node.id, typeof text === "string" ? text : JSON.stringify(text));
      } catch (err) {
        rc.emit({ type: "log", node: node.id, level: "warn", text: `observe → ${nameOf(rc, e.target)}: ${(err as Error).message}` });
      }
    }
  };
  const io = new AgentIO(rc, node.id, a, tools, server_tools, { observe });
  if (!state.started.has(node.id)) {
    state.started.add(node.id);
    // what on_start returns as text (a plan, a persona) stays in the agent's context for the run
    const started: unknown = await io.hook<unknown>("on_start", { input: inputText });
    if (typeof started === "string" && started.trim()) state.plans.set(node.id, started.trim());
  }

  // context: instructions, injected resources, room transcripts, output format
  const blocks: string[] = [];
  for (const e of access) {
    const mode = e.binding?.mode ?? "tool";
    const isRoom = rc.byId.get(e.target)?.data.kind === "env" && (rc.byId.get(e.target)!.data as { env_kind: string }).env_kind === "room";
    if (mode === "tool" && !isRoom) continue;
    try {
      const r = hub.get(e.target);
      const query = e.binding?.read?.query ? asText(await runFn(e.binding!.read!.query!, inputMsg, rc, { node: node.id, edge: e.id })) : inputText;
      let text = await r.beforeTurn?.({ node: node.id, input: query, edge: e });
      if (text && e.binding?.read?.format && !isRoom) text = asText(await runFn(e.binding!.read!.format!, text, rc, { node: node.id, edge: e.id }));
      if (text) {
        const budget = (e.binding?.read?.budget_tokens ?? 4000) * 4;
        blocks.push(text.length > budget ? text.slice(0, budget) + "\n…" : text);
        rc.emit({ type: "access", node: node.id, target: e.target, edge: e.id, op: "read" });
        rc.emit({ type: "transform", at: node.id, edge: e.id, label: `${isRoom ? "room" : "retrieve"} · ${nameOf(rc, e.target)}`, detail: `${text.split("\n").length} lines in context` });
      }
    } catch (err) {
      rc.emit({ type: "log", node: node.id, level: "warn", text: `${nameOf(rc, e.target)}: ${(err as Error).message}` });
    }
  }
  // memory the platform writes after each turn: the agent is told, so it does not go looking for a tool to save with
  const kept = access.filter((e) => e.binding?.write?.when === "after_turn" && e.access !== "read" && rc.byId.get(e.target)?.data.kind === "plugin").map((e) => nameOf(rc, e.target));
  if (kept.length) blocks.push(`What happens in this conversation is saved to ${kept.join(", ")} for you after each turn; you do not need to store anything yourself.`);
  // a long input is in the sandbox as a file: say so where the agent reads, or it pastes 44,000 characters into its
  // code (a note in the tool's description alone was ignored in 27 runs of 27)
  const boxes = access.filter((e) => e.access !== "read" && (rc.byId.get(e.target)?.data as { env_kind?: string } | undefined)?.env_kind === "sandbox").map((e) => nameOf(rc, e.target));
  if (boxes.length && (rc.input ?? "").length > 2000) blocks.push(`The run's input (${(rc.input ?? "").length.toLocaleString("en")} characters) is saved in ${boxes[0]} at /work/input.txt. To compute over it, read that file in your code; do not copy the text into a command.`);
  // passages put in front of the agent are a first pass; say how to look for what they missed
  const searchable = access
    .filter((e) => e.binding?.mode === "auto_inject")
    .map((e) => ({ name: nameOf(rc, e.target), tools: tools.filter((t) => t.source === e.target && (t.effect === "read" || t.effect === "pure")).map((t) => t.name) }))
    .filter((x) => x.tools.length);
  for (const s of searchable) blocks.push(`The passages from ${s.name} above were found for your input as a whole. If part of the question is not covered by them, search ${s.name} for that part with ${s.tools.join(" or ")} before answering.`);
  const outPort = a.interface.outputs[0];
  const stageSchema = a.pipeline.post.find((st) => (st.op === "parse_json" || st.op === "validate") && st.schema)?.schema;
  const wantsJson = outPort?.type === "json" || a.pipeline.post.some((st) => st.op === "parse_json");
  const schema = schemaById(rc.doc, stageSchema ?? (outPort?.type === "json" ? outPort.schema : null));
  const summary = state.summary.get(node.id);
  const plan = state.plans.get(node.id);
  const system = [
    `You are ${a.name}${a.role ? `, ${a.role}` : ""}.`,
    fillVars(a.harness.instructions, rc.vars),
    plan ? `Your plan:\n${plan}` : "",
    summary ? `Earlier conversation (summary):\n${summary}` : "",
    ...blocks,
    wantsJson ? `Reply with only a JSON value${schema ? ` matching this JSON Schema:\n${JSON.stringify(schema)}` : "."}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // full handoff: the previous agent's conversation comes along. Its last turn
  // is what was handed over, so repeating it as the incoming message would say
  // everything twice; the agent is simply told that it is its turn.
  const carried = isMsg(inputMsg) && Array.isArray((inputMsg as Msg).meta?.history) ? ((inputMsg as Msg).meta!.history as ChatMessage[]) : [];
  const handedOver = !!inputText && textOf(carried[carried.length - 1]?.content ?? []).endsWith(inputText);
  const history = [...carried, ...(state.history.get(node.id) ?? [])];
  const li: LoopInput = { system, history, input: handedOver ? "It is your turn. Respond to the conversation above." : inputText };

  let text: string;
  try {
    const dryRun = rc.models.mockAll && a.harness.tier !== "native";
    if (dryRun) rc.emit({ type: "log", node: node.id, level: "info", text: `Dry run: ${a.harness.runner} is stood in for by the test model` });
    if (a.harness.tier === "native" || dryRun) {
      const loop = dryRun ? "react" : (a.harness.loop ?? "react");
      text =
        loop === "single_shot" ? await singleShot(io, li)
        : loop === "plan_execute" ? await planExecute(io, li)
        : loop === "reflexion" ? await reflexion(io, li)
        : loop === "tree_search" ? await treeSearch(io, li)
        : loop === "custom" ? await customLoop(io, li, { input: inputMsg, conversation: history })
        : await react(io, li);
    } else {
      const adapter = ADAPTERS[a.harness.runner ?? ""];
      if (!adapter) throw new Error(`No adapter for harness "${a.harness.runner}"`);
      const cwd = rc.store.stateDir(rc.doc.id, node.id, "work");
      // tools reached over MCP go through the same hooks, approvals, policies and events as native calls
      const viaIo = tools.map((t) => ({
        ...t,
        run: async (args: Record<string, unknown>) => {
          const [r] = await io.runTools([{ type: "tool_call", id: `mcp_${Math.random().toString(36).slice(2, 10)}`, name: t.name, input: args }]);
          const res = r as { content: string; error?: boolean };
          if (res.error) throw new Error(res.content.replace(/^Error: /, ""));
          return res.content;
        },
      }));
      const r = await adapter({ rc, node: node.id, agent: a, input: inputText, context: system, cwd: path.resolve(cwd), mcp: tools.length ? svc.exposeTools(node.id, viaIo) : undefined, session: state.sessions.get(node.id) });
      if (r.session) state.sessions.set(node.id, r.session);
      if (r.usage) rc.usage(node.id, { model: r.usage.model ?? a.harness.runner ?? "", tokens_in: r.usage.tokens_in, tokens_out: r.usage.tokens_out, usd: r.usage.usd }, r.usage.estimated);
      text = r.text;
    }
  } catch (e) {
    await io.hook("on_error", { where: "turn", error: (e as Error).message }).catch(() => null);
    throw e;
  }

  // output stages, with the configured recovery
  let out: unknown = text;
  let port: string | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      const post = await runStages(rc, node.id, a.pipeline.post, out, "out", a.interface.outputs.map((p) => p.id));
      if (post.dropped) return { output: null, text, dropped: true, transfers: [...transfers] };
      out = post.value;
      port = post.port;
      break;
    } catch (e) {
      if (!(e instanceof StageError)) throw e;
      const st = e.stage;
      if (st.on_fail === "retry" && attempt < (st.max_retries ?? 2) && a.harness.tier === "native") {
        rc.emit({ type: "transform", at: node.id, label: `out · ${st.name}`, detail: `failed, asking again: ${e.message}` });
        const res = await io.model({ system, messages: [...history, userText(inputText), { role: "assistant", content: [{ type: "text", text: asText(out) }] }, userText(`That reply failed a check: ${e.message}. Reply again, fixing it.`)], tools: false });
        out = text = textOf(res.content);
        continue;
      }
      if (st.on_fail === "drop") return { output: null, text, dropped: true, transfers: [...transfers] };
      if (st.on_fail === "fallback") {
        rc.emit({ type: "log", node: node.id, level: "warn", text: `${e.message}; passing the raw reply on` });
        break;
      }
      throw e;
    }
  }

  // history and after-turn writes
  const h = state.history.get(node.id) ?? [];
  h.push(userText(inputText), { role: "assistant", content: [{ type: "text", text: text || "(no reply)" }] });
  state.history.set(node.id, h);
  await trimHistory(svc, state, node, io).catch((e) => rc.emit({ type: "log", node: node.id, level: "warn", text: `history summary failed: ${(e as Error).message}` }));
  for (const e of access.filter((x) => x.binding?.write?.when === "after_turn" && x.access !== "read")) {
    try {
      const r = await hub.get(e.target).afterTurn?.({ node: node.id, input: inputText, output: text, messages: [{ role: "user", text: inputText }, { role: "assistant", text }], edge: e, binding: e.binding! });
      if (!r || r.wrote) rc.emit({ type: "access", node: node.id, target: e.target, edge: e.id, op: "write" });
    } catch (err) {
      rc.emit({ type: "log", node: node.id, level: "warn", text: `${nameOf(rc, e.target)} write: ${(err as Error).message}` });
    }
  }
  await io.hook("on_finish", { input: inputText, output: text });
  void via;
  const conversation: ChatMessage[] = [...carried, ...(handedOver ? [] : [userText(inputText)]), { role: "assistant", content: [{ type: "text", text: `${a.name}: ${text || "(no reply)"}` }] }];
  return { output: out, text, port, transfers: [...transfers], conversation };
}
