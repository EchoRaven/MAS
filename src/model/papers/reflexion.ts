// Reflexion: an actor attempts the task, an evaluator scores the attempt, and
// after a failure a self-reflection step writes a verbal lesson into an
// episodic memory that the actor reads on its next trial.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

function build(): SystemDoc {
  const b = new Builder(
    "Reflexion",
    "The actor writes a solution; the evaluator runs the tests on it. When they fail, the self-reflection agent studies the attempt and the failures and writes a lesson into the episodic memory. The actor reads every lesson before its next trial, so each attempt learns from the last — no weights change, only words.",
  );
  b.node("user", "human", 0, 120, { name: "User", role: "Gives the task and its tests", approves: false })
    .group("trials", 280, 80, {
      name: "Trials",
      iterate: { max_rounds: 3, until: 'output.text.includes("PASS")', feed: "input_and_output" },
      interface: { inputs: [port("task", "message")], outputs: [port("result", "message")] },
    })
    .agent("actor", 0, 0, {
      name: "Actor",
      role: "Attempts the task",
      model: "sonnet",
      tools: ["edit_file"],
      harness: {
        ...native(),
        loop: "react",
        max_steps: 5,
        instructions:
          "Solve the task: write the function to /work/solution.py with edit_file. Before you start, read the lessons from your earlier trials in your context and do not repeat those mistakes. Reply with the code.",
      },
    }, "trials")
    .agent("evaluator", 320, 0, {
      name: "Evaluator",
      role: "Runs the tests",
      model: "haiku",
      tools: ["edit_file", "run_tests"],
      harness: {
        ...native(),
        loop: "react",
        max_steps: 4,
        instructions:
          "Write the task's tests to /work/test_solution.py as pytest tests (import from solution), run them with run_tests (command: python -m pytest -q), and report. If every test passes, reply PASS and the code. Otherwise reply FAIL with each failing test and its error.",
      },
    }, "trials")
    .agent("reflector", 640, 0, {
      name: "Self-reflection",
      role: "Turns a failure into a lesson",
      model: "sonnet",
      harness: {
        ...native(),
        loop: "single_shot",
        instructions:
          "You see a failed attempt and why it failed. Write one or two sentences of advice to your future self: what went wrong, and what to do differently. Be specific to this task. Reply with the lesson only.",
      },
    }, "trials")
    .node("route", "function", 480, 160, {
      name: "Passed?",
      fn: { lang: "js", code: "// a pass leaves the trial; a failure goes to self-reflection\nreturn String(input.text ?? input).includes('PASS') ? { done: input } : { reflect: input };" },
      interface: { inputs: [port("in", "message")], outputs: [port("done", "message"), port("reflect", "message")] },
    }, "trials")
    .plugin("lessons", "memory", 320, 240, { name: "Episodic memory", scope: "system" }, "trials")
    .node("sandbox", "env", 160, 240, { name: "Sandbox", env_kind: "sandbox", image: "python:3.12" }, "trials")
    .edge("trials", "actor", "message")
    .edge("actor", "evaluator", "handoff", { carry: "full" })
    .edge("evaluator", "route", "message")
    .edge("route", "trials", "message", { source_port: "done" })
    .edge("route", "reflector", "message", { source_port: "reflect" })
    .edge("reflector", "trials", "message")
    .edge("actor", "sandbox", "access", { access: "read_write" })
    .edge("evaluator", "sandbox", "access", { access: "read_write" })
    .edge("actor", "lessons", "access", { access: "read" })
    .edge("reflector", "lessons", "access", { access: "read_write" })
    .edge("user", "trials", "message", { label: "Task" })
    .edge("trials", "user", "message", { label: "Solution" });
  // the actor reads every lesson before a trial; the reflector writes each lesson whole
  const read = b.doc.edges.find((e) => e.source === "actor" && e.target === "lessons")!;
  read.binding = { mode: "auto_inject", read: { top_k: 10, budget_tokens: 1500 }, write: { when: "never" } };
  const write = b.doc.edges.find((e) => e.source === "reflector" && e.target === "lessons")!;
  write.binding = { mode: "tool", write: { when: "after_turn", extract: { lang: "js", code: "// the reply is the lesson\nconst m = /Reply:\\s*([\\s\\S]*)$/.exec(String(input));\nreturn m && m[1].trim() ? [{ text: m[1].trim(), type: 'lesson' }] : [];" } } };
  const mem = b.doc.nodes.find((n) => n.id === "lessons")!;
  if (mem.data.kind === "plugin") {
    mem.data.spec.memory = { ...mem.data.spec.memory!, extract: { use: "whole_turn" }, classify: { use: "none" }, merge: { use: "append" }, retain: { use: "cap", params: { max: 3 } }, consolidate: { use: "none" } };
  }
  b.doc.budget = { usd: 2, max_rounds: 20, wallclock_min: 20 };
  return b.doc;
}

export const reflexion: TemplateInfo = {
  id: "paper-reflexion",
  name: "Reflexion",
  summary: "actor · evaluator · self-reflection · episodic memory of lessons",
  build,
  paper: { title: "Reflexion: Language Agents with Verbal Reinforcement Learning", authors: "Shinn et al.", year: 2023, url: "https://arxiv.org/abs/2303.11366" },
  notes: {
    mapped: [
      "The three models of the paper are three components: the actor, the evaluator (here it runs tests in the sandbox), and self-reflection.",
      "The episodic memory is a memory plugin. Self-reflection writes each lesson whole; the actor has it auto-injected before every trial, read-only. Like the paper's bounded buffer, it keeps the last 3 lessons.",
      "A function routes the evaluation: a pass leaves the trials, a failure goes to self-reflection. Group iteration runs up to 3 trials until the result says PASS.",
    ],
    differs: [
      "The paper's evaluator for code also writes its own unit tests from the task; here the tests come with the task.",
      "The platform also offers Reflexion as an agent loop (harness loop: reflexion) for a single agent; this template spells the mechanism out as separate components.",
    ],
  },
};
