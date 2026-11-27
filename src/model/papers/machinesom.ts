// Exploring Collaboration Mechanisms for LLM Agents: A Social Psychology View (Zhang et al., "MachineSoM"): a society
// of three agents, each overconfident or easygoing, answers over three rounds; in each round every agent either
// debates (reads the others' last answers) or reflects (reads only its own). The paper's finding: strategies that
// open with debate do better than those that open with reflection, and traits matter less than the strategy. The
// rounds, what each agent sees and the vote are code; every answer is an agent's.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

const SOCIETY = String.raw`const task = String(ctx.task ?? "");
// traits: one letter per agent, O overconfident or E easygoing (the paper's four societies: OOO, OOE, OEE, EEE)
const traits = String(ctx.vars.traits ?? "EEE").toUpperCase().replace(/[^OE]/g, "").padEnd(3, "E").slice(0, 3).split("");
// strategy: one letter per round after the first answer, d debate or r reflect (the paper's eight: ddd … rrr)
const strategy = String(ctx.vars.strategy ?? "ddd").toLowerCase().replace(/[^dr]/g, "").split("");
const TRAIT = {
  O: "You are confident in your own reasoning and rarely change your answer because others disagree; you change it only when shown a clear error.",
  E: "You are easygoing and open to others' views; you weigh their reasoning fairly and change your answer when theirs is better.",
};
const answerOf = (t) => { const m = [...String(t).matchAll(/answer\s*[:：]\s*\**\s*([^\n*]+)/gi)]; return m.length ? m[m.length - 1][1].trim().replace(/[.\s]+$/, "") : ""; };
const norm = (a) => { const t = String(a).toLowerCase().replace(/\\boxed\{([^}]*)\}/g, "$1").replace(/[$\s]/g, ""); const c = t.match(/^\(?([a-e])(\)|\.|:|$)/); return c ? c[1] : t; };
const ask = (i, text) => tools.call_agent("Agent " + (i + 1), TRAIT[traits[i]] + "\n\n" + text + "\n\nEnd with a last line 'Answer: <your answer>'.");
let replies = [];
for (let i = 0; i < 3; i++) replies.push(await ask(i, task));
let answers = replies.map(answerOf);
let changed = 0;
for (const [k, s] of strategy.entries()) {
  const next = [];
  for (let i = 0; i < 3; i++) {
    const mine = "Your previous answer:\n" + String(replies[i]).slice(-1500);
    const prompt = s === "d"
      ? task + "\n\n" + mine + "\n\nThe other agents' answers:\n" + [0, 1, 2].filter((j) => j !== i).map((j) => "Agent " + (j + 1) + ":\n" + String(replies[j]).slice(-1500)).join("\n\n") + "\n\nUsing their reasoning as further advice, give your updated answer."
      : task + "\n\n" + mine + "\n\nReflect on your answer: check it step by step and give your updated answer.";
    next.push(await ask(i, prompt));
  }
  const nextAnswers = next.map(answerOf);
  changed += nextAnswers.filter((a, i) => norm(a) !== norm(answers[i])).length;
  emit("round " + (k + 1) + " (" + (s === "d" ? "debate" : "reflect") + ")", nextAnswers.join(" | "));
  replies = next;
  answers = nextAnswers;
}
// the society's answer: the majority of the last round (the first agent's on a three-way split)
const counts = new Map();
for (const a of answers) counts.set(norm(a), (counts.get(norm(a)) ?? 0) + 1);
const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
const final = answers.find((a) => norm(a) === top[0]) ?? answers[0];
metric("agents agreeing at the end", top[1]);
metric("answers changed", changed);
return "Society " + traits.join("") + ", strategy " + (strategy.join("") || "none") + ". Last answers: " + answers.join(" | ") + "\nAnswer: " + final;`;

function build(): SystemDoc {
  const b = new Builder(
    "MachineSoM: a society of agents",
    "Three agents, each overconfident or easygoing (run variable traits, e.g. OEE), answer over three rounds; each round they debate (read the others) or reflect (read only their own), set by the run variable strategy (ddd, drr, rrr …). The majority of the last round is the answer.",
  );
  b.node("asker", "human", 0, 160, { name: "Asker", role: "Gives the question", approves: false })
    .agent("society", 280, 140, { name: "Society", role: "Runs the rounds and the vote", model: "haiku", harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: SOCIETY }, instructions: "Run the society." } })
    .edge("asker", "society", "message", { label: "Question" })
    .edge("society", "asker", "message", { label: "Answer" });
  for (const i of [1, 2, 3]) {
    b.agent(`agent_${i}`, 620, (i - 1) * 140, {
      name: `Agent ${i}`,
      role: "Answers, debates or reflects",
      model: "haiku",
      harness: { ...native(), loop: "single_shot", instructions: "Answer the question. Think step by step." },
      // each prompt carries what the round lets it see: no other memory
      context: { budget_total: 20000, history_strategy: "window", history_window: 2, mask_tool_output: false },
    });
    b.edge("society", `agent_${i}`, "call");
  }
  b.doc.budget = { usd: 0.3, max_rounds: 40, wallclock_min: 15 };
  return b.doc;
}

export const machinesom: TemplateInfo = {
  id: "paper-machinesom",
  name: "MachineSoM: a society of agents",
  summary: "three agents with traits · each round debate or reflect · the strategy's order matters?",
  build,
  paper: { title: "Exploring Collaboration Mechanisms for LLM Agents: A Social Psychology View", authors: "Zhang et al.", year: 2024, url: "https://arxiv.org/abs/2310.02124" },
  notes: {
    mapped: [
      "A custom loop runs the society: three first answers, then one round per letter of the run variable strategy, d (debate: the others' last answers) or r (reflect: only its own).",
      "The run variable traits gives each agent a trait, O overconfident or E easygoing, as a line before every prompt; the paper's four societies are OOO, OOE, OEE and EEE.",
      "The answer is the majority of the last round; the metrics are how many agents agree at the end and how many answers changed over the rounds.",
    ],
    differs: [
      "The paper runs MMLU, MATH and chess move validity with gpt-3.5 and others; here any dataset with an 'Answer:' line, one model for all three agents.",
      "The paper's traits and prompts are its own; these are one sentence each.",
    ],
  },
};
