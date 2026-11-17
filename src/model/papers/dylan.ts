// DyLAN: agents answer in layers; after each layer a ranker scores them, only
// the best go on to the next layer, the run stops early once two thirds agree,
// and each agent's contribution is summed into an importance score.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const AGENTS: [string, string, string][] = [
  ["a1", "Mathematician", "You reason with careful mathematics and check every step."],
  ["a2", "Programmer", "You reason by thinking through how a program would compute the answer."],
  ["a3", "Skeptic", "You look for the trap in the question before answering."],
  ["a4", "Generalist", "You answer plainly, from common knowledge and sense."],
];

// sends the question to the agents chosen for this layer (all of them in the first)
const DISPATCH = `// a ranking that chose no one would leave the next layer waiting forever: fall back to the full team
const chosen = ctx.vars.selected?.length ? ctx.vars.selected : ["a1", "a2", "a3", "a4"];
ctx.vars.expected = chosen.length;
ctx.vars.got = {};
ctx.vars.layer = (ctx.vars.layer ?? 0) + 1;
return Object.fromEntries(chosen.map((p) => [p, input]));`;

// waits for this layer's answers; two thirds agreeing ends the run early
const COLLECT = `ctx.vars.got = { ...(ctx.vars.got ?? {}), ...input };
if (Object.keys(ctx.vars.got).length < ctx.vars.expected) return null;
const got = ctx.vars.got;
ctx.vars.got = {};
ctx.vars.last = got;
// "The farmer has 9 sheep left." and "9" are the same answer: compare the number when there is one, else the words
const WORDS = { zero: 0, none: 0, one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const norm = (s) => {
  const w = s.toLowerCase().replace(/[^a-z0-9. -]/g, " ").replace(/\\s+/g, " ").trim();
  const n = w.match(/-?\\d+(?:\\.\\d+)?/);
  if (n) return n[0];
  const word = w.split(" ").find((x) => x in WORDS);
  return word ? String(WORDS[word]) : w;
};
const finals = Object.values(got).map((t) => norm(((String(t).match(/Final:\\s*(.+)/) ?? [])[1] ?? "").trim())).filter(Boolean);
const counts = {};
for (const f of finals) counts[f] = (counts[f] ?? 0) + 1;
const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
if (n >= Math.ceil((2 / 3) * Object.keys(got).length) && Object.keys(got).length > 1) {
  return { done: "CONSENSUS after layer " + ctx.vars.layer + ": " + top + "\\nAgent importance: " + JSON.stringify(ctx.vars.importance ?? {}) };
}
return { rank: got };`;

// keeps the two best-scored agents for the next layer and adds to each agent's importance
const SELECT = `const scores = input.scores ?? {};
ctx.vars.importance = ctx.vars.importance ?? {};
for (const [a, s] of Object.entries(scores)) ctx.vars.importance[a] = (ctx.vars.importance[a] ?? 0) + Number(s);
ctx.vars.selected = Object.entries(scores).sort((x, y) => Number(y[1]) - Number(x[1])).slice(0, 2).map(([a]) => a);
const best = ctx.vars.selected[0];
const answer = ((String(ctx.vars.last?.[best] ?? "").match(/Final:\\s*(.+)/) ?? [])[1] ?? "").trim();
return "Layer " + ctx.vars.layer + " answers, ranked:\\n" + (input.summary ?? "") + "\\nGoing on: " + ctx.vars.selected.join(", ") + "\\nBest answer so far (" + best + "): " + answer;`;

function build(): SystemDoc {
  const b = new Builder(
    "DyLAN",
    "Four agents with different ways of reasoning answer in layers. After each layer a ranker scores the answers and only the two best agents go on to the next layer; if two thirds already agree, the run stops early. Every ranking adds to each agent's importance score, which says who actually helped.",
  );
  const ins = AGENTS.map(([id]) => port(id, "text"));
  b.node("asker", "human", 0, 120, { name: "Asker", role: "Poses the question", approves: false })
    .group("network", 260, 80, {
      name: "Agent network",
      iterate: { max_rounds: 3, until: 'output.text.includes("CONSENSUS")', feed: "input_and_output" },
      interface: { inputs: [port("question", "message")], outputs: [port("answer", "message")] },
    })
    .node("dispatch", "function", 0, 120, { name: "Choose this layer's agents", fn: { lang: "js", code: DISPATCH }, interface: { inputs: [port("in", "message")], outputs: ins } }, "network")
    .node("collect", "function", 640, 120, {
      name: "Collect · stop early on 2/3",
      join: "any",
      fn: { lang: "js", code: COLLECT },
      interface: { inputs: ins, outputs: [port("done", "message"), port("rank", "json")] },
    }, "network")
    .node("ranker", "model", 920, 220, {
      name: "Ranker",
      model: "sonnet",
      system_prompt: "You rank answers by how correct and well reasoned they are.",
      prompt: 'Here are the answers from this layer, by agent:\n{{input}}\n\nScore each agent 1-5. Reply with JSON: {"scores": {"<agent id>": <score>, ...}, "summary": "<one line per agent: id, its answer, why it scored so>"}',
      interface: { inputs: [port("in", "json")], outputs: [port("out", "json")] },
    }, "network")
    .node("select", "function", 1200, 220, { name: "Keep the best two", fn: { lang: "js", code: SELECT }, interface: { inputs: [port("in", "json")], outputs: [port("out", "text")] } }, "network");
  AGENTS.forEach(([id, name, how], i) =>
    b.agent(id, 320, i * 120 - 60, { name, role: how.split(".")[0], model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: `${how} If earlier answers are shown, weigh them, then give your own. End with one line: Final: <the answer alone — a number, or at most three words>` } }, "network"),
  );
  b.edge("asker", "network", "message", { label: "Question" }).edge("network", "dispatch", "message");
  for (const [id] of AGENTS) b.edge("dispatch", id, "message", { source_port: id }).edge(id, "collect", "message", { target_port: id });
  b.edge("collect", "network", "message", { source_port: "done" })
    .edge("collect", "ranker", "message", { source_port: "rank" })
    .edge("ranker", "select", "message")
    .edge("select", "network", "message")
    .edge("network", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 40, wallclock_min: 15 };
  return b.doc;
}

export const dylan: TemplateInfo = {
  id: "paper-dylan",
  name: "DyLAN",
  summary: "layered agents · inference-time agent selection · early stop at 2/3 · importance scores",
  build,
  paper: { title: "A Dynamic LLM-Powered Agent Network for Task-Oriented Agent Collaboration", authors: "Liu et al.", year: 2023, url: "https://arxiv.org/abs/2310.02170" },
  notes: {
    mapped: [
      "The network's time steps are rounds of a group. A dispatch function sends each layer's question only to the agents chosen for it (all four in the first layer), so the team changes as the run goes: inference-time agent selection.",
      "A collect function waits for exactly the agents dispatched, and stops the run early when two thirds of them give the same final answer — the paper's consensus-based early stopping.",
      "Otherwise a ranker model scores every answer, and a function keeps the two best agents for the next layer and adds each score to that agent's importance, reported with the result.",
      "Functions share state through ctx.vars: which agents were chosen, how many answers to wait for, and the running importance scores.",
    ],
    differs: [
      "The paper computes Agent Importance Scores by propagating ratings backward through the layers; here each layer's ranker scores are summed.",
      "The paper uses those scores afterwards to pick a smaller team for a task; this template reports them but does not prune the team for later runs.",
    ],
  },
};
