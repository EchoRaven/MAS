// The native agent loops (slot "loop" of the step registry).
import type { AgentData } from "@/model/types";
import { runFn } from "../functions";
import type { ChatMessage, Part } from "../models";
import { textOf, userText } from "../models";
import { parseJsonLoose } from "../values";
import type { AgentIO } from "./model";

export interface LoopInput {
  system: string;
  history: ChatMessage[];
  input: string;
}

const lp = (a: AgentData, k: string) => a.harness.loop_params?.[k];
const n = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);

function maskOld(messages: ChatMessage[], keep = 3) {
  const idx = messages.map((m, i) => (m.content.some((p) => p.type === "tool_result") ? i : -1)).filter((i) => i >= 0);
  for (const i of idx.slice(0, -keep)) messages[i] = { role: "user", content: messages[i].content.map((p) => (p.type === "tool_result" ? { ...p, content: "[earlier tool output hidden]" } : p)) };
}

/** ReAct: call the model; run the tools it asks for; repeat until it answers. */
export async function react(io: AgentIO, li: LoopInput, extraUser = ""): Promise<string> {
  const a = io.agent;
  const max = n(lp(a, "max_steps") ?? a.harness.max_steps, 30);
  const messages: ChatMessage[] = [...li.history, userText(li.input + extraUser)];
  for (let step = 0; step < max; step++) {
    if (a.context.mask_tool_output && messages.length > 12) maskOld(messages);
    const res = await io.model({ system: li.system, messages, tools: io.tools.length > 0 || io.serverTools.length > 0 });
    messages.push({ role: "assistant", content: res.content });
    if (res.stop === "pause") continue;
    const calls = res.content.filter((p): p is Extract<Part, { type: "tool_call" }> => p.type === "tool_call");
    if (!calls.length) return textOf(res.content);
    messages.push({ role: "user", content: await io.runTools(calls) });
  }
  const final = await io.model({ system: li.system, messages: [...messages, userText("You have used all your steps. Give your final answer now.")], tools: false });
  const answer = textOf(final.content).trim();
  if (answer) return answer;
  // an agent that runs out of steps still has to say something: its last words, or what its tools found
  const said = [...messages].reverse().map((m) => (m.role === "assistant" ? textOf(m.content).trim() : "")).find(Boolean);
  if (said) return said;
  const found = [...messages].reverse().flatMap((m) => m.content.filter((p): p is Extract<Part, { type: "tool_result" }> => p.type === "tool_result")).map((p) => p.content)[0];
  return `I ran out of steps before finishing.${found ? ` The last thing I found:\n${found.slice(0, 2000)}` : ""}`;
}

export async function singleShot(io: AgentIO, li: LoopInput): Promise<string> {
  const res = await io.model({ system: li.system, messages: [...li.history, userText(li.input)], tools: false });
  return textOf(res.content);
}

/** Plan first, then execute with the plan in view; re-plan once if execution reports failure. */
export async function planExecute(io: AgentIO, li: LoopInput): Promise<string> {
  const planner = (lp(io.agent, "planner") as string) || null;
  const toolList = io.tools.map((t) => `- ${t.name}: ${t.description}`).join("\n") || "(no tools)";
  const plan = textOf((await io.model({ system: li.system, messages: [...li.history, userText(`${li.input}\n\nBefore doing anything, write a short numbered plan. Available tools:\n${toolList}\nReply with the plan only.`)], tools: false, model: planner })).content);
  io.rc.emit({ type: "transform", at: io.node, label: "plan", detail: plan.slice(0, 300) });
  let out = await react(io, li, `\n\nFollow this plan:\n${plan}`);
  if (lp(io.agent, "replan") !== false && /\b(failed|cannot|unable|error)\b/i.test(out)) {
    const replan = textOf((await io.model({ system: li.system, messages: [userText(`Task: ${li.input}\nPlan: ${plan}\nResult: ${out}\nThe plan did not work. Write a better plan, numbered, plan only.`)], tools: false, model: planner })).content);
    io.rc.emit({ type: "transform", at: io.node, label: "re-plan", detail: replan.slice(0, 300) });
    out = await react(io, li, `\n\nFollow this plan:\n${replan}`);
  }
  return out;
}

/** Act, critique, retry with the critique, up to max_trials. */
export async function reflexion(io: AgentIO, li: LoopInput): Promise<string> {
  const trials = n(lp(io.agent, "max_trials"), 3);
  const critic = (lp(io.agent, "critic") as string) || null;
  const prompt = String(lp(io.agent, "critique") ?? "Point out what is wrong or missing in the answer.");
  let reflections = "";
  let answer = "";
  for (let i = 1; i <= trials; i++) {
    answer = await react(io, li, reflections ? `\n\nLessons from earlier attempts:\n${reflections}` : "");
    if (i === trials) break;
    const crit = textOf((await io.model({ system: "You review answers strictly.", messages: [userText(`Task:\n${li.input}\n\nAnswer:\n${answer}\n\n${prompt} If the answer is complete and correct, reply exactly OK.`)], tools: false, model: critic })).content).trim();
    io.rc.emit({ type: "transform", at: io.node, label: `critique ${i}`, detail: crit.slice(0, 300) });
    if (/^OK\.?$/i.test(crit)) break;
    reflections += `- Attempt ${i}: ${crit}\n`;
  }
  return answer;
}

