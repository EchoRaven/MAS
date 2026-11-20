// Multiagent debate: several agents answer, read each other's answers, and
// revise for a fixed number of rounds; the final answer is a vote.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];

/** The debate with n debaters (the template has three; the paper also varies the number of agents). */
/**
 * What debater i of n reads of the previous round in a ring: its own answer and its two neighbours' (Li et al.
 * 2024, sparse communication). The round's answers carry the port they came from (a1, a2, ...).
 */
function ringView(i: number, n: number): string {
  const keep = [i - 1, i, i + 1].map((k) => `a${((k - 1 + n) % n) + 1}`);
  return `const M = "\\n\\nAnswers from the previous round:\\n";
const t = String(input?.text ?? input ?? "");
const k = t.indexOf(M);
if (k < 0) return t;
let data;
try { data = JSON.parse(t.slice(k + M.length)); } catch { return t; }
const keep = ${JSON.stringify(keep)};
data.answers = (data.answers ?? []).filter((a) => keep.includes(a.from));
return t.slice(0, k) + "\\n\\nAnswers from the previous round (yours and your two neighbours'):\\n" + JSON.stringify(data);`;
}

export function debateWith(n = 3, topology: "full" | "ring" = "full"): SystemDoc {
  n = Math.max(2, Math.min(8, Math.floor(n)));
  const b = new Builder(
    n === 3 && topology === "full" ? "Multiagent debate" : `Multiagent debate (${n} debaters${topology === "ring" ? ", ring" : ""})`,
    `${WORDS[n]} agents answer the same question, then in each round read the others' answers and update their own; after two rounds the answers are put to a majority vote.`,
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
  for (let i = 0; i < n; i++) {
    const m = "sonnet";
    b.agent(`agent_${i + 1}`, 0, (i - (n - 1) / 2) * 140, { name: `Debater ${i + 1}`, role: "Answers and revises", model: m, harness: { ...native(), loop: "single_shot", instructions: prompt } }, "debate");
  }
  b.node("collect", "function", 340, 0, {
    name: "Collect answers",
    join: "all",
    // in a ring each answer says which debater gave it, so that each reads only its neighbours'
    fn: {
      lang: "js",
      code:
        "// every debater's answer of this round; without a Final: line, the last line is the answer\nconst finalOf = (t) => ((String(t).match(/Final:\\s*(.*)/) ?? [])[1] ?? String(t).trim().split(\"\\n\").pop() ?? \"\").trim();\n" +
        (topology === "ring"
          ? "return { answers: Object.entries(input).map(([from, t]) => ({ from, text: t, final: finalOf(t) })) };"
          : "return { answers: Object.values(input).map((t) => ({ text: t, final: finalOf(t) })) };"),
    },
    interface: { inputs: Array.from({ length: n }, (_, i) => port(`a${i + 1}`, "text", { required: true })), outputs: [port("out", "json")] },
  }, "debate");
  for (let i = 1; i <= n; i++) b.edge("debate", `agent_${i}`, "message", topology === "ring" ? { transform: { lang: "js", code: ringView(i, n) } } : {}).edge(`agent_${i}`, "collect", "message", { target_port: `a${i}` });
  b.edge("collect", "debate", "message")
    .edge("asker", "debate", "message", { label: "Question" })
    .edge("debate", "vote", "message")
    .edge("vote", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 20, wallclock_min: 10 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

const build = (): SystemDoc => debateWith(3);

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
      "The paper varies the number of rounds and of agents. Rounds are the run variable rounds (2 when unset), so an evaluation can sweep them; the number of debaters is three here (the builder, debateWith(n), makes 2 to 8).",
    ],
  },
};
