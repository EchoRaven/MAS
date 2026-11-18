// Voyager: an automatic curriculum proposes the next task, an action agent
// writes code for it, the environment runs it, a critic checks it, and every
// verified program joins the skill library — round after round, until the
// curriculum judges the goal reached.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const DONE = "GOAL REACHED";

function build(): SystemDoc {
  const b = new Builder(
    "Voyager",
    "A lifelong learner. The curriculum agent looks at the skills learned so far and proposes the next task; the action agent writes a program for it; the program runs in the sandbox; the critic judges it. A verified program goes back to the curriculum, joins the skill library, and the next task builds on it — until the curriculum judges the goal reached.",
  );
  b.node("explorer", "human", 0, 120, { name: "Explorer", role: "Sets the overall goal", approves: false })
    .agent("curriculum", 280, 100, {
      name: "Curriculum agent",
      role: "Proposes the next task",
      model: "sonnet",
      harness: {
        ...native(),
        loop: "single_shot",
        instructions: `You plan a learning curriculum toward the overall goal. Your context lists the skills already learned. You may also be given the result of the last attempt.\n\nPropose the single next task: just beyond what is already learned, achievable, and useful toward the goal. Name the learned skills it should reuse. Reply with the task in two or three sentences.\n\nWhen the learned skills together accomplish the goal, reply ${DONE} instead, followed by a short summary of what was learned. Only the skills listed in your context count as learned (each was verified by the critic): while that list is empty, never reply ${DONE}, and propose the first task.`,
      },
    })
    .group("attempt", 600, 60, {
      name: "Write, run, verify",
      iterate: { max_rounds: 4, until: 'output.text.includes("SUCCESS")', feed: "input_and_output" },
      interface: { inputs: [port("task", "message")], outputs: [port("verdict", "message")] },
    })
    .agent("action", 0, 0, {
      name: "Action agent",
      role: "Writes the program",
      model: "opus",
      tools: ["edit_file", "bash"],
      harness: {
        ...native(),
        loop: "react",
        max_steps: 8,
        instructions:
          "Write a Python program for the task, reusing the skills it names. Save it to /work/task.py and run it with bash (python3 task.py). If the critic's feedback or an error is given, fix the program. Reply with the final program and its output.",
      },
    }, "attempt")
    .agent("critic", 330, 0, {
      name: "Critic",
      role: "Checks whether the task was done",
      model: "sonnet",
      harness: {
        ...native(),
        loop: "single_shot",
        instructions: "Judge from the program and its output whether the task was really accomplished. If it was, reply SUCCESS, then the program exactly as written. If not, say what is wrong and how to fix it.",
      },
    }, "attempt")
    .node("sandbox", "env", 160, 220, { name: "Sandbox", env_kind: "sandbox", image: "python:3.12" }, "attempt")
    .plugin("skills", "memory", 280, 320, { name: "Skill library", scope: "system" })
    .edge("explorer", "curriculum", "message", { label: "Goal" })
    // the curriculum either sets the next task, or reports the goal reached
    .edge("curriculum", "attempt", "message", { label: "Next task", filter: `!text.includes("${DONE}")` })
    .edge("curriculum", "explorer", "message", { label: "Learned", filter: `text.includes("${DONE}")` })
    .edge("attempt", "action", "message")
    .edge("action", "critic", "handoff", { carry: "full" })
    .edge("critic", "attempt", "message")
    .edge("action", "sandbox", "access", { access: "read_write" })
    // a verified program goes back to the curriculum, which stores it and plans on
    .edge("attempt", "curriculum", "message", { label: "Verified skill" })
    .edge("curriculum", "skills", "access", { access: "read_write" });
  const lib = b.doc.edges.find((e) => e.source === "curriculum" && e.target === "skills")!;
  lib.binding = {
    mode: "auto_inject",
    read: { top_k: 12, budget_tokens: 3000 },
    write: {
      when: "after_turn",
      // the turn reads "Input: <verdict>\nReply: <next task>"; only a verified program becomes a skill
      extract: { lang: "js", code: "const m = /SUCCESS([\\s\\S]*?)(?:\\nReply:|$)/.exec(String(input));\nreturn m && m[1].trim() ? [{ text: m[1].trim(), type: 'skill' }] : [];" },
    },
  };
  const skills = b.doc.nodes.find((n) => n.id === "skills")!;
  if (skills.data.kind === "plugin") {
    skills.data.spec.memory = { ...skills.data.spec.memory!, extract: { use: "whole_turn" }, classify: { use: "none" }, merge: { use: "dedupe", params: { similarity: 0.9 } }, retain: { use: "forever" }, consolidate: { use: "none" } };
  }
  b.doc.entry = { node: "explorer" };
  b.doc.budget = { usd: 3, max_rounds: 40, wallclock_min: 30 };
  return b.doc;
}

export const voyager: TemplateInfo = {
  id: "paper-voyager",
  name: "Voyager",
  summary: "automatic curriculum · code as action · critic · growing skill library",
  build,
  paper: { title: "Voyager: An Open-Ended Embodied Agent with Large Language Models", authors: "Wang et al.", year: 2023, url: "https://arxiv.org/abs/2305.16291" },
  notes: {
    mapped: [
      "The skill library is a memory plugin. The curriculum agent sees it before every turn, and an extract step on its edge stores only programs the critic marked SUCCESS, so the library grows with verified skills only.",
      "The iterative prompting mechanism is a group that repeats write → run → verify, feeding the critic's feedback and the execution output back to the action agent, at most 4 attempts.",
      "The lifelong loop: each verdict returns to the curriculum, which proposes the next task from what is now learned. Two filtered edges leave the curriculum: the next task, or the goal reached.",
      "Code is the action space: the action agent writes Python and runs it in the sandbox.",
    ],
    differs: [
      "Voyager acts in Minecraft through Mineflayer. Here the world is a Python sandbox, so the skills are Python programs rather than game behaviours.",
      "Voyager retrieves skills for the action agent by embedding the task; here the curriculum, which sees the library, names the skills a task should reuse.",
    ],
  },
};
