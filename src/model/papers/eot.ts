// Exchange-of-Thought: three agents reason about a question and, each round,
// see some of the others' reasoning, chosen by a communication paradigm.
// Memory: everyone sees everyone. Report: A is a hub; B and C see only A.
// Relay: a ring, each sees the one before it. Debate: B and C argue with
// each other, and A sees both. Each agent's answer carries a confidence from
// how steady its answers have been; the exchange stops once all three agree.
import { Builder, native, type TemplateInfo } from "../builder";
import { autoLayout } from "../layout";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const AGENTS = ["a", "b", "c"] as const;

// who each agent sees, per paradigm (pick one with the run variable "paradigm"; Memory by default)
const SEES = {
  memory: { a: ["b", "c"], b: ["a", "c"], c: ["a", "b"] },
  report: { a: ["b", "c"], b: ["a"], c: ["a"] },
  relay: { a: ["c"], b: ["a"], c: ["b"] },
  debate: { a: ["b", "c"], b: ["c"], c: ["b"] },
};

// round 1: everyone gets the question; later rounds: each agent gets the question and only what its paradigm lets it see
const DISPATCH = `const AGENTS = ${JSON.stringify(AGENTS)};
if (input && typeof input === "object" && input.views) return Object.fromEntries(AGENTS.map((a) => [a, input.views[a]]));
const question = String(input?.text ?? input);
ctx.vars.question = question;
ctx.vars.history = { a: [], b: [], c: [] };
return Object.fromEntries(AGENTS.map((a) => [a, question]));`;

// after a round: confidence from each agent's own consistency, then what each sees next
const EXCHANGE = `const SEES = ${JSON.stringify(SEES)};
const NAMES = { a: "Agent A", b: "Agent B", c: "Agent C" };
const paradigm = SEES[ctx.vars.paradigm] ? ctx.vars.paradigm : "memory";
const norm = (s) => /\\d\\s*[-+*/]\\s*[\\d(]|\\)\\s*[-+*/]/.test(String(s)) ? String(s).replace(/\\s+/g, "") : String(s).toLowerCase().replace(/(\\d),(?=\\d{3})/g, "$1").replace(/[^a-z0-9./-]+/g, " ").trim().replace(/\\.+$/, "");
const finalOf = (t) => ((String(t).match(/Final:\\s*(.+)/) ?? [])[1] ?? "").replace(/\\*\\*(.+?)\\*\\*/g, "$1").replace(/^\\*+|\\*+$/g, "").trim();
const h = ctx.vars.history;
const now = {};
for (const a of Object.keys(input)) {
  now[a] = { text: String(input[a]), answer: finalOf(input[a]) };
  h[a].push(norm(now[a].answer));
}
// confidence: how often an agent's answer has matched its latest one (the paper's confidence evaluation)
const conf = (a) => h[a].filter((x) => x === h[a][h[a].length - 1]).length / h[a].length;
const round = h.a.length;
const answers = Object.keys(now).map((a) => norm(now[a].answer));
const agreed = answers.every((x) => x && x === answers[0]);
if (agreed) return { role: "assistant", text: "Paradigm: " + paradigm + ". All three agree after round " + round + ".\\nFinal: " + now.a.answer, done: true };
const views = {};
for (const a of Object.keys(now)) {
  const seen = SEES[paradigm][a].map((o) => "## " + NAMES[o] + " (confidence " + conf(o).toFixed(2) + ")\\n" + now[o].text).join("\\n\\n");
  views[a] = ctx.vars.question + "\\n\\nYour previous answer:\\n" + now[a].text + "\\n\\nWhat you can see of the others this round:\\n" + seen;
}
// if the rounds run out, the answer is the vote weighted by confidence
const score = {};
const shown = {};
for (const a of Object.keys(now)) if (now[a].answer) { const k = norm(now[a].answer); score[k] = (score[k] ?? 0) + conf(a); shown[k] ??= now[a].answer; }
const best = Object.entries(score).sort((x, y) => y[1] - x[1])[0];
return { role: "assistant", text: "Paradigm: " + paradigm + ". No agreement after round " + round + "; vote weighted by confidence.\\nFinal: " + (best ? shown[best[0]] : "none"), views, done: false };`;

const AGENT = `Solve the question step by step. If you are shown other agents' reasoning, weigh it by its confidence, look for mistakes in theirs and in yours, and give your own updated answer.
End with one line: Final: <the answer alone>`;

function build(): SystemDoc {
  const b = new Builder(
    "Exchange-of-Thought",
    "Three agents solve a question and exchange their reasoning between rounds. Who sees whom is set by the communication paradigm (run variable \"paradigm\": memory, report, relay or debate; memory by default). Each answer carries a confidence from how steady the agent has been. The exchange stops when all three agree, or after four rounds with a confidence-weighted vote.",
  );
  b.node("user", "human", 0, 0, { name: "User", role: "Asks a reasoning question", approves: false })
    .group("exchange", 0, 0, {
      name: "Exchange",
      iterate: { max_rounds: 4, until: "output.done", feed: "output" },
      interface: { inputs: [port("question", "message")], outputs: [port("answer", "message")] },
    })
    .node("dispatch", "function", 0, 0, { name: "Send each agent its view", fn: { lang: "js", code: DISPATCH }, interface: { inputs: [port("in", "message")], outputs: AGENTS.map((a) => port(a, "text")) } }, "exchange")
    .node("exchange_fn", "function", 0, 0, {
      name: "Exchange by paradigm",
      join: "all",
      fn: { lang: "js", code: EXCHANGE },
      interface: { inputs: AGENTS.map((a) => port(a, "text", { required: true })), outputs: [port("out", "message")] },
    }, "exchange");
  for (const a of AGENTS) {
    b.agent(a, 0, 0, { name: `Agent ${a.toUpperCase()}`, role: "Reasons and revises", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: AGENT } }, "exchange");
    b.edge("dispatch", a, "message", { source_port: a }).edge(a, "exchange_fn", "message", { target_port: a });
  }
  b.edge("user", "exchange", "message", { label: "Question" })
    .edge("exchange", "dispatch", "message")
    .edge("exchange_fn", "exchange", "message")
    .edge("exchange", "user", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 40, wallclock_min: 10 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return autoLayout(b.doc);
}

export const eot: TemplateInfo = {
  id: "paper-eot",
  name: "Exchange-of-Thought",
  summary: "four communication paradigms in one system · confidence from consistency · stop at agreement",
  build,
  paper: { title: "Exchange-of-Thought: Enhancing Large Language Model Capabilities through Cross-Model Communication", authors: "Yin et al.", year: 2023, url: "https://arxiv.org/abs/2312.01823" },
  notes: {
    mapped: [
      "The paper's four communication paradigms are one system: a function decides, each round, what each agent sees of the others. Memory (all see all), Report (A is the hub), Relay (a ring) and Debate (B and C argue, A sees both) differ only in that table, chosen with the run variable \"paradigm\".",
      "Confidence evaluation follows the paper: an agent's confidence is how often its past answers match its latest one, and the others see it next to its reasoning.",
      "The exchange is a Group that iterates until all three agree (the paper's consistent-output termination), at most 4 rounds; if they never agree, the answer is a vote weighted by confidence.",
    ],
    differs: [
      "The paper uses different models for the agents; set each agent's model to compare.",
      "In the paper's Debate paradigm the two debaters' result goes up to the third node; here the third agent sees both every round and takes part in the agreement check like the others.",
    ],
  },
};
