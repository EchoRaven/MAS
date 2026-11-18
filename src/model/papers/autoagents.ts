// AutoAgents: the team is not fixed in advance. A planner drafts the agents a
// task needs and a plan that uses them; an agent observer and a plan observer
// both have to approve the draft. Then an action observer brings the drafted
// agents to life one step at a time, checks each result, and composes the answer.
import { Builder, native, type TemplateInfo } from "../builder";
import { autoLayout } from "../layout";
import { port } from "../ports";
import type { SystemDoc } from "../types";

// both observers must approve; otherwise their feedback goes back to the planner
const REVIEW = `const ok = (t) => /^\\s*APPROVED\\b/i.test(String(t));
const draft = String(input.draft);
if (ok(input.agents) && ok(input.plan)) return { approved: { role: "assistant", text: "APPROVED DRAFT:\\n" + draft, approved: true } };
const notes = [];
if (!ok(input.agents)) notes.push("Agent observer: " + String(input.agents).trim());
if (!ok(input.plan)) notes.push("Plan observer: " + String(input.plan).trim());
return { revise: { role: "assistant", text: "Your draft:\\n" + draft + "\\n\\nRevise it. Feedback:\\n" + notes.join("\\n"), approved: false } };`;

const PLANNER = `Draft the team for the task and the plan that uses it.
1. Agents: 2-4 expert roles the task needs. For each: name, expertise, and what it is responsible for.
2. Plan: numbered steps; each names exactly one of those agents and what it must produce.
If feedback on an earlier draft is given, revise the draft to address it. Reply with the draft only.`;

const AGENT_OBSERVER = `You check the agents in a draft. Are they the right experts for the task, with no gaps and no overlaps, each with a clear responsibility?
If yes, reply exactly: APPROVED. Otherwise reply with what to change, in at most three sentences.`;

const PLAN_OBSERVER = `You check the plan in a draft. Does every step name one of the drafted agents, are the steps in a sensible order, and do they lead to a complete answer?
If yes, reply exactly: APPROVED. Otherwise reply with what to change, in at most three sentences.`;

const ACTION_OBSERVER = `You carry out an approved draft. Go through the plan step by step. For each step, call spawn_subagents with one task that starts "You are <the agent's name>, <its expertise>." followed by what the step must produce and the results it needs from earlier steps.
Check each result before going on: if it is wrong or incomplete, run the step again with your correction. When every step is done, reply with the final answer to the original task, built from the results; when the task asks for one value (a number, a choice), end with a last line 'Answer: X' giving only it, after any checks.`;

function build(): SystemDoc {
  const b = new Builder(
    "AutoAgents",
    "Agents generated for the task. A planner drafts expert agents and a plan; an agent observer and a plan observer must both approve, or the draft goes back with their feedback. An action observer then creates each drafted agent when its step comes up, checks its result, and composes the answer.",
  );
  const h = (instructions: string) => ({ ...native(), loop: "single_shot" as const, instructions });
  b.node("user", "human", 0, 0, { name: "User", role: "Gives the task", approves: false })
    .group("drafting", 0, 0, {
      name: "Drafting",
      iterate: { max_rounds: 3, until: "output.approved", feed: "input_and_output" },
      interface: { inputs: [port("task", "message")], outputs: [port("draft", "message")] },
    })
    .agent("planner", 0, 0, { name: "Planner", role: "Drafts the agents and the plan", model: "opus", harness: h(PLANNER) }, "drafting")
    .agent("agent_observer", 0, 0, { name: "Agent observer", role: "Checks the drafted agents", model: "sonnet", harness: h(AGENT_OBSERVER) }, "drafting")
    .agent("plan_observer", 0, 0, { name: "Plan observer", role: "Checks the plan", model: "sonnet", harness: h(PLAN_OBSERVER) }, "drafting")
    .node("review", "function", 0, 0, {
      name: "Both approve?",
      join: "all",
      fn: { lang: "js", code: REVIEW },
      interface: { inputs: [port("draft", "text", { required: true }), port("agents", "text", { required: true }), port("plan", "text", { required: true })], outputs: [port("approved", "message"), port("revise", "message")] },
    }, "drafting")
    .agent("action_observer", 0, 0, {
      name: "Action observer",
      role: "Creates the drafted agents step by step and composes the answer",
      model: "opus",
      harness: { ...native(), loop: "react", max_steps: 12, instructions: ACTION_OBSERVER },
      spawn: { template: "generated", max_instances: 1 },
    })
    .agent("generated", 0, 0, { name: "Generated agent", role: "Becomes whichever drafted agent its task names", model: "sonnet", harness: h("Act as the agent your task names, with its expertise. Do exactly the step you are given and report the result.") });
  b.edge("user", "drafting", "message", { label: "Task" })
    .edge("drafting", "planner", "message")
    .edge("planner", "agent_observer", "message")
    .edge("planner", "plan_observer", "message")
    .edge("planner", "review", "message", { target_port: "draft" })
    .edge("agent_observer", "review", "message", { target_port: "agents" })
    .edge("plan_observer", "review", "message", { target_port: "plan" })
    .edge("review", "drafting", "message", { source_port: "approved" })
    .edge("review", "drafting", "message", { source_port: "revise" })
    .edge("drafting", "action_observer", "message", { label: "Approved draft" })
    .edge("action_observer", "user", "message", { label: "Answer" });
  b.doc.budget = { usd: 3, max_rounds: 60, wallclock_min: 20 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return autoLayout(b.doc);
}

export const autoagents: TemplateInfo = {
  id: "paper-autoagents",
  name: "AutoAgents",
  summary: "agents drafted per task · two observers approve the draft · agents created step by step",
  build,
  paper: { title: "AutoAgents: A Framework for Automatic Agent Generation", authors: "Chen et al.", year: 2023, url: "https://arxiv.org/abs/2309.17288" },
  notes: {
    mapped: [
      "The drafting stage is a Group that iterates: the planner drafts agents and a plan; the agent observer and the plan observer review it in parallel; a join-all function lets the draft out only when both reply APPROVED (until: output.approved), and otherwise feeds their feedback back to the planner. At most 3 drafts.",
      "Agent generation is spawning: the action observer creates a copy of a template agent for each plan step, told in its task which drafted agent it is. So the team is whatever the draft says, different for every task.",
      "The execution stage is the action observer's ReAct loop: one step at a time, checking each result and re-running a step with a correction when needed, then composing the final answer.",
    ],
    differs: [
      "The paper's generated agents can also hold tools and a long-term memory of their own; here they get only the task text, so give the template agent tools to add that.",
      "The paper lets several agents collaborate within one step (collaborative refinement); here each step is one agent, and the action observer does the cross-checking.",
      "If the observers never both approve, the third draft goes on to execution anyway, as the round limit ends the drafting.",
    ],
  },
};
