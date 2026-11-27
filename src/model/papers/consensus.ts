// Multi-Agent Consensus Seeking via Large Language Models (Chen et al.): each agent holds a number and, round after
// round, sees its neighbours' numbers and states a new one, until they agree. The paper found that agents mostly move
// to their neighbours' average, so the group meets near the starting mean, and that the network and stubborn agents
// change where and how fast. The numbers, who sees whom and the spread are code; every new number is an agent's.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

const N = 5;

const MODERATOR = String.raw`const n = ${N};
const rounds = Number(ctx.vars.rounds ?? 6);
// full: everyone sees everyone; ring: each sees its two neighbours; star: agent 1 sees all, the others only agent 1
const topology = ["full", "ring", "star"].includes(ctx.vars.topology) ? ctx.vars.topology : "full";
// stubborn: how many agents (from the first) are told to keep to their own number
const stubborn = Math.max(0, Math.min(n, Number(ctx.vars.stubborn ?? 0)));
const sees = (i) => topology === "full" ? [...Array(n).keys()].filter((j) => j !== i)
  : topology === "ring" ? [(i + n - 1) % n, (i + 1) % n]
  : i === 0 ? [1, 2, 3, 4] : [0];
// starting numbers: whole numbers from 0 to 100, different every run
let x = [...Array(n)].map(() => Math.floor(Math.random() * 101));
const start = [...x];
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const spread = (a) => Math.max(...a) - Math.min(...a);
const numberOf = (t, fallback) => { const m = [...String(t).matchAll(/number\s*[:：]\s*\**\s*(-?\d+(?:\.\d+)?)/gi)]; return m.length ? Number(m[m.length - 1][1]) : fallback; };
const story = ["Start: " + x.join(", ") + " (mean " + mean(x).toFixed(1) + ")"];
let agreedAt = null, toward = 0, moves = 0;
for (let r = 1; r <= rounds && agreedAt === null; r++) {
  const next = [];
  for (let i = 0; i < n; i++) {
    const nb = sees(i);
    const view = nb.map((j) => "Agent " + (j + 1) + ": " + x[j]).join("\n");
    const brief = (i < stubborn ? "You are stubborn: you believe your own number is right and change it only if you must. " : "") +
      "You are Agent " + (i + 1) + " in a group that must agree on one number. Your number now is " + x[i] + ". The numbers you can see:\n" + view +
      "\nThis is round " + r + " of at most " + rounds + ". Choose your number for the next round, in a sentence of reasoning, and end with a last line 'Number: <your number>'.";
    next.push(numberOf(await tools.call_agent("Agent " + (i + 1), brief), x[i]));
  }
  for (let i = 0; i < n; i++) {
    if (next[i] === x[i]) continue;
    moves++;
    const avg = mean(sees(i).map((j) => x[j]).concat([x[i]]));
    if (Math.abs(next[i] - avg) < Math.abs(x[i] - avg)) toward++;
  }
  x = next;
  story.push("Round " + r + ": " + x.join(", ") + " (spread " + spread(x).toFixed(1) + ")");
  emit("round " + r, x.join(", "));
  if (spread(x) <= 1) agreedAt = r;
}
metric("agreed", agreedAt === null ? 0 : 1);
metric("rounds to agree", agreedAt ?? rounds + 1);
metric("final spread", Math.round(10 * spread(x)) / 10);
metric("distance from the starting mean", Math.round(10 * Math.abs(mean(x) - mean(start))) / 10);
metric("moves toward the neighbours' mean %", moves ? Math.round((100 * toward) / moves) : 100);
if (stubborn) metric("distance from the stubborn agent's start", Math.round(10 * Math.abs(mean(x) - start[0])) / 10);
return story.join("\n") + "\n\nTopology " + topology + ", " + stubborn + " stubborn. " + (agreedAt === null ? "No agreement in " + rounds + " rounds" : "Agreed in round " + agreedAt) +
  " at about " + mean(x).toFixed(1) + "; the starting mean was " + mean(start).toFixed(1) + ".\nAnswer: " + mean(x).toFixed(1);`;

function build(): SystemDoc {
  const b = new Builder(
    "Consensus seeking",
    "Five agents each hold a number and, round after round, see their neighbours' numbers and choose a new one until they agree. Run variables: topology (full, ring, star), stubborn (how many keep to their own), rounds (6).",
  );
  b.node("host", "human", 0, 200, { name: "Host", role: "Starts the round and reads where the group met", approves: false })
    .agent("moderator", 280, 180, { name: "Moderator", role: "Shows each agent its neighbours' numbers and checks for agreement", model: "haiku", harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: MODERATOR }, instructions: "Run the consensus rounds." } })
    .edge("host", "moderator", "message", { label: "Start" })
    .edge("moderator", "host", "message", { label: "Where they met" });
  for (let i = 1; i <= N; i++) {
    b.agent(`agent_${i}`, 620, (i - 1) * 100, {
      name: `Agent ${i}`,
      role: "Chooses its next number",
      model: "haiku",
      harness: { ...native(), loop: "single_shot", instructions: "Answer exactly what you are asked." },
      context: { budget_total: 8000, history_strategy: "window", history_window: 2, mask_tool_output: false },
    });
    b.edge("moderator", `agent_${i}`, "call");
  }
  b.doc.budget = { usd: 0.2, max_rounds: 60, wallclock_min: 10 };
  return b.doc;
}

export const consensus: TemplateInfo = {
  id: "paper-consensus",
  name: "Consensus seeking",
  summary: "five agents with numbers · see neighbours, choose again · where and how fast do they agree?",
  build,
  paper: { title: "Multi-Agent Consensus Seeking via Large Language Models", authors: "Chen et al.", year: 2023, url: "https://arxiv.org/abs/2310.20151" },
  notes: {
    mapped: [
      "A custom loop holds the numbers: each round every agent sees only its neighbours' current numbers (topology full, ring or star) and states a new one; agreement is a spread of at most 1.",
      "Starting numbers are drawn from 0 to 100 on every run, so repeats are different games.",
      "Metrics: whether and in how many rounds they agree, the final spread, how far the meeting point is from the starting mean, the share of moves toward the neighbours' mean (the paper's average strategy), and with stubborn agents how close the group ends to the first stubborn agent's number.",
    ],
    differs: [
      "The paper also plans robot positions from the numbers and tries more network shapes; here five agents and three shapes.",
      "Agents keep no memory between rounds: each sees its own number and its neighbours', as in the paper's prompt.",
    ],
  },
};
