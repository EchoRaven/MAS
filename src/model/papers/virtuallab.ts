// The Virtual Lab: a team meeting of AI scientists. A principal investigator
// sets the agenda and leads; scientists with different expertise answer in
// turn; a scientific critic finds the flaws; after three rounds the PI writes
// the meeting summary with the decisions and next steps.
import { Builder, native, type TemplateInfo } from "../builder";
import { autoLayout } from "../layout";
import type { SystemDoc } from "../types";

const ROUNDS = 3;

const SCIENTISTS = [
  ["immunologist", "Immunologist", "immunology: antibodies, nanobodies, antigens and how they bind"],
  ["ml", "Machine learning specialist", "machine learning for proteins: language models, structure prediction, scoring"],
  ["compbio", "Computational biologist", "computational biology: protein structure, docking, molecular simulation"],
] as const;

const PI = `You are the principal investigator leading a team meeting of AI scientists. You do not do the work yourself; you steer it.
- Your first message: restate the research question, set the agenda, and ask the team the specific questions to answer.
- After each round (when the Scientific Critic has spoken), synthesise what the team said, decide what is settled, and ask follow-up questions for the next round.
- After the critic has spoken ${ROUNDS} times, write the meeting summary: the answer to the research question, the decisions made and why, and concrete next steps. End that message with the word TERMINATE.`;

const CRITIC = `You are the scientific critic. Point out errors, unsupported claims, missing controls, and places where the team's answers are vague or not feasible. Be specific and constructive, and say what would fix each problem. Do not propose a different project.`;

function build(): SystemDoc {
  const b = new Builder(
    "Virtual Lab",
    `A team meeting of AI scientists. A principal investigator sets the agenda; an immunologist, a machine-learning specialist and a computational biologist answer in turn; a scientific critic finds the flaws. After ${ROUNDS} rounds the PI writes the meeting summary with decisions and next steps.`,
  );
  b.node("user", "human", 0, 0, { name: "Researcher", role: "Brings the research question", approves: false })
    .room("meeting", 0, 0, "team meeting", { policy: "round_robin", history: "since_join" })
    .agent("pi", 0, 0, { name: "Principal investigator", role: "Sets the agenda, leads, summarises", model: "opus", harness: { ...native(), loop: "single_shot", instructions: PI } });
  for (const [id, name, field] of SCIENTISTS) {
    b.agent(id, 0, 0, {
      name,
      role: `Expert in ${field.split(":")[0]}`,
      model: "sonnet",
      harness: { ...native(), loop: "single_shot", instructions: `You are an expert in ${field}. In the team meeting, answer the PI's questions from your expertise: concrete proposals, with the reasoning and the evidence behind them. Build on or disagree with what your colleagues said. Keep it under 250 words.` },
    });
  }
  b.agent("critic", 0, 0, { name: "Scientific critic", role: "Finds the flaws", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: CRITIC } })
    .edge("user", "meeting", "access", { access: "read_write", binding: { mode: "tool", write: { when: "agent_tool" } } });
  // the order members join is the order they speak: the PI first, the critic last
  for (const id of ["pi", ...SCIENTISTS.map(([id]) => id), "critic"]) b.edge(id, "meeting", "access", { access: "read_write" });
  b.doc.budget = { usd: 3, max_rounds: 40, wallclock_min: 20 };
  b.doc.termination = ['text.includes("TERMINATE")'];
  return autoLayout(b.doc);
}

export const virtuallab: TemplateInfo = {
  id: "paper-virtual-lab",
  name: "Virtual Lab",
  summary: "a PI-led team meeting in a room · scientists in turn · a scientific critic · rounds then a summary",
  build,
  paper: { title: "The Virtual Lab: AI Agents Design New SARS-CoV-2 Nanobodies with Experimental Validation", authors: "Swanson et al.", year: 2024, url: "https://www.biorxiv.org/content/10.1101/2024.11.11.623004v1" },
  notes: {
    mapped: [
      "The team meeting is a room env with the round-robin policy. Members speak in the order they joined: the principal investigator, the three scientists, then the scientific critic, round after round.",
      `The PI opens with the agenda and questions, synthesises after each round, and after ${ROUNDS} rounds writes the meeting summary ending with TERMINATE, which ends the meeting; that summary is the run's answer.`,
      "The scientific critic speaks last in every round, as in the paper, so each round's proposals are checked before the PI decides what is settled.",
    ],
    differs: [
      "In the paper the PI first creates the scientist agents for the project; here the team (an immunologist, a machine-learning specialist and a computational biologist, as in the paper's nanobody study) is fixed, so change the agents for another field.",
      "The paper also runs individual meetings (one scientist with the critic) to write and refine code, and gives the agents computational tools (ESM, AlphaFold-Multimer, Rosetta); here there is only the team meeting, without tools.",
      "The paper runs the same meeting several times in parallel and merges the summaries; run this system several times to do that.",
    ],
  },
};
