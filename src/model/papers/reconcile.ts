// ReConcile: a round table of agents on different models. Each answers with
// an explanation and a confidence; in each discussion round they see the
// answers grouped, with everyone's reasons and confidence, and may change
// their minds. Discussion ends at consensus (or after three rounds), and the
// result is a vote weighted by recalibrated confidence.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const SEATS = [
  ["claude", "Claude", "sonnet"],
  ["gpt", "GPT", "gpt"],
  ["gemini", "Gemini", "gemini"],
] as const;

// a round of the table: parse each seat's answer and confidence, group equal answers,
// and write the discussion the seats read next round
const COLLECT = `const NAMES = ${JSON.stringify(Object.fromEntries(SEATS.map(([id, name]) => [id, name])))};
const norm = (a) => String(a).toLowerCase().replace(/[^a-z0-9.\\-]/g, "");
const parse = (t) => {
  const s = String(t);
  const answer = ((s.match(/Answer:\\s*(.+)/i) ?? [])[1] ?? "").trim().replace(/[.*]+$/, "");
  const conf = Number((s.match(/Confidence:\\s*([\\d.]+)/i) ?? [])[1]);
  const explanation = s.replace(/\\n?\\s*Answer:[\\s\\S]*$/i, "").trim();
  return { answer, confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5, explanation };
};
const round = (ctx.vars.round = (ctx.vars.round ?? 0) + 1);
const answers = Object.entries(input).map(([seat, t]) => ({ seat, name: NAMES[seat] ?? seat, ...parse(t) }));
const groups = {};
for (const a of answers) (groups[norm(a.answer)] ??= []).push(a);
const lines = [];
for (const members of Object.values(groups)) {
  lines.push("Answer \\"" + members[0].answer + "\\", given by " + members.map((m) => m.name + " (confidence " + m.confidence + ")").join(", ") + ":");
  for (const m of members) lines.push("  " + m.name + "'s reasoning: " + m.explanation.slice(0, 700).replace(/\\s+/g, " "));
}
const consensus = Object.keys(groups).length === 1 && answers.every((a) => a.answer);
return { role: "assistant", text: lines.join("\\n"), consensus, round, answers };`;

// the paper's confidence recalibration, then a weighted vote
const VOTE = `const f = (p) => (p >= 1 ? 1 : p >= 0.9 ? 0.8 : p >= 0.8 ? 0.5 : p > 0.6 ? 0.3 : 0.1);
const norm = (a) => String(a).toLowerCase().replace(/[^a-z0-9.\\-]/g, "");
const score = {}, shown = {};
for (const a of input.answers ?? []) {
  const k = norm(a.answer);
  score[k] = (score[k] ?? 0) + f(a.confidence);
  shown[k] ??= a.answer;
}
const ranked = Object.entries(score).sort((x, y) => y[1] - x[1]);
if (!ranked.length) return "No answers were given.";
const tally = ranked.map(([k, s]) => shown[k] + " " + s.toFixed(1)).join(", ");
return "Answer: " + shown[ranked[0][0]] + "\\n\\n" + (input.consensus ? "Consensus in round " + input.round + "." : "No consensus after " + input.round + " rounds.") + " Weighted vote: " + tally + ".";`;

const PROMPT = `You sit at a round table with agents built on other models. Think step by step, then give your answer.
If the other agents' answers are shown, read their reasoning and confidence carefully. Change your answer if their arguments convince you; keep it if yours is better, and say why.
End with exactly two lines:
Answer: <the answer alone — a number, or at most a few words>
Confidence: <your confidence that it is right, from 0.0 to 1.0>`;

function build(): SystemDoc {
  const b = new Builder(
    "ReConcile",
    "A round-table conference between agents on different models. Each gives an answer with its reasoning and a confidence; each round they see every answer grouped with the others' reasons and confidence, and revise. Discussion stops at consensus or after three discussion rounds, and the answer is a vote weighted by recalibrated confidence.",
  );
  b.node("asker", "human", 0, 0, { name: "Asker", role: "Poses a reasoning question", approves: false })
    .group("table", 340, 0, {
      name: "Round table",
      iterate: { max_rounds: 4, until: "output.consensus", feed: "input_and_output" },
      interface: { inputs: [port("question", "message")], outputs: [port("discussion", "message")] },
    })
    .node("vote", "function", 680, 0, {
      name: "Confidence-weighted vote",
      fn: { lang: "js", code: VOTE },
      interface: { inputs: [port("in", "message")], outputs: [port("out", "text")] },
    })
    .node("collect", "function", 340, 0, {
      name: "Group the answers",
      join: "all",
      fn: { lang: "js", code: COLLECT },
      interface: { inputs: SEATS.map(([id]) => port(id, "text", { required: true })), outputs: [port("out", "message")] },
    }, "table");
  SEATS.forEach(([id, name, model], i) => {
    b.agent(id, 0, (i - 1) * 150, { name, role: `Round-table seat on ${name}`, model, harness: { ...native(), loop: "single_shot", instructions: PROMPT } }, "table");
    b.edge("table", id, "message").edge(id, "collect", "message", { target_port: id });
  });
  b.edge("collect", "table", "message")
    .edge("asker", "table", "message", { label: "Question" })
    .edge("table", "vote", "message")
    .edge("vote", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 30, wallclock_min: 10 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

export const reconcile: TemplateInfo = {
  id: "paper-reconcile",
  name: "ReConcile",
  summary: "round table of different models · confidence · grouped answers · consensus stop · weighted vote",
  build,
  paper: { title: "ReConcile: Round-Table Conference Improves Reasoning via Consensus among Diverse LLMs", authors: "Chen et al.", year: 2023, url: "https://arxiv.org/abs/2309.13007" },
  notes: {
    mapped: [
      "Three seats, each on a different model (Claude, GPT, Gemini), as the paper's point is diversity across model families.",
      "A Group is the table. Its iteration feeds the question plus the grouped discussion back in, and stops as soon as the collect function reports consensus (until: output.consensus), or after the initial round and three discussion rounds.",
      "The collect function (join = all) parses each seat's answer and confidence, groups equal answers, and writes the discussion: each answer with who gave it, their confidence, and their reasoning.",
      "A vote function applies the paper's recalibration (1.0 → 1.0, ≥0.9 → 0.8, ≥0.8 → 0.5, >0.6 → 0.3, else 0.1) and takes the confidence-weighted majority.",
    ],
    differs: [
      "The paper also shows each agent convincing human explanations that corrected other agents; this needs a labelled set, so it is left out. Put such examples in the seats' instructions to add it.",
      "With only one provider's key, every seat can run on the same model; the structure is the same but the diversity is gone.",
    ],
  },
};
