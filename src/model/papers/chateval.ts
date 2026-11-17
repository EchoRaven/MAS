// ChatEval: a panel of referees with different personas debates a judgement
// over several turns, each seeing what the others have said.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const PERSONAS: [string, string, string][] = [
  ["general", "General Public", "You represent the general public. Judge how helpful and understandable each answer is to an ordinary reader."],
  ["critic", "Critic", "You are a harsh critic. Look for factual errors, missing conditions and overstated claims."],
  ["scientist", "Scientist", "You are a domain scientist. Judge the technical correctness and the reasoning, and say where it is unsupported."],
];

function build(): SystemDoc {
  const b = new Builder(
    "ChatEval",
    "Three referees with different personas judge the same answers. They speak in turn, each reading the debate so far, for two rounds; then the chair gives the verdict.",
  );
  b.node("submitter", "human", 0, 120, { name: "Submitter", role: "Brings the question and the answers to judge", approves: false })
    .group("panel", 260, 60, {
      name: "Referee panel",
      iterate: { max_rounds: 2, until: null, feed: "output" },
      interface: { inputs: [port("case", "message")], outputs: [port("debate", "message")] },
    });
  PERSONAS.forEach(([id, name, persona], i) =>
    b.agent(id, i * 300, 0, {
      name,
      role: persona.split(".")[0],
      model: "sonnet",
      harness: {
        ...native(),
        loop: "single_shot",
        instructions: `${persona}\n\nYou are one of three referees. Read the discussion so far, then give your own short assessment: say where you agree or disagree with the other referees and why, and name which answer you prefer. Do not summarise the others; add your view.`,
      },
    }, "panel"),
  );
  b.agent("chair", 980, 180, { name: "Chair", role: "Writes the verdict", model: "opus", harness: { ...native(), loop: "single_shot", instructions: "You read a referees' debate. Weigh their arguments, then give the verdict: which answer wins (or a tie), the main reason, and any point the panel got wrong." } })
    // the debate travels with the handoff: each referee sees the whole discussion
    .edge("panel", "general", "message")
    .edge("general", "critic", "handoff", { carry: "full" })
    .edge("critic", "scientist", "handoff", { carry: "full" })
    // the last referee hands the whole debate out of the panel, so the chair reads all of it
    .edge("scientist", "panel", "handoff", { carry: "full" })
    .edge("submitter", "panel", "message", { label: "Case" })
    .edge("panel", "chair", "message", { label: "Debate" })
    .edge("chair", "submitter", "message", { label: "Verdict" });
  b.doc.budget = { usd: 2, max_rounds: 20, wallclock_min: 15 };
  return b.doc;
}

export const chateval: TemplateInfo = {
  id: "paper-chateval",
  name: "ChatEval",
  summary: "referee personas · one-by-one debate · chair's verdict",
  build,
  paper: { title: "ChatEval: Towards Better LLM-based Evaluators through Multi-Agent Debate", authors: "Chan et al.", year: 2023, url: "https://arxiv.org/abs/2308.07201" },
  notes: {
    mapped: [
      "The panel is a group whose referees are chained by full handoffs, so each one receives the whole debate so far: the paper's one-by-one communication strategy.",
      "Diverse role prompts are the referees' personas (general public, critic, scientist).",
      "Group iteration runs the panel for two discussion turns before the chair writes the verdict.",
    ],
    differs: [
      "Only the one-by-one strategy is built. Simultaneous-talk would be three parallel edges into a join-all function; simultaneous-talk-with-summariser would add a summarising agent before each round.",
      "The paper scores answers on a benchmark; here the chair writes a verdict in prose.",
    ],
  },
};
