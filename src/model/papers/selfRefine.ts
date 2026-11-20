// Self-Refine: one model answers, then critiques its own answer and revises
// it, until the critique finds nothing to fix or a round limit. Not a team:
// the control for "does a second voice help?", since every critic-and-
// reviser system here (AgentVerse, MapCoder, Reflexion) adds this loop to
// something else. The loop is a function calling the two roles with ctx.call.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const LOOP = `const question = String(input?.text ?? input ?? "");
const rounds = Math.max(0, Math.min(6, Math.floor(Number(ctx.vars.rounds ?? 3))));
let answer = await ctx.call("Writer", "Solve the question step by step and end with a last line 'Answer: X'.\\n\\nQuestion:\\n" + question);
for (let r = 0; r < rounds; r++) {
  const feedback = await ctx.call("Critic", "Question:\\n" + question + "\\n\\nAn answer:\\n" + answer + "\\n\\nCheck the answer step by step, redoing every computation. List each concrete mistake and how to fix it. If there is none, reply with exactly: NO ISSUES");
  if (/^\\W*no issues\\W*$/i.test(feedback.trim()) || /\\bNO ISSUES\\b/.test(feedback) && feedback.length < 200) break;
  answer = await ctx.call("Writer", "Question:\\n" + question + "\\n\\nYour previous answer:\\n" + answer + "\\n\\nFeedback on it:\\n" + feedback + "\\n\\nWrite the corrected solution step by step, using the feedback where it is right, and end with a last line 'Answer: X'.");
}
return answer;`;

function build(): SystemDoc {
  const b = new Builder(
    "Self-Refine",
    "One model answers, critiques its own answer and revises it, until the critique finds nothing to fix (at most `rounds`, a run variable, 3 by default). The Writer and the Critic are the same model with different instructions; the loop is a function calling them with ctx.call.",
  );
  const role = (id: string, name: string, x: number, y: number, system: string) =>
    b.node(id, "model", x, y, { name, model: "sonnet", system_prompt: system, prompt: "{{input}}", temperature: null, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
  b.node("asker", "human", 0, 100, { name: "Asker", role: "Poses the question", approves: false }).node("refine", "function", 280, 100, {
    name: "Refine loop",
    join: "any",
    fn: { lang: "js", code: LOOP, timeout_ms: 1_200_000 },
    interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] },
  });
  role("writer", "Writer", 580, 20, "You solve problems carefully and revise your solution when given feedback.");
  role("critic", "Critic", 580, 180, "You review a solution for mistakes: you redo each computation and check each step, and you say concretely what is wrong. You do not rewrite the solution.");
  b.edge("asker", "refine", "message", { label: "Question" })
    .edge("refine", "writer", "call", { label: "Answer, revise" })
    .edge("refine", "critic", "call", { label: "Feedback" })
    .edge("refine", "asker", "message", { label: "Answer" });
  // every call to a role is a turn: 1 + 2 per round
  b.doc.budget = { usd: 1, max_rounds: 20, wallclock_min: 15 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  b.doc.result = { type: "text", description: "the last revision, ending with 'Answer: X'" };
  return b.doc;
}

export const selfRefine: TemplateInfo = {
  id: "paper-self-refine",
  name: "Self-Refine",
  summary: "one model · answer, self-feedback, revise · until no issues",
  build,
  paper: { title: "Self-Refine: Iterative Refinement with Self-Feedback", authors: "Madaan et al.", year: 2023, url: "https://arxiv.org/abs/2303.17651" },
  notes: {
    mapped: [
      "The Writer and the Critic are two model components on the same model, as the paper's one model prompted three ways (generate, feedback, refine).",
      "The loop is a function calling them with ctx.call: answer; then up to `rounds` times, feedback, and a revision unless the feedback says NO ISSUES.",
    ],
    differs: [
      "The paper gives the model few-shot examples of feedback and refinement per task; here the instructions are zero-shot.",
      "The paper keeps the whole history of answers and feedback in the refine prompt; here the reviser sees the last answer and its feedback only.",
    ],
  },
};
