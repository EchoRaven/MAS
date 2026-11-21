// Universal Self-Consistency: sample several answers, then ask the model which one is the most consistent with the
// others, and return that answer as it is. Self-consistency votes on extracted final answers, which open-ended text
// does not have; USC lets the model judge the consensus instead. It selects, it does not rewrite (unlike
// Mixture-of-Agents, which merges drafts into a new answer). The loop is a function calling the two roles.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const USC = `const question = String(input?.text ?? input ?? "");
const n = Math.max(2, Math.min(10, Number(ctx.vars.samples ?? 5)));
const samples = [];
for (let i = 0; i < n; i++) samples.push(String(await ctx.call("Sampler", question)));
const listed = samples.map((s, i) => "Response " + (i + 1) + ":\\n" + s).join("\\n\\n");
const verdict = String(await ctx.call("Selector", "I have generated the following responses to the question: " + question + "\\n\\n" + listed + "\\n\\nEvaluate these responses. Select the most consistent response based on majority consensus. Start your answer with \\"The most consistent response is Response X\\" (without quotes)."));
const m = /most consistent response is response\\s*(\\d+)/i.exec(verdict);
const k = m ? Number(m[1]) : 1;
const pick = k >= 1 && k <= n ? k : 1;
ctx.log("selected response " + pick + " of " + n + (m ? "" : " (no selection found: the first)"));
return samples[pick - 1];`;

function build(): SystemDoc {
  const b = new Builder(
    "Universal Self-Consistency",
    "The model answers several times (the run variable samples, 5 unless set; temperature 0.8); then it is shown all the answers and asked which one is the most consistent with the others, and that answer is returned as it is. Self-consistency for open-ended answers, where there is no final answer to vote on.",
  );
  b.node("asker", "human", 0, 160, { name: "Asker", role: "Asks", approves: false }).node("usc", "function", 280, 160, {
    name: "USC",
    join: "any",
    fn: { lang: "js", code: USC, timeout_ms: 1_200_000 },
    interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] },
  });
  b.node("sampler", "model", 580, 60, { name: "Sampler", model: "sonnet", system_prompt: "", prompt: "{{input}}", temperature: 0.8, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
  b.node("selector", "model", 580, 260, { name: "Selector", model: "sonnet", system_prompt: "", prompt: "{{input}}", temperature: null, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
  b.edge("asker", "usc", "message", { label: "Question" })
    .edge("usc", "sampler", "call", { label: "Sample" })
    .edge("usc", "selector", "call", { label: "Pick the most consistent" })
    .edge("usc", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 20, wallclock_min: 20 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

export const usc: TemplateInfo = {
  id: "paper-usc",
  name: "Universal Self-Consistency",
  summary: "several samples · the model picks the most consistent · returned as it is",
  build,
  paper: { title: "Universal Self-Consistency for Large Language Model Generation", authors: "Chen et al.", year: 2023, url: "https://arxiv.org/abs/2311.17311" },
  notes: {
    mapped: [
      "A function samples the same model several times (the run variable samples, 5 by default, at temperature 0.8) through a call edge, then asks the selector, the same model, which response is the most consistent, with the paper's form 'The most consistent response is Response X'.",
      "The chosen sample is returned unchanged: USC selects, where Mixture-of-Agents rewrites.",
    ],
    differs: [
      "The paper samples in parallel; the function here samples one after another, which takes longer and costs the same.",
      "If the selector names no response, the first sample is returned and the run log says so.",
    ],
  },
};
