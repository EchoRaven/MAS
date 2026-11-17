// AgentCoder: a programmer and a test designer work from the same task in
// parallel; a test executor runs the tests and sends failures back.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

function build(): SystemDoc {
  const b = new Builder(
    "AgentCoder",
    "The programmer writes the code and, independently, the test designer writes tests for the same task. The test executor runs the tests; failures go back to the programmer until they pass or the iteration limit is reached.",
  );
  b.node("user", "human", 0, 100, { name: "User", role: "Gives the coding task", approves: false })
    .group("loop", 300, 60, {
      name: "Code and test",
      iterate: { max_rounds: 4, until: 'output.text.includes("ALL TESTS PASSED")', feed: "input_and_output" },
      interface: { inputs: [port("task", "message")], outputs: [port("report", "message")] },
    })
    .agent("programmer", 0, -60, {
      name: "Programmer",
      role: "Writes the code",
      model: "opus",
      tools: ["edit_file"],
      harness: { ...native(), loop: "react", max_steps: 6, instructions: "Think step by step, then write the solution to /work/solution.py with edit_file. If test feedback is given, fix the code. Reply with a one-line summary." },
    }, "loop")
    .agent("tester", 0, 140, {
      name: "Test designer",
      role: "Writes tests independently",
      model: "sonnet",
      tools: ["edit_file"],
      harness: { ...native(), loop: "react", max_steps: 4, instructions: "Without seeing the code, write pytest tests for the task to /work/test_solution.py (import from solution): basic, edge and large-scale cases. On later rounds keep the tests unless they are wrong. Reply with a one-line summary." },
    }, "loop")
    .node("both", "function", 330, 40, {
      name: "Both ready",
      join: "all",
      fn: { lang: "js", code: "return { role: 'user', text: 'Code: ' + input.code + '\\nTests: ' + input.tests };" },
      interface: { inputs: [port("code", "text", { required: true }), port("tests", "text", { required: true })], outputs: [port("out", "message")] },
    }, "loop")
    .agent("executor", 620, 40, {
      name: "Test executor",
      role: "Runs the tests",
      model: "haiku",
      tools: ["run_tests"],
      harness: { ...native(), loop: "react", max_steps: 3, instructions: "Run the tests with run_tests (command: python -m pytest -q). If every test passes reply ALL TESTS PASSED; otherwise reply with the failing tests and their error messages." },
    }, "loop")
    .node("sandbox", "env", 330, 260, { name: "Sandbox", env_kind: "sandbox", image: "python:3.12" }, "loop")
    .edge("loop", "programmer", "message")
    .edge("loop", "tester", "message")
    .edge("programmer", "both", "message", { target_port: "code" })
    .edge("tester", "both", "message", { target_port: "tests" })
    .edge("both", "executor", "message")
    .edge("executor", "loop", "message")
    .edge("user", "loop", "message", { label: "Task" })
    .edge("loop", "user", "message", { label: "Result" });
  for (const id of ["programmer", "tester", "executor"]) b.edge(id, "sandbox", "access", { access: "read_write" });
  b.doc.budget = { usd: 3, max_rounds: 30, wallclock_min: 20 };
  return b.doc;
}

export const agentcoder: TemplateInfo = {
  id: "paper-agentcoder",
  name: "AgentCoder",
  summary: "programmer ∥ test designer · test executor · repair loop",
  build,
  paper: { title: "AgentCoder: Multi-Agent-based Code Generation with Iterative Testing and Optimisation", authors: "Huang et al.", year: 2023, url: "https://arxiv.org/abs/2312.13010" },
  notes: {
    mapped: [
      "The programmer and the test designer both receive the task from the group's input and work in parallel, so the tests are written without seeing the code, as in the paper.",
      "A join-all function waits for both; the test executor runs pytest in the shared sandbox (/work).",
      "Group iteration feeds the task plus the test report back until the report says ALL TESTS PASSED, at most 4 rounds.",
    ],
    differs: [
      "The paper's test executor is a plain script; here a small model calls run_tests and summarises the failures.",
      "Both writers get the failure report on later rounds; in the paper only the programmer revises.",
    ],
  },
};
