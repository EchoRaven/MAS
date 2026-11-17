// MAD (Multi-Agent Debate): an angel argues for an answer, a devil argues
// against it on purpose, and a moderator ends the debate as soon as one side
// is clearly right; if it never is, a judge decides at the end.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

function build(): SystemDoc {
  const b = new Builder(
    "MAD",
    "Divergent thinking by design. The angel gives an answer and its reasoning; the devil must disagree and argue for something else; the moderator reads the round and either declares a final answer, if one side is clearly right, or sends them back to it. After three rounds without a winner, a judge decides.",
  );
  b.node("asker", "human", 0, 120, { name: "Asker", role: "Poses a question that invites a hasty answer", approves: false })
    .group("debate", 260, 80, {
      name: "Debate",
      iterate: { max_rounds: 3, until: 'output.includes("FINAL ANSWER")', feed: "input_and_output" },
      interface: { inputs: [port("question", "message")], outputs: [port("round", "message")] },
    })
    .agent("angel", 0, 0, { name: "Angel", role: "Affirmative side", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "You are the affirmative side of a debate. Give your answer to the question and your reasoning. In later rounds, answer the negative side's objections: concede where they are right, and hold your ground where they are not." } }, "debate")
    .agent("devil", 320, 0, { name: "Devil", role: "Negative side", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "You are the negative side of a debate. You must disagree with the affirmative side: find the flaw in its reasoning and argue for a different answer, even if you first think it is right — your job is to make sure the obvious answer is tested. Be concrete." } }, "debate")
    .agent("moderator", 640, 0, {
      name: "Moderator",
      role: "Ends the debate when one side is right",
      model: "opus",
      harness: {
        ...native(),
        loop: "single_shot",
        instructions:
          "You moderate the debate. Read this round. If one side is clearly right, reply FINAL ANSWER: <the answer>, then one sentence on why. If it is not yet clear, reply CONTINUE and say what each side must address next round.",
      },
    }, "debate")
    .agent("judge", 600, 260, { name: "Judge", role: "Decides when the debate does not", model: "opus", harness: { ...native(), loop: "single_shot", instructions: "The debate has ended. If the moderator gave a FINAL ANSWER, repeat it with its reason. If not, weigh the whole debate and give the final answer yourself, with the reason." } })
    .edge("debate", "angel", "message")
    .edge("angel", "devil", "handoff", { carry: "full" })
    .edge("devil", "moderator", "handoff", { carry: "full" })
    .edge("moderator", "debate", "message")
    .edge("asker", "debate", "message", { label: "Question" })
    .edge("debate", "judge", "message")
    .edge("judge", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 20, wallclock_min: 10 };
  return b.doc;
}

export const mad: TemplateInfo = {
  id: "paper-mad",
  name: "MAD",
  summary: "angel vs devil · the devil must disagree · adaptive end by a moderator",
  build,
  paper: { title: "Encouraging Divergent Thinking in Large Language Models through Multi-Agent Debate", authors: "Liang et al.", year: 2023, url: "https://arxiv.org/abs/2305.19118" },
  notes: {
    mapped: [
      "The two debaters are the paper's angel and devil. The devil is instructed to disagree — tit for tat — which is the paper's remedy for Degeneration-of-Thought, where one model locks onto its first answer.",
      "Each round runs angel → devil → moderator, handed on with the whole round so each reads what came before.",
      "The adaptive break: the moderator ends the debate as soon as one side is clearly right (the group's until condition looks for FINAL ANSWER); otherwise the group repeats, at most three rounds, and a judge decides.",
    ],
    differs: [
      "The paper studies how the amount of disagreement affects results; here it is fixed by the devil's instructions.",
    ],
  },
};
