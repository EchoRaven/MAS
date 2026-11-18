// Agent Forest ("More Agents Is All You Need"): ask the same model N times
// and take the majority answer. The paper's point is that accuracy keeps
// rising with N, and that this simple ensemble is a strong baseline for, and
// can be combined with, more elaborate multi-agent methods.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const VOTE = `// the replies of every sample: the most common final answer wins
const finalOf = (t) => ((String(t).match(/Final:\\s*(.+)/) ?? [])[1] ?? String(t).trim().split("\\n").pop() ?? "").replace(/\\*+/g, "").trim();
const norm = (a) => a.toLowerCase().replace(/(\\d),(?=\\d{3})/g, "$1").replace(/[^a-z0-9./-]+/g, " ").trim().replace(/\\.+$/, "");
const counts = {}, shown = {};
for (const t of input) { const f = finalOf(t); if (!f) continue; const k = norm(f); counts[k] = (counts[k] ?? 0) + 1; shown[k] ??= f; }
const ranked = Object.entries(counts).sort((x, y) => y[1] - x[1]);
if (!ranked.length) return "No sample gave an answer.";
return "Votes (" + input.length + " samples): " + ranked.map(([k, n]) => shown[k] + " ×" + n).join(", ") + "\\nFinal: " + shown[ranked[0][0]];`;

function build(): SystemDoc {
  const b = new Builder(
    "Agent Forest",
    "The same model answers the question N times (10 unless the run variable n says otherwise), and the most common final answer wins. Accuracy rises with N; set n on the Evaluate page to sweep it.",
  );
  b.node("asker", "human", 0, 60, { name: "Asker", role: "Poses the question", approves: false })
    .node("samples", "model", 280, 40, {
      name: "Agents (N samples)",
      model: "sonnet",
      system_prompt: "",
      prompt: "{{input}}\n\nThink step by step, then end with one line: Final: <the answer alone>",
      temperature: 1,
      max_tokens: null,
      replicas: "{{vars.n ?? 10}}",
      interface: { inputs: [port("in", "text")], outputs: [port("out", "json")] },
    })
    .node("vote", "function", 560, 50, { name: "Majority vote", fn: { lang: "js", code: VOTE }, interface: { inputs: [port("in", "json")], outputs: [port("out", "text")] } })
    .edge("asker", "samples", "message", { label: "Question" })
    .edge("samples", "vote", "message", { label: "N replies" })
    .edge("vote", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 10, wallclock_min: 10 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

export const agentForest: TemplateInfo = {
  id: "paper-agent-forest",
  name: "Agent Forest",
  summary: "N samples of one model · majority vote · accuracy vs N",
  build,
  paper: { title: "More Agents Is All You Need", authors: "Li et al.", year: 2024, url: "https://arxiv.org/abs/2402.05120" },
  notes: {
    mapped: [
      "The sampling phase is one model component with replicas: it calls the model N times in parallel on the same question and sends the list of replies. N is the run variable n (10 when unset), so an evaluation can sweep N without changing the system.",
      "The voting phase is a function: the most common final answer, after normalising numbers and case.",
    ],
    differs: [
      "The paper votes by exact match for multiple choice and arithmetic, and by a similarity measure for open-ended generation (code, text); this template votes by normalised exact match only.",
      "The paper also combines sampling-and-voting with other methods (chain of thought, debate, reflexion); here it stands alone. Set replicas on another template's model component to combine them.",
    ],
  },
};
