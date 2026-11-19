// MACM (Multi-Agent Condition Mining): a Thinker lists what the problem
// gives and asks, then mines new conditions from the known ones, one at a
// time; a Judge keeps only the conditions it can verify and says when they
// are enough to reach the objective; the Thinker plans from the verified
// conditions and an Executor carries the plan out. The control flow is code
// (a function calling the three roles with ctx.call), the roles are
// components, so each call and reply is a message in the run.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const LOOP = `const problem = String(input?.text ?? input ?? "");
const rounds = Math.max(1, Math.min(8, Math.floor(Number(ctx.vars.rounds ?? 4)) || 4));
const lines = (t, tag) => String(t).split("\\n").map((l) => l.replace(/^[\\s*#>-]+/, "")).filter((l) => l.toLowerCase().startsWith(tag.toLowerCase() + ":")).map((l) => l.slice(tag.length + 1).replace(/\\*+/g, "").trim()).filter(Boolean);
const listed = (cs) => cs.map((c, i) => (i + 1) + ". " + c).join("\\n");

// 1. what the problem gives, and what it asks
const start = await ctx.call("Thinker", "Read the problem. List every condition it gives, one per line as 'Condition: ...', and what it asks as one line 'Objective: ...'. Do not solve it.\\n\\nProblem:\\n" + problem);
const known = lines(start, "Condition");
const objective = lines(start, "Objective")[0] ?? "answer the problem's question";

// 2. mine new conditions; keep the verified ones; stop when they suffice
for (let r = 0; r < rounds; r++) {
  const proposal = await ctx.call("Thinker", "Problem:\\n" + problem + "\\n\\nKnown conditions:\\n" + listed(known) + "\\n\\nObjective: " + objective + "\\n\\nDerive ONE new condition from the known ones that moves toward the objective. Show the derivation, then give it as one line 'New condition: ...'.");
  const fresh = lines(proposal, "New condition")[0];
  if (!fresh) continue;
  const verdict = await ctx.call("Judge", "Problem:\\n" + problem + "\\n\\nKnown conditions:\\n" + listed(known) + "\\n\\nProposed new condition: " + fresh + "\\n\\nIts derivation:\\n" + proposal + "\\n\\nCheck the derivation step by step, redoing any computation. Is the new condition correct? End with one line 'Verdict: True' or 'Verdict: False'.");
  if (/verdict:\\s*\\**\\s*true/i.test(verdict)) known.push(fresh);
  else continue;
  const enough = await ctx.call("Judge", "Problem:\\n" + problem + "\\n\\nVerified conditions:\\n" + listed(known) + "\\n\\nObjective: " + objective + "\\n\\nCan the objective now be reached directly from these conditions, with no further insight? End with one line 'Sufficient: Yes' or 'Sufficient: No'.");
  if (/sufficient:\\s*\\**\\s*yes/i.test(enough)) break;
}

// 3. plan from the verified conditions; 4. carry the plan out
const plan = await ctx.call("Thinker", "Problem:\\n" + problem + "\\n\\nVerified conditions:\\n" + listed(known) + "\\n\\nObjective: " + objective + "\\n\\nWrite the steps that reach the objective from these conditions, as a numbered list. Do not carry them out.");
return await ctx.call("Executor", "Problem:\\n" + problem + "\\n\\nVerified conditions:\\n" + listed(known) + "\\n\\nPlan:\\n" + plan + "\\n\\nCarry out the plan step by step, computing carefully. Give the final answer in \\\\boxed{}, then a last line 'Answer: X'.");`;

function build(): SystemDoc {
  const b = new Builder(
    "MACM (condition mining)",
    "A Thinker lists the problem's conditions and objective, then mines new conditions one at a time; a Judge keeps only those it verifies and says when they suffice (at most `rounds`, a run variable, 4 by default); the Thinker plans from the verified conditions and an Executor carries the plan out. The loop is a function calling the three roles with ctx.call.",
  );
  const role = (id: string, name: string, x: number, y: number, system: string) =>
    b.node(id, "model", x, y, { name, model: "sonnet", system_prompt: system, prompt: "{{input}}", temperature: null, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
  b.node("asker", "human", 0, 160, { name: "Asker", role: "Poses the problem", approves: false }).node("macm", "function", 280, 160, {
    name: "Condition mining",
    join: "any",
    fn: { lang: "js", code: LOOP, timeout_ms: 1_200_000 },
    interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] },
  });
  role("thinker", "Thinker", 600, 0, "You are the Thinker in a team solving a math problem. You state conditions precisely and derive new ones rigorously, one small step at a time.");
  role("judge", "Judge", 600, 160, "You are the Judge in a team solving a math problem. You verify each claim on its own merits, redoing every computation; you accept nothing you have not checked.");
  role("executor", "Executor", 600, 320, "You are the Executor in a team solving a math problem. You carry out a given plan exactly, computing carefully, and report the final answer.");
  b.edge("asker", "macm", "message", { label: "Problem" })
    .edge("macm", "thinker", "call", { label: "Conditions, plan" })
    .edge("macm", "judge", "call", { label: "Verify" })
    .edge("macm", "executor", "call", { label: "Carry out" })
    .edge("macm", "asker", "message", { label: "Answer" });
  // every call to a role is a turn: 1 + 3 per mining round + 2, so 8 rounds need 27
  b.doc.budget = { usd: 2, max_rounds: 40, wallclock_min: 20 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  b.doc.result = { type: "text", description: "the Executor's solution, ending with \\boxed{} and 'Answer: X'" };
  return b.doc;
}

export const macm: TemplateInfo = {
  id: "paper-macm",
  name: "MACM (condition mining)",
  summary: "Thinker mines conditions · Judge verifies each and says when they suffice · Executor carries out the plan",
  build,
  paper: { title: "MACM: Utilizing a Multi-Agent System for Condition Mining in Solving Complex Mathematical Problems", authors: "Lei et al.", year: 2024, url: "https://arxiv.org/abs/2404.04735" },
  notes: {
    mapped: [
      "The Thinker, the Judge and the Executor are three model components, each with its role in its system prompt.",
      "The protocol is a function calling them with ctx.call: list the conditions and the objective; up to `rounds` times, the Thinker derives one new condition, the Judge verifies it (kept only if true) and then says whether the verified conditions suffice; the Thinker plans; the Executor carries the plan out.",
    ],
    differs: [
      "The paper's Executor runs code; here it computes in text (connect a sandbox and use a coding agent to restore that).",
      "The paper also votes over several complete attempts; this template makes one (set replicas on a copy, or compare with Agent Forest).",
    ],
  },
};