/** Branch into candidate answers, score them, expand the best, for `depth` levels. */
export async function treeSearch(io: AgentIO, li: LoopInput): Promise<string> {
  const branches = Math.min(n(lp(io.agent, "branches"), 3), 6);
  const depth = Math.min(n(lp(io.agent, "depth"), 2), 3);
  const evaluator = (lp(io.agent, "evaluator") as string) || null;
  let best = "";
  for (let d = 0; d < depth; d++) {
    const prompt = best ? `${li.input}\n\nA previous candidate answer:\n${best}\n\nWrite an improved answer, taking a different angle where useful.` : li.input;
    const cands = await Promise.all(
      Array.from({ length: branches }, async (_, i) => textOf((await io.model({ system: `${li.system}\n\n(Candidate ${i + 1} of ${branches}: think independently.)`, messages: [...li.history, userText(prompt)], tools: false, temperature: 1 })).content)),
    );
    const scoring = textOf((await io.model({ system: "You score candidate answers.", messages: [userText(`Task:\n${li.input}\n\n${cands.map((c, i) => `[${i}]\n${c}`).join("\n\n")}\n\nScore each candidate 0-10. Reply one line per candidate: index score.`)], tools: false, model: evaluator })).content);
    const scores = cands.map((_, i) => Number(new RegExp(`\\[?${i}\\]?\\s*[:\\-]?\\s*(\\d+(?:\\.\\d+)?)`).exec(scoring)?.[1] ?? 0));
    const top = scores.indexOf(Math.max(...scores));
    best = cands[top];
    io.rc.emit({ type: "transform", at: io.node, label: `level ${d + 1}`, detail: `${branches} candidates, best scored ${scores[top]}` });
  }
  return best;
}

/**
 * The whole turn as user code: async (ctx, { model, tools, memory, emit }) => output.
 *   model(prompt, data?) / model.call(prompt | messages, data?) -> text · model.json(prompt, data?) -> parsed JSON
 *   tools.list() · tools.call(name, args) · tools.call_agent(name or id, instruction)
 *   memory.search(query) · memory.write(text)   (an attached memory plugin)
 *   emit(label, detail)
 *   ctx.task (the input text) · ctx.history (what happened this turn) · ctx.messages · ctx.system
 */
export async function customLoop(io: AgentIO, li: LoopInput, extra: Record<string, unknown>): Promise<string> {
  const fn = io.agent.harness.loop_fn;
  if (!fn) throw new Error("custom loop has no code");
  const history: { speaker: string; text: string }[] = [];
  const asPrompt = (prompt: unknown, data?: unknown) => (data === undefined ? String(prompt) : `${prompt}\n\n${typeof data === "string" ? data : JSON.stringify(data, null, 1)}`);
  const call = async (prompt: unknown, data?: unknown, opts: { system?: string; model?: string } = {}) => {
    const messages = Array.isArray(prompt) ? (prompt as ChatMessage[]).map((m) => ("content" in m && Array.isArray(m.content) ? m : userText(String((m as { text?: string }).text ?? m)))) : [...li.history, userText(asPrompt(prompt, data))];
    const res = await io.model({ system: opts.system ?? li.system, messages, tools: false, model: opts.model });
    return textOf(res.content);
  };
  const json = async (prompt: unknown, data?: unknown, opts: { system?: string; model?: string } = {}) => {
    const text = await call(`${asPrompt(prompt, data)}\n\nReply with only a JSON value.`, undefined, opts);
    try {
      return parseJsonLoose(text);
    } catch {
      return { text };
    }
  };
  const model = Object.assign((prompt: unknown, data?: unknown) => call(prompt, data), { call, json });
  const runTool = async (name: string, args: Record<string, unknown> = {}) => {
    const [r] = await io.runTools([{ type: "tool_call", id: `custom_${Math.random().toString(36).slice(2, 8)}`, name, input: args }]);
    return (r as { content: string }).content;
  };
  const tools = {
    list: () => io.tools.map((t) => ({ name: t.name, description: t.description })),
    call: runTool,
    call_agent: async (who: string, instruction: string) => {
      // names match loosely ("ComputerTerminal", "computer terminal", "terminal"), but an empty name matches nothing
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const key = norm(String(who ?? ""));
      const callable = io.tools.filter((x) => x.name.startsWith("ask_"));
      const named = (x: (typeof callable)[number]) => norm(x.description.replace(/^.*?ask\s+/i, "").split(/\s+\(|\s+and wait/)[0]);
      const t = key ? (callable.find((x) => norm(x.name.slice(4)) === key || named(x) === key) ?? callable.find((x) => named(x).includes(key) || key.includes(norm(x.name.slice(4))))) : undefined;
      if (!t) return `No call edge to "${who}". Callable: ${io.tools.filter((x) => x.name.startsWith("ask_")).map((x) => x.name.slice(4)).join(", ") || "none"}`;
      const reply = await runTool(t.name, { request: String(instruction ?? "") });
      history.push({ speaker: String(who), text: `${instruction}\n→ ${reply}` });
      return reply;
    },
  };
  const memTool = (suffix: string) => io.tools.find((t) => t.name === `memory_${suffix}` || t.name.startsWith(`memory_${suffix}_`));
  const memory = {
    search: async (query: string) => (memTool("search") ? runTool(memTool("search")!.name, { query }) : ""),
    write: async (text: string) => (memTool("write") ? runTool(memTool("write")!.name, { text }) : "no memory attached"),
  };
  const emit = (label: string, detail = "") => io.rc.emit({ type: "transform", at: io.node, label: String(label), detail: String(detail) });
  // the loop's own names come last: what the caller passes in must never shadow ctx.history (the call log)
  const ctxExtra = { ...extra, task: li.input, history, messages: [...li.history, userText(li.input)], system: li.system };
  const out = await runFn(fn, { text: li.input, system: li.system }, io.rc, { node: io.node, helpers: { ...ctxExtra, react: (more = "") => react(io, li, more) }, named: { model, tools, memory, emit }, timeoutMs: 30 * 60_000 });
  return typeof out === "string" ? out : JSON.stringify(out);
}
