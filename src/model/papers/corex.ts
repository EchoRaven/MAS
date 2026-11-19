// Corex, Retrieve mode: several candidates reason about the question on
// their own; a retriever reads every chain and picks the one whose reasoning
// is most faithful, and its answer is the answer. Selection by a reader, not
// a majority vote: the comparison self-consistency invites.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const RETRIEVE = `You are the retriever. Below are several independent attempts at the same question, each with its reasoning. Check each chain step by step for errors in logic and arithmetic; do not count how many agree, judge how faithful each is. Pick the attempt whose reasoning is correct (or most nearly so), say in a sentence why, and give its answer.

When the question asks for one value, end with a last line 'Answer: X' giving only it.

Question:
{{vars.input}}

Attempts:
{{#each input}}
## Attempt {{@index}}
{{this}}

{{/each}}`;

function build(): SystemDoc {
  const b = new Builder(
    "Corex (Retrieve)",
    "Several candidates reason about the question independently (one model component sampled n times, a run variable, 5 by default); a retriever reads every chain and picks the most faithful one. Selection by reading the reasoning, not by counting answers.",
  );
  b.node("asker", "human", 0, 60, { name: "Asker", role: "Poses the question", approves: false })
    .node("candidates", "model", 260, 40, {
      name: "Candidates",
      model: "sonnet",
      system_prompt: "",
      prompt: "Solve the question step by step, showing your reasoning, and end with 'Final: <answer>'.\n\n{{input}}",
      temperature: 0.8,
      max_tokens: null,
      replicas: "{{vars.n ?? 5}}",
      interface: { inputs: [port("in", "text")], outputs: [port("out", "json")] },
    })
    .node("retriever", "model", 560, 40, { name: "Retriever", model: "sonnet", system_prompt: "", prompt: RETRIEVE, temperature: null, max_tokens: null, interface: { inputs: [port("in", "json")], outputs: [port("out", "text")] } })
    .edge("asker", "candidates", "message", { label: "Question" })
    .edge("candidates", "retriever", "message", { label: "Chains" })
    .edge("retriever", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 2, max_rounds: 10, wallclock_min: 15 };
  b.doc.result = { type: "text", description: "the retriever's choice, ending with 'Answer: X'" };
  return b.doc;
}

export const corex: TemplateInfo = {
  id: "paper-corex",
  name: "Corex (Retrieve)",
  summary: "n independent chains · a retriever picks the most faithful · selection, not voting",
  build,
  paper: { title: "Corex: Pushing the Boundaries of Complex Reasoning through Multi-Model Collaboration", authors: "Sun et al.", year: 2023, url: "https://arxiv.org/abs/2310.00280" },
  notes: {
    mapped: [
      "The candidates are one model component sampled n times (replicas, the run variable n, 5 by default), each reasoning on its own: the paper's independent chains.",
      "The retriever is a model call that reads every chain with the question and picks the most faithful, by checking the reasoning rather than counting answers.",
    ],
    differs: [
      "Corex has three modes (Discuss, Review, Retrieve); this template is Retrieve. Discuss is close to Multiagent Debate, and Review to the reviewer loops of AgentVerse.",
      "The paper's candidates can be different models; here one model sampled n times (map the model to others per evaluation to mix them).",
    ],
  },
};
