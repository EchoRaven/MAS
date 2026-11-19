// The architect: an agent that builds a multi-agent system on the canvas from
// a description. It works through the same editing operations a person has,
// then has to fix whatever the validator and the contracts still complain
// about before it is allowed to finish.
import { autoLayout } from "@/model/layout";
import type { SystemDoc } from "@/model/types";
import type { ChatMessage, Models, Part } from "../runtime/models";
import { textOf, userText } from "../runtime/models";
import { Draft } from "./draft";
import { DESIGN_TOOLS, runDesignTool } from "./tools";

const SYSTEM = `You design multi-agent systems on a canvas, out of these components:

· agent — a model with instructions, tools and a loop. The unit of judgement.
· model — one model call, no tools and no loop. Cheaper than an agent for a fixed transformation.
· function — code. Use it for anything deterministic: routing, voting, merging, parsing, arithmetic. Never make an agent do what code can do exactly.
· human — a person in the loop: they start the work, answer questions, or approve actions.
· env — something the system acts on: a room (a shared conversation), a sandbox (runs code), a database, a browser.
· plugin — something an agent carries: memory, a knowledge base, a workspace of files, a task board.
· group — a sub-system on its own canvas. Give it max_rounds and an "until" condition to make it repeat (a debate, a review loop, a role-play).

How work moves:
· message — send and carry on. The default.
· call — ask and wait. The caller gets it as a tool, so an agent chooses when to ask. Use it for a specialist the caller consults. Calls must not form a cycle.
· handoff — pass the work on and step out. carry: "full" hands over the whole conversation.
· access — an agent uses an env or a plugin. They must be on the same canvas.

Two shapes worth knowing:
· Several components working in parallel on the same input: connect the splitter to each of them, give each one its own input port on a function with join "all", and connect that function onward. The function runs once every port has arrived, and receives { port: value }.
· A loop: put the parts in a group with max_rounds and an until condition, and wire the last part to the group's output port with no filter. Every round reaches the output; the until condition (an expression over output, such as output.includes("APPROVED")) decides whether the group goes again or passes the output on. The group feeds each round's output back in by itself, so nothing inside should connect back to the start.
· Trying candidates in turn (several plans, best first, until one passes its tests): a group with over set to an expression that picks the list from its input (over: "input.plans"), until the passing condition, and max_rounds the number to try at most. Round n receives item n. A repair loop for each candidate is a group with max_rounds inside it.
· A decision — work goes one way OR another: a component with several plain connections sends every message down all of them. To choose, put a filter on each connection (an expression over the message, such as text.includes("REFUND")), and have the sender say which way in its reply. Or put a function in between with one output port per branch that returns { branch: value }.
· A person who approves: connect to them with call. They reply "Approved" or "Rejected", and the caller decides what happens next.
· Many answers from one model, then a vote (self-consistency, an ensemble): one model component with replicas, connected to a function that counts the final answers in the list it receives. Do not wire the same component several times.
· A function deep in a pipeline that needs the original task can read it as ctx.run_input.

How to design well:
· Give each agent one job, and write its instructions as if to a new colleague: what it does, what it produces, when it is finished.
· Prefer the simplest shape that does the work. Two agents that do the same thing are one agent.
· Put a human where a person really is needed: at the start, at an irreversible action, or where judgement is theirs.
· A loop needs a way out: an until condition, or a round limit.
· Wire the result back to whoever asked for it, so the run ends with an answer. When that answer has a definite kind (a number, code, JSON, one of some options), say so with describe's result, so every run is checked.
· A room conversation needs an end: someone who says TERMINATE, or end_after on the room.

Work in this order: add the components, set any ports you need, connect them, choose the entry point, name the system, then call review and fix everything it lists as MUST FIX. Call review again after fixing. When review reports no errors, stop and reply with two or three sentences on how the system works.`;

export interface DesignResult {
  doc: SystemDoc;
  /** what the architect did, step by step */
  log: { tool: string; args: string; result: string }[];
  summary: string;
  errors: string[];
  warnings: string[];
  usage: { tokens_in: number; tokens_out: number; usd: number };
}

