// MapCoder: retrieve similar problems, plan from them, write the code, and
// debug it against the tests, round after round.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

function build(): SystemDoc {
  const b = new Builder(
    "MapCoder",
    "Four agents in a pipeline: the retrieval agent recalls similar problems it has seen, the planner turns them into a plan with a confidence score, the coder implements it, and the debugger runs the tests and repairs the code — up to five attempts.",
  );
  b.schema({
    id: "Plan",
    description: "A plan with its confidence",
    json_schema: '{\n  "type": "object",\n  "required": ["plan", "confidence"],\n  "properties": {\n    "plan": { "type": "string" },\n    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },\n    "based_on": { "type": "string" }\n  }\n}',
  })
    .node("user", "human", 0, 120, { name: "User", role: "Gives the problem", approves: false })
    .agent("retrieval", 240, 40, {
      name: "Retrieval agent",
      role: "Recalls similar problems",
      model: "sonnet",
      harness: { ...native(), loop: "single_shot", instructions: "Recall 2 problems you know that are solved the same way as this one. For each: the problem, its algorithm, and the solution in Python. Do not solve the given problem yet." },
    })
    .agent("planner", 540, 40, {
      name: "Planning agent",
      role: "Writes a plan and scores it",
      model: "opus",
      interface: { inputs: [port("in", "message")], outputs: [port("out", "json", { schema: "Plan" })] },
      pipeline: { pre: [], post: [{ id: "p1", op: "parse_json", name: "Parse plan", schema: "Plan", on_fail: "retry", max_retries: 2 }] },
      harness: { ...native(), loop: "single_shot", instructions: "Using the recalled problems, write a step-by-step plan for the given problem. Reply as JSON: plan, confidence (0-1, how likely this plan solves it), based_on (which recalled problem)." },
    })
    .group("repair", 840, 20, {
      name: "Code and debug",
      iterate: { max_rounds: 5, until: 'output.text.includes("ALL TESTS PASSED")', feed: "input_and_output" },
      interface: { inputs: [port("plan", "message")], outputs: [port("report", "message")] },
    })
    .agent("coder", 0, 0, {
      name: "Coding agent",
      role: "Implements the plan",
      model: "opus",
      tools: ["edit_file"],
      harness: { ...native(), loop: "react", max_steps: 5, instructions: "Implement the plan in Python and write it to /work/solution.py with edit_file. Keep the function name, parameters and imports exactly as the given problem states them, even if a recalled problem named them differently. If a bug report is given, fix exactly what it reports. Reply with a one-line summary." },
    }, "repair")
    .agent("debugger", 330, 0, {
      name: "Debugging agent",
      role: "Runs the tests and reports",
      model: "sonnet",
      tools: ["run_tests", "edit_file"],
      harness: {
        ...native(),
        loop: "react",
        max_steps: 5,
        instructions: "Write the problem's example cases as test_ functions with plain asserts in /work/test_solution.py (importing from solution; pytest may not be installed), run them with run_tests (no command needed), and read /work/solution.py if you need to. Check too that solution.py defines the function under the exact name the problem gives. If every test passes reply ALL TESTS PASSED; otherwise reply with the failing case and what is wrong. Either way, end your reply with the full current /work/solution.py in one ```python block: the code is the result.",
      },
    }, "repair")
    .node("sandbox", "env", 170, 220, { name: "Sandbox", env_kind: "sandbox", image: "python:3.12" }, "repair")
    .edge("user", "retrieval", "message", { label: "Problem" })
    .edge("retrieval", "planner", "handoff", { carry: "full" })
    .edge("planner", "repair", "message", { transform: { lang: "template", code: "Problem:\n{{run_input}}\n\nPlan (confidence {{input.confidence}}, based on {{input.based_on}}):\n{{input.plan}}" } })
    .edge("repair", "coder", "message")
    .edge("coder", "debugger", "handoff", { carry: "full" })
    .edge("debugger", "repair", "message")
    .edge("repair", "user", "message", { label: "Solution" })
    .edge("coder", "sandbox", "access", { access: "read_write" })
    .edge("debugger", "sandbox", "access", { access: "read_write" });
  b.doc.budget = { usd: 3, max_rounds: 30, wallclock_min: 20 };
  return b.doc;
}

export const mapcoder: TemplateInfo = {
  id: "paper-mapcoder",
  name: "MapCoder",
  summary: "recall similar problems · scored plan · code · debug loop",
  build,
  paper: { title: "MapCoder: Multi-Agent Code Generation for Competitive Problem Solving", authors: "Islam et al.", year: 2024, url: "https://arxiv.org/abs/2405.11403" },
  notes: {
    mapped: [
      "The four agents of the paper are four components in order: retrieval, planning, coding, debugging. The retrieval agent's recalled problems travel to the planner through a full handoff.",
      "The plan's confidence is a json port bound to a Plan schema, parsed by an output stage.",
      "The debugging loop is group iteration: the bug report goes back with the plan until the tests pass, at most 5 attempts.",
    ],
    differs: [
      "The paper generates k plans and tries them in confidence order; here the planner writes one plan and scores it. Several plans would be a spawn with the planner as the template.",
      "Recalled problems come from the model's own knowledge. For a real corpus, attach a knowledge plugin to the retrieval agent.",
    ],
  },
};
