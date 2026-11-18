// Multiagent debate: several agents answer, read each other's answers, and
// revise for a fixed number of rounds; the final answer is a vote.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

function build(): SystemDoc {
  const b = new Builder(
    "Multiagent debate",
    "Three agents answer the same question, then in each round read the others' answers and update their own; after two rounds the answers are put to a majority vote.",
  );
  b.node("asker", "human", 0, 60, { name: "Asker", role: "Poses the question", approves: false })
    .group("debate", 260, 40, {
      name: "Debate",
      // 2 rounds unless the run says otherwise: the paper's ablation is over the number of rounds
      iterate: { max_rounds: "{{vars.rounds ?? 2}}", until: null, feed: "input_and_output" },
      interface: { inputs: [port("question", "message")], outputs: [port("answers", "json")] },
    })
    .node("vote", "function", 560, 50, {
      name: "Majority vote",
      fn: { lang: "js", code: "const counts = {};\nfor (const a of input.answers ?? []) if (a.final) counts[a.final] = (counts[a.final] ?? 0) + 1;\nconst ranked = Object.entries(counts).sort((x, y) => y[1] - x[1]);\nreturn ranked.length ? `Final: ${ranked[0][0]}` : \"No debater gave an answer.\";" },
      interface: { inputs: [port("in", "json")], outputs: [port("out", "text")] },
    });
  const prompt = "Answer the question. If other agents' answers are given, use them as additional advice and give an updated answer. End with: Final: <answer>.";
  for (const [i, m] of ["sonnet", "sonnet", "sonnet"].entries()) {
    b.agent(`agent_${i + 1}`, 0, (i - 1) * 140, { name: `Debater ${i + 1}`, role: "Answers and revises", model: m, harness: { ...native(), loop: "single_shot", instructions: prompt } }, "debate");
  }
  b.node("collect", "function", 340, 0, {
    name: "Collect answers",
    join: "all",
    fn: { lang: "js", code: "// all three answers of this round; without a Final: line, the last line is the answer\nconst finalOf = (t) => ((String(t).match(/Final:\\s*(.*)/) ?? [])[1] ?? String(t).trim().split(\"\\n\").pop() ?? \"\").trim();\nreturn { answers: Object.values(input).map((t) => ({ text: t, final: finalOf(t) })) };" },
    interface: { inputs: [port("a1", "text", { required: true }), port("a2", "text", { required: true }), port("a3", "text", { required: true })], outputs: [port("out", "json")] },
  }, "debate");
  for (let i = 1; i <= 3; i++) b.edge("debate", `agent_${i}`, "message").edge(`agent_${i}`, "collect", "message", { target_port: `a${i}` });
  b.edge("collect", "debate", "message")
    .edge("asker", "debate", "message", { label: "Question" })
    .edge("debate", "vote", "message")
    .edge("vote", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 20, wallclock_min: 10 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

export const debate: TemplateInfo = {
  id: "paper-debate",
  name: "Multiagent debate",
  summary: "parallel answers · rounds of revision · majority vote",
  build,
  paper: { title: "Improving Factuality and Reasoning in Language Models through Multiagent Debate", authors: "Du et al.", year: 2023, url: "https://arxiv.org/abs/2305.14325" },
  notes: {
    mapped: [
      "A Group holds the debaters; its iteration (2 rounds, feeding the question plus the collected answers back in) is the debate.",
      "A Function node with join = all waits for every debater before passing the round on; another Function takes the majority vote.",
    ],
    differs: [
      "The paper varies the number of rounds and of agents. Rounds are the run variable rounds (2 when unset), so an evaluation can sweep them; the number of debaters is fixed at three here.",
    ],
  },
};
