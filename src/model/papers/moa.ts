// Mixture-of-Agents: layers of proposer models, each layer seeing all answers
// of the previous one, and a final aggregator.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const AGGREGATE =
  "You have been provided with a set of responses from various models to the latest user query. Synthesize these responses into a single, high-quality response. Critically evaluate the information, recognising that some of it may be biased or incorrect.\n\nResponses:\n{{input.responses}}\n\nQuery: {{input.query}}";

function build(): SystemDoc {
  const b = new Builder(
    "Mixture-of-Agents",
    "Layered model calls, no agents: three proposers answer, a second layer of three proposers each refines using all first-layer answers, and an aggregator synthesises the final response.",
  );
  const models = ["opus", "gpt", "local"];
  b.node("user", "human", 0, 160, { name: "User", role: "Asks", approves: false });
  const join = (id: string, x: number, name: string) =>
    b.node(id, "function", x, 150, {
      name,
      join: "all",
      fn: { lang: "js", code: "return { query: ctx.vars.query, responses: Object.values(input).map((r, i) => `${i + 1}. ${r}`).join('\\n\\n') };" },
      interface: { inputs: models.map((_, i) => port(`p${i + 1}`, "text", { required: true })), outputs: [port("out", "json")] },
    });
  for (const [layer, x] of [[1, 260], [2, 820]] as const) {
    models.forEach((m, i) =>
      b.node(`l${layer}_${i + 1}`, "model", x, i * 150, {
        name: `Layer ${layer} · ${m}`,
        model: m,
        prompt: layer === 1 ? "{{input}}" : AGGREGATE,
        interface: { inputs: [port("in", layer === 1 ? "text" : "json")], outputs: [port("out", "text")] },
      }),
    );
  }
  join("join1", 560, "Layer 1 answers");
  join("join2", 1120, "Layer 2 answers");
  b.node("aggregator", "model", 1380, 150, { name: "Aggregator", model: "opus", prompt: AGGREGATE, interface: { inputs: [port("in", "json")], outputs: [port("out", "text")] } });
  for (let i = 1; i <= 3; i++) {
    b.edge("user", `l1_${i}`, "message", { label: i === 2 ? "Query" : undefined })
      .edge(`l1_${i}`, "join1", "message", { target_port: `p${i}` })
      .edge("join1", `l2_${i}`, "message")
      .edge(`l2_${i}`, "join2", "message", { target_port: `p${i}` });
  }
  b.edge("join2", "aggregator", "message").edge("aggregator", "user", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 20, wallclock_min: 5 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

export const moa: TemplateInfo = {
  id: "paper-moa",
  name: "Mixture-of-Agents",
  summary: "layered proposers · aggregate-and-synthesize · no agents",
  build,
  paper: { title: "Mixture-of-Agents Enhances Large Language Model Capabilities", authors: "Wang et al.", year: 2024, url: "https://arxiv.org/abs/2406.04692" },
  notes: {
    mapped: [
      "Each proposer is a Model call node (one call, no loop); a Function with join = all gathers a layer's answers for the next layer.",
      "Second-layer proposers and the aggregator use the paper's aggregate-and-synthesize prompt.",
    ],
    differs: [
      "Two proposer layers of three models here; the paper's default uses more layers and six open-source proposers. Add layers by copying a layer and its join.",
    ],
  },
};
