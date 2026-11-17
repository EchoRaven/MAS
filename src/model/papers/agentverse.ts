// AgentVerse: recruit experts for the task, let them decide together, carry
// the decision out, evaluate it, and go round again with the feedback.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

function build(): SystemDoc {
  const b = new Builder(
    "AgentVerse",
    "Each round: the recruiter decides which experts the task needs and runs them (spawned on the fly), the solver merges their proposals into one decision, the executor carries it out, and the evaluator scores it. Unless the evaluator is satisfied, its feedback starts the next round.",
  );
  b.node("user", "human", 0, 120, { name: "User", role: "Gives the task", approves: false })
    .group("round", 300, 80, {
      name: "Recruit → decide → execute → evaluate",
      iterate: { max_rounds: 3, until: 'output.text.includes("SATISFIED")', feed: "input_and_output" },
      interface: { inputs: [port("task", "message")], outputs: [port("result", "message")] },
    })
    .agent("recruiter", 0, 0, {
      name: "Recruiter and solver",
      role: "Recruits experts and merges their views",
      model: "opus",
      harness: {
        ...native(),
        loop: "react",
        max_steps: 4,
        instructions:
          "1) Decide which 2-4 expert roles the task needs. 2) Call spawn_subagents with one task per expert, each starting 'As a <role>, …' (horizontal discussion: each gives a proposal and critiques the obvious alternatives). 3) Merge their answers into one decision, noting where they disagreed. If evaluator feedback is given, address it.",
      },
      spawn: { template: "expert", max_instances: 4 },
    }, "round")
    .agent("expert", 0, 220, { name: "Expert", role: "Takes the role it is given", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Answer in the role named at the start of your task: a concrete proposal, then one risk of it." } }, "round")
    .agent("executor", 330, 0, { name: "Executor", role: "Carries out the decision", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Carry out the decision: produce the final deliverable it describes." } }, "round")
    .agent("evaluator", 660, 0, { name: "Evaluator", role: "Scores the result", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Score the deliverable 0-10 against the task on correctness, completeness and clarity, with one line each. If every score is 8 or more, end with SATISFIED and repeat the deliverable; otherwise give concrete feedback." } }, "round")
    .edge("round", "recruiter", "message")
    .edge("recruiter", "executor", "message", { label: "Decision" })
    .edge("executor", "evaluator", "message")
    .edge("evaluator", "round", "message")
    .edge("user", "round", "message", { label: "Task" })
    .edge("round", "user", "message", { label: "Result" });
  b.doc.budget = { usd: 3, max_rounds: 30, wallclock_min: 20 };
  return b.doc;
}

export const agentverse: TemplateInfo = {
  id: "paper-agentverse",
  name: "AgentVerse",
  summary: "expert recruitment (spawn) · group decision · execution · evaluation loop",
  build,
  paper: { title: "AgentVerse: Facilitating Multi-Agent Collaboration and Exploring Emergent Behaviors", authors: "Chen et al.", year: 2023, url: "https://arxiv.org/abs/2308.10848" },
  notes: {
    mapped: [
      "Expert recruitment is dynamic: the recruiter spawns copies of a template Expert agent, each given its role in its task, so the group's make-up changes per task and per round.",
      "Collaborative decision-making is the horizontal structure: experts propose in parallel and the solver merges them.",
      "Action execution and evaluation are agents; the evaluator's feedback is fed back with the task (group iteration) until it says SATISFIED, at most 3 rounds.",
    ],
    differs: [
      "Only the horizontal decision structure is built; the paper's vertical structure (a solver proposes, reviewers critique in turns) would replace the spawn step with a critic loop.",
      "Recruiter and solver are one agent here; the paper uses separate prompts for them.",
    ],
  },
};
