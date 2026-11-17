// MetaGPT: role SOPs over a shared message pool; each role subscribes to the
// message types it acts on and publishes a structured document.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { AccessBinding, SystemDoc } from "../types";

/** Subscribe to some message types; publish as one (the post's cause_by). */
const subscribe = (types: string[], publishes: string): AccessBinding => ({
  mode: "pinned",
  read: { filter: `[${types.map((t) => `"${t}"`).join(", ")}].includes(msg.cause_by)`, budget_tokens: 8000 },
  write: { when: "agent_tool", tag: publishes },
});

const parse = (schema: string) => ({ pre: [], post: [{ id: "p1", op: "parse_json" as const, name: `Parse ${schema}`, schema, on_fail: "retry" as const, max_retries: 2 }] });

function build(): SystemDoc {
  const b = new Builder(
    "MetaGPT",
    "Roles follow standard operating procedures around a shared message pool: each subscribes to the message types it acts on and publishes a structured document (PRD, system design, task list, code, test report) that the next role picks up.",
  );
  for (const [id, desc] of [
    ["PRD", "Product requirements: goals, user stories, competitive analysis, requirement pool"],
    ["SystemDesign", "Implementation approach, file list, data structures and interfaces, call flow"],
    ["TaskList", "Ordered tasks with the file each one touches and its dependencies"],
  ] as const) {
    b.schema({ id, description: desc, json_schema: '{\n  "type": "object"\n}' });
  }
  const role = (id: string, x: number, y: number, name: string, profile: string, schema: string | null, tools: string[] = []) =>
    b.agent(id, x, y, {
      name,
      role: profile,
      model: id === "engineer" ? "opus" : "sonnet",
      tools,
      triggers: ["on_state"],
      interface: { inputs: [port("in", "message")], outputs: [port("out", schema ? "json" : "message", schema ? { schema } : {})] },
      pipeline: schema ? parse(schema) : { pre: [], post: [] },
      harness: { ...native(), loop: "plan_execute", instructions: `You are the ${name}. Follow your SOP and publish your document to the message pool.` },
    });
  b.node("boss", "human", 0, 160, { name: "Boss", role: "States the requirement", approves: false })
    .room("pool", 520, 380, "message pool", { policy: "free" });
  role("pm", 260, 0, "Product Manager", "Writes the PRD", "PRD");
  role("architect", 560, 0, "Architect", "Designs the system", "SystemDesign");
  role("project", 860, 0, "Project Manager", "Breaks the design into tasks", "TaskList");
  role("engineer", 860, 600, "Engineer", "Writes the code", null, ["edit_file"]);
  role("qa", 560, 600, "QA Engineer", "Writes and runs tests", null, ["run_tests"]);
  b.node("repo", "env", 1160, 420, { name: "Workspace", env_kind: "sandbox", image: "python:3.12" })
    .edge("boss", "pool", "access", { access: "read_write", binding: { mode: "tool", write: { when: "agent_tool", tag: "UserRequirement" } } })
    .edge("pm", "pool", "access", { binding: subscribe(["UserRequirement"], "WritePRD") })
    .edge("architect", "pool", "access", { binding: subscribe(["WritePRD"], "WriteDesign") })
    .edge("project", "pool", "access", { binding: subscribe(["WriteDesign"], "WriteTasks") })
    .edge("engineer", "pool", "access", { binding: subscribe(["WriteTasks", "WriteTest"], "WriteCode") })
    .edge("qa", "pool", "access", { binding: subscribe(["WriteCode"], "WriteTest") })
    .edge("engineer", "repo", "access", { access: "read_write" })
    .edge("qa", "repo", "access", { access: "read_write" });
  b.doc.budget = { usd: 6, max_rounds: 80, wallclock_min: 45 };
  return b.doc;
}

export const metagpt: TemplateInfo = {
  id: "paper-metagpt",
  name: "MetaGPT",
  summary: "SOP roles · shared message pool with subscriptions · structured documents",
  build,
  paper: { title: "MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework", authors: "Hong et al.", year: 2023, url: "https://arxiv.org/abs/2308.00352" },
  notes: {
    mapped: [
      "The shared message pool is a room env. Each role's access edge publishes its posts as one message type (binding.write.tag, the paper's cause_by) and subscribes to others with a filter (binding.read.filter): a role sees and is woken only by the types it subscribes to.",
      "Structured outputs are json ports bound to schemas (PRD, SystemDesign, TaskList), enforced by a parse_json output stage.",
      "Roles wake on state changes (on_state) instead of being messaged directly; the Engineer and the QA Engineer loop through test reports.",
    ],
    differs: [
      "The schemas are placeholders (type: object); the paper's document templates have many more fields.",
      "Executable feedback (run, debug, retry) is expressed through the Engineer's subscription to test reports, not as a dedicated debugging action.",
    ],
  },
};
