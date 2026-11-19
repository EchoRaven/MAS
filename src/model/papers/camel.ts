// CAMEL: role-playing between an AI user and an AI assistant, set up by a
// task specifier, until the user declares the task done.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

function build(): SystemDoc {
  const b = new Builder(
    "CAMEL role-playing",
    "A human gives a rough idea and two roles. A task specifier makes the task concrete, then an AI user instructs an AI assistant turn by turn until the user replies <CAMEL_TASK_DONE>.",
  );
  b.node("human", "human", 0, 40, { name: "Human", role: "Gives the idea and the two roles", approves: false })
    .node("specifier", "model", 250, 30, { name: "Task specifier", model: "sonnet", system_prompt: "You make tasks more specific.", prompt: "Here is a task that {{vars.assistant_role}} will help {{vars.user_role}} complete: {{input}}. Make it more specific and creative. Reply with the specified task in 50 words or less." })
    .group("roleplay", 520, 20, { name: "Role-play", iterate: { max_rounds: 40, until: 'output.text.includes("<CAMEL_TASK_DONE>")', feed: "output" } })
    .agent("ai_user", 0, 0, { name: "AI user", role: "Instructs, one step at a time", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Never forget you are the user and the other agent is the assistant. Never flip roles. Give one instruction at a time in the form 'Instruction: … Input: …'. When the task is complete, reply only <CAMEL_TASK_DONE>." } }, "roleplay")
    .agent("ai_assistant", 320, 0, { name: "AI assistant", role: "Carries out each instruction", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Never forget you are the assistant and the other agent is the user. Never flip roles or instruct the user. Complete each instruction and start with 'Solution: …', ending with 'Next request.'. When the user replies <CAMEL_TASK_DONE>, reply <CAMEL_TASK_DONE> and then the task's final result in full (when the task asks for one value, end with a line 'Answer: X'): it is what the role-play delivers." } }, "roleplay")
    .edge("human", "specifier", "message", { label: "Idea" })
    .edge("specifier", "roleplay", "message", { label: "Specified task" })
    .edge("roleplay", "ai_user", "message")
    .edge("ai_user", "ai_assistant", "message")
    .edge("ai_assistant", "roleplay", "message")
    .edge("roleplay", "human", "message", { label: "Transcript" });
  b.doc.budget = { usd: 2, max_rounds: 90, wallclock_min: 20 };
  return b.doc;
}

export const camel: TemplateInfo = {
  id: "paper-camel",
  name: "CAMEL role-playing",
  summary: "task specifier · AI user ↔ AI assistant · inception prompting",
  build,
  paper: { title: "CAMEL: Communicative Agents for \"Mind\" Exploration of Large Language Model Society", authors: "Li et al.", year: 2023, url: "https://arxiv.org/abs/2303.17760" },
  notes: {
    mapped: [
      "The task specifier is a Model call; the role-play is a Group of the AI user and the AI assistant that iterates until the user's turn contains <CAMEL_TASK_DONE>.",
      "Inception prompting is in each agent's instructions (keep roles, one instruction at a time, fixed reply formats).",
    ],
    differs: [
      "The prompts are condensed versions of the paper's inception prompts; the 40-round cap is a setting here, not taken from the paper.",
    ],
  },
};