export async function design(opts: { models: Models; model?: string | null; prompt: string; doc?: SystemDoc; signal?: AbortSignal; maxSteps?: number; knowledge?: string[]; services?: { id: string; name: string; expose: string }[] }): Promise<DesignResult> {
  const draft = opts.doc ? new Draft(structuredClone(opts.doc)) : Draft.blank("New system");
  draft.usable = { chat: opts.models.usable("chat").map((m) => m.id), embedding: opts.models.usable("embedding").map((m) => m.id), rerank: opts.models.usable("rerank").map((m) => m.id) };
  draft.knowledge = opts.knowledge ?? null;
  draft.services = opts.services ?? null;
  const log: DesignResult["log"] = [];
  const usage = { tokens_in: 0, tokens_out: 0, usd: 0 };
  // name only the models that can be called here, so the design runs as built
  const usable = new Set([...draft.usable.chat, ...draft.usable.embedding]);
  const catalog = draft.doc.models.filter((m) => !usable.size || usable.has(m.id)).map((m) => `${m.id} (${m.model}${m.kind && m.kind !== "chat" ? `, ${m.kind}` : ""})`).join(", ");
  const tools = draft.doc.tools.map((t) => `${t.id}: ${t.description}`).join("\n");
  const task = opts.doc
    ? `Change this system as asked. It is already on the canvas; keep what still fits.\n\nWhat they asked for:\n${opts.prompt}\n\nThe system now:\n${draft.review()}`
    : `Build a system for this:\n\n${opts.prompt}`;
  const kb =
    (opts.knowledge ? `\nThe knowledge base holds: ${opts.knowledge.join(", ") || "nothing yet"}` : "") +
    (opts.services?.length ? `\nHosted services (MCP servers on this server, for a plugin's service option): ${opts.services.map((s) => `${s.id} (${s.name}, ${s.expose})`).join(", ")}` : "");
  const messages: ChatMessage[] = [userText(`${task}\n\nModels you can name: ${catalog}\nTools an agent can be given:\n${tools}${kb}`)];
  let summary = "";
  const max = opts.maxSteps ?? 32;

  for (let step = 0; step < max; step++) {
    const { res, usage: u } = await opts.models.chat(opts.model ?? null, { system: SYSTEM, messages, tools: DESIGN_TOOLS, signal: opts.signal });
    usage.tokens_in += u.tokens_in;
    usage.tokens_out += u.tokens_out;
    usage.usd += u.usd;
    messages.push({ role: "assistant", content: res.content });
    const calls = res.content.filter((p): p is Extract<Part, { type: "tool_call" }> => p.type === "tool_call");
    if (!calls.length) {
      summary = textOf(res.content);
      const left = draft.problems().errors;
      // it stopped while the system is still broken: hand it the errors once more
      if (left.length && step < max - 1) {
        messages.push(userText(`The system still has ${left.length} error${left.length > 1 ? "s" : ""}. Fix them, then call review again.\n- ${left.join("\n- ")}`));
        continue;
      }
      break;
    }
    const results: Part[] = [];
    for (const c of calls) {
      const result = await runDesignTool(draft, c.name, c.input);
      log.push({ tool: c.name, args: JSON.stringify(c.input).slice(0, 2000), result: result.slice(0, 2000) });
      results.push({ type: "tool_result", id: c.id, content: result });
    }
    // the steps run out: say so while there is room to finish (wire up, describe, explain) instead of stopping mid-edit
    const left = max - step - 1;
    if (left === 4) results.push({ type: "text", text: `${left} steps left. Finish now: fix what review reports, call describe (name, description, result), then reply with your summary.` } as Part);
    messages.push({ role: "user", content: results });
  }

  // out of steps with no explanation: ask for one, with no tools, so the person always learns what was built
  if (!summary) {
    const { res, usage: u } = await opts.models.chat(opts.model ?? null, {
      system: SYSTEM,
      messages: [...messages, userText("You are out of steps. In a few sentences, say what the system you built does, how its parts work together, and anything left to finish.")],
      signal: opts.signal,
    });
    usage.tokens_in += u.tokens_in;
    usage.tokens_out += u.tokens_out;
    usage.usd += u.usd;
    summary = textOf(res.content);
  }

  const { errors, warnings } = draft.problems();
  // a fresh design gets a tidy layout; an edited one keeps the arrangement its owner made
  if (!opts.doc) autoLayout(draft.doc);
  draft.doc.updated_at = new Date().toISOString();
  return { doc: draft.doc, log, summary: summary || "The architect stopped before it explained the system.", errors, warnings, usage };
}
