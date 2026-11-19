// Solo Performance Prompting: one model, one call, several personas. The
// model names the participants the task needs, lets them work on it in turn
// (each criticising the others), revises until they agree, and gives the
// final answer: a multi-agent discussion simulated inside a single response.
// It is the control for real multi-agent discussion: what do separate agents
// add over one model playing all of them?
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const SPP = `When faced with a task, begin by identifying the participants who will contribute to solving it. Then start a collaboration among them: an AI Assistant leads, and each participant (experts in what the task needs, and a critic) gives what they know, points out mistakes in what the others said, and proposes fixes. Go through several rounds until the participants agree on a solution, then write the final answer.

Format:
Participants: AI Assistant (you); <the others>
Start collaboration!
<the discussion, each turn starting with the participant's name>
Finish collaboration!
Final answer: <the answer>

When the task asks for one value, end with a last line 'Answer: X' giving only it.

Task: {{input}}`;

function build(): SystemDoc {
  const b = new Builder(
    "Solo Performance Prompting",
    "One model in one call names the personas a task needs, lets them work on it and criticise each other until they agree, and gives the final answer: a multi-agent discussion simulated in a single response, the control for real agents.",
  );
  b.node("asker", "human", 0, 60, { name: "Asker", role: "Poses the task", approves: false })
    .node("solo", "model", 300, 40, { name: "Solo performer", model: "sonnet", system_prompt: "", prompt: SPP, temperature: null, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } })
    .edge("asker", "solo", "message", { label: "Task" })
    .edge("solo", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 5, wallclock_min: 10 };
  b.doc.result = { type: "text", description: "the discussion and its final answer, ending with 'Answer: X'" };
  return b.doc;
}

export const spp: TemplateInfo = {
  id: "paper-spp",
  name: "Solo Performance Prompting",
  summary: "one model, one call · personas named per task · simulated discussion · final answer",
  build,
  paper: { title: "Unleashing the Emergent Cognitive Synergy in Large Language Models: A Task-Solving Agent through Multi-Persona Self-Collaboration", authors: "Wang et al.", year: 2024, url: "https://arxiv.org/abs/2307.05300" },
  notes: {
    mapped: [
      "A single model component: the whole method is one prompt, so the whole system is one call, with no agents.",
      "The prompt follows the paper's: identify participants, start the collaboration, let each persona contribute and criticise, revise until agreement, give the final answer.",
    ],
    differs: [
      "The paper's prompt carries two worked demonstrations (a 24-game and a poem); here the instruction alone, to keep the call short. Add them to the prompt to match the paper exactly.",
    ],
  },
};
