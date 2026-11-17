import { defaultAgent, defaultBinding, defaultData, defaultRoom, emptySystem, RUNNERS } from "./defaults";
import { interfaceOf, isResource, port } from "./ports";
import { defaultPlugin } from "./plugins";
import type { AgentData, EdgeKind, NodeData, NodeKind, PluginPreset, PluginSpec, SchemaSpec, SysEdge, SystemDoc } from "./types";
import { RES_PORT } from "./types";

type Patch<D> = Partial<D> & Record<string, unknown>;

class Builder {
  doc: SystemDoc;
  private n = 0;
  constructor(name: string, description: string) {
    this.doc = emptySystem(name);
    this.doc.description = description;
  }
  agent(id: string, x: number, y: number, patch: Patch<AgentData>, parent?: string) {
    const base = defaultAgent(String(patch.name ?? id));
    const harness = { ...base.harness, ...(patch.harness ?? {}) };
    const runner = RUNNERS.find((r) => r.id === harness.runner);
    if (runner) harness.capabilities = { ...runner.caps };
    const data: AgentData = { ...base, ...patch, harness } as AgentData;
    this.doc.nodes.push({ id, position: { x, y }, parent, data });
    return this;
  }
  node(id: string, kind: Exclude<NodeKind, "agent">, x: number, y: number, patch: Record<string, unknown> = {}, parent?: string) {
    const data = { ...defaultData(kind), ...patch } as NodeData;
    this.doc.nodes.push({ id, position: { x, y }, parent, data });
    return this;
  }
  room(id: string, x: number, y: number, name: string, room: Partial<NonNullable<ReturnType<typeof defaultRoom>["room"]>>, parent?: string) {
    const data = defaultRoom(name);
    data.room = { ...data.room!, ...room };
    this.doc.nodes.push({ id, position: { x, y }, parent, data });
    return this;
  }
  plugin(id: string, preset: PluginPreset, x: number, y: number, patch: { name?: string } & Partial<PluginSpec> = {}, parent?: string) {
    const d = defaultPlugin(preset);
    const { name, ...spec } = patch;
    this.doc.nodes.push({ id, position: { x, y }, parent, data: { ...d, name: name ?? d.name, spec: { ...d.spec, ...spec } } });
    return this;
  }
  schema(s: SchemaSpec) {
    this.doc.schemas.push(s);
    return this;
  }
  /** Ports default to the first output / input; inside a group its own ports are used. */
  edge(source: string, target: string, kind: EdgeKind, extra: Partial<SysEdge> = {}) {
    const find = (id: string) => this.doc.nodes.find((n) => n.id === id)!;
    const s = find(source);
    const t = find(target);
    let source_port = extra.source_port;
    let target_port = extra.target_port;
    if (kind === "access" || isResource(t.data.kind)) {
      source_port = RES_PORT;
      target_port = RES_PORT;
      kind = "access";
      extra = { binding: defaultBinding(t.data), ...extra };
    } else {
      source_port ??= s.data.kind === "group" && t.parent === s.id ? interfaceOf(s.data).inputs[0].id : interfaceOf(s.data).outputs[0].id;
      target_port ??= t.data.kind === "group" && s.parent === t.id ? interfaceOf(t.data).outputs[0].id : interfaceOf(t.data).inputs[0].id;
    }
    this.doc.edges.push({ id: `e${++this.n}`, ...extra, source, target, kind, source_port, target_port });
    return this;
  }
}

const native = () => defaultAgent().harness;

function debate(): SystemDoc {
  const b = new Builder("Debate with a judge", "Pro and con take turns in one room; the judge scores every three rounds. Its output wrapper parses a Verdict and the run ends once there is one.");
  b.schema({ id: "Verdict", description: "The judge's decision", json_schema: '{\n  "type": "object",\n  "required": ["winner"],\n  "properties": {\n    "winner": { "enum": ["pro", "con", null] },\n    "reason": { "type": "string" }\n  }\n}' })
    .agent("pro", 0, 0, { name: "Pro", role: "Argues for the motion", model: "sonnet", harness: { ...native(), instructions: "You argue for the motion. Each turn, answer the other side's last point with one new argument." } })
    .agent("con", 300, 0, { name: "Con", role: "Argues against the motion", model: "sonnet", harness: { ...native(), instructions: "You argue against the motion. Point out the weakest link in the pro side's case." } })
    .agent("judge", 600, 0, {
      name: "Judge",
      role: "Scores and decides when to stop",
      model: "opus",
      interface: { inputs: [port("in", "message")], outputs: [port("verdict", "json", { schema: "Verdict" })] },
      pipeline: { pre: [], post: [{ id: "p1", op: "parse_json", name: "Parse verdict", schema: "Verdict", on_fail: "retry", max_retries: 2 }] },
      harness: { ...native(), loop: "single_shot", instructions: 'Evaluate every three rounds. Reply with JSON: {"winner": "pro" | "con" | null, "reason": "..."}.' },
    })
    .room("arena", 310, 210, "arena", { policy: "round_robin" })
    .edge("pro", "arena", "access")
    .edge("con", "arena", "access")
    .edge("judge", "arena", "access");
  b.doc.budget = { usd: 2, max_rounds: 12, wallclock_min: 10 };
  b.doc.termination = ["judge_outputs_verdict", "max_rounds"];
  b.doc.policies = [{ id: "p1", on: "output(judge.verdict)", condition: "output.winner != null", action: "terminate" }];
  return b.doc;
}

function codingTeam(): SystemDoc {
  const b = new Builder(
    "Coding team on a shared repo",
    "The planner posts tasks on the board; the coder (Claude Code) implements them in the shared repo; work reaches the reviewer (any ACP agent) only once tests pass. The reviewer's output wrapper routes to approve or changes; merging needs PM approval.",
  );
  b.schema({ id: "Review", description: "Reviewer decision", json_schema: '{\n  "type": "object",\n  "required": ["decision"],\n  "properties": {\n    "decision": { "enum": ["approve", "changes"] },\n    "comments": { "type": "array", "items": { "type": "string" } }\n  }\n}' })
    .agent("planner", 0, 0, { name: "Planner", role: "Splits work into tasks on the board", model: "opus", harness: { ...native(), loop: "plan_execute", instructions: "Break the request into independently verifiable task cards, post them on the board and assign them." } })
    .agent("coder", 300, 0, {
      name: "Coder",
      role: "Implements tasks",
      model: "opus",
      tools: ["run_tests"],
      triggers: ["on_state", "on_message"],
      harness: { ...native(), tier: "process", runner: "claude-code", loop: undefined, instructions: "Pick up the board tasks assigned to you, implement them in /work and make the tests pass.", own_memory: "disable" },
    })
    .agent("reviewer", 620, 0, {
      name: "Reviewer",
      role: "Reviews code",
      model: "sonnet",
      tools: ["merge_pr"],
      triggers: ["on_handoff"],
      interface: { inputs: [port("in", "message")], outputs: [port("approve", "json", { schema: "Review" }), port("changes", "message")] },
      pipeline: {
        pre: [],
        post: [
          { id: "p1", op: "parse_json", name: "Parse review", schema: "Review", on_fail: "retry", max_retries: 2 },
          { id: "p2", op: "route", name: "Approve or request changes", fn: { lang: "js", code: 'return input.decision === "approve" ? { approve: input } : { changes: { role: "user", content: input.comments.join("\\n") } };' } },
        ],
      },
      harness: { ...native(), tier: "process", runner: "acp", loop: undefined, command: "<launch command of any ACP-capable agent>", instructions: 'Review the change. Reply with JSON: {"decision": "approve" | "changes", "comments": [...]}.' },
    })
    .node("pm", "human", 940, 10, { name: "PM", role: "Approves merges" })
    .plugin("board", "board", 0, 230, { name: "Board" })
    .node("repo", "env", 330, 230, { name: "repo", env_kind: "sandbox", image: "node:22", egress: ["registry.npmjs.org", "github.com"] })
    .room("team", 690, 240, "team", { policy: "mention" })
    .edge("planner", "board", "access", { access: "read_write" })
    .edge("coder", "board", "access", { access: "read_write" })
    .edge("coder", "repo", "access", { access: "read_write" })
    .edge("reviewer", "repo", "access", { access: "read" })
    .edge("coder", "reviewer", "handoff", { carry: "summary", label: "Submit for review", gate: { name: "tests_pass", condition: "check: npm test", on_fail: "block", escalate_after: 3 } })
    .edge("reviewer", "coder", "message", { source_port: "changes", label: "Changes requested" })
    .edge("reviewer", "pm", "call", {
      source_port: "approve",
      label: "Request merge approval",
      transform: { lang: "template", code: "Merge approval needed.\n{{#each input.comments}}- {{this}}\n{{/each}}" },
    })
    .edge("planner", "team", "access")
    .edge("coder", "team", "access")
    .edge("reviewer", "team", "access")
    .edge("pm", "team", "access");
  b.doc.budget = { usd: 20, max_rounds: 200, wallclock_min: 120 };
  return b.doc;
}

function research(): SystemDoc {
  const b = new Builder(
    "Research team with spawning",
    "A Group with one input (the question) and one output (the report). Inside, the lead spawns searchers and the writer drafts from the knowledge base. A bare model call then writes the abstract.",
  );
  b.node("asker", "human", 0, 20, { name: "Asker", role: "Poses the research question", approves: false })
    .node("team", "group", 280, 0, { name: "Research team", budget_usd: 3, interface: { inputs: [port("question", "message", { required: true })], outputs: [port("report", "message")] } })
    .node("abstract", "model", 580, 0, { name: "Abstract writer", model: "haiku", system_prompt: "You write 3-sentence abstracts.", prompt: "Write the abstract of this report:\n\n{{input}}", interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } })
    .agent("lead", 0, 40, { name: "Lead", role: "Splits the question, spawns searchers", model: "opus", spawn: { template: "searcher", max_instances: 6 }, harness: { ...native(), loop: "plan_execute", instructions: "Split the question into 3-6 sub-questions and spawn one searcher per sub-question to search in parallel." } }, "team")
    .agent("searcher", 380, -90, { name: "Searcher (template)", role: "Researches one sub-question", model: "haiku", tools: ["web_search", "fetch"], harness: { ...native(), instructions: "Answer only the sub-question you were given, with sources." } }, "team")
    .agent("writer", 380, 150, { name: "Writer", role: "Writes the report", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Combine the search results into one sourced report." } }, "team")
    .plugin("kb", "knowledge", 410, 330, { scope: "group", sources: ["./docs"] }, "team")
    .edge("asker", "team", "message", { label: "Question" })
    .edge("team", "lead", "message")
    .edge("lead", "searcher", "call", { label: "Sub-question" })
    .edge("lead", "writer", "handoff", { carry: "full" })
    .edge("writer", "team", "message")
    .edge("writer", "kb", "access", {
      access: "read",
      binding: {
        mode: "auto_inject",
        read: { query: { lang: "template", code: "{{task.question}} {{input.text}}" }, top_k: 5, budget_tokens: 4000, format: { lang: "template", code: "{{#each results}}- {{this.text}} [{{this.source}}]\n{{/each}}" } },
        write: { when: "never" },
      },
    })
    .edge("team", "abstract", "message", { label: "Report" })
    .edge("abstract", "asker", "message", { label: "Abstract" });
  b.doc.budget = { usd: 3, max_rounds: 60, wallclock_min: 20 };
  return b.doc;
}

function support(): SystemDoc {
  const b = new Builder(
    "Support triage",
    "A function node redacts card numbers before anything reaches a model. Triage's output wrapper routes to billing or tech; refunds need human approval, formatted by an edge transform; history is remembered per end user.",
  );
  b.schema({ id: "Refund", description: "A refund request", json_schema: '{\n  "type": "object",\n  "required": ["order_id", "amount"],\n  "properties": {\n    "order_id": { "type": "string" },\n    "amount": { "type": "number" }\n  }\n}' })
    .node("customer", "human", 0, 140, { name: "Customer", role: "End user", approves: false })
    .node("redact", "function", 250, 140, { name: "Redact card numbers", fn: { lang: "js", code: 'return { ...input, content: input.content.replace(/\\b\\d{13,19}\\b/g, "[card]") };' }, interface: { inputs: [port("in", "message")], outputs: [port("out", "message")] } })
    .agent("triage", 590, 130, {
      name: "Triage",
      role: "Detects intent and routes",
      model: "haiku",
      modalities_in: ["text", "image"],
      interface: { inputs: [port("in", "message")], outputs: [port("billing", "message"), port("tech", "message")] },
      pipeline: { pre: [], post: [{ id: "p1", op: "route", name: "Route by intent", fn: { lang: "llm", code: "Answer billing or tech for this request: {{input}}", model: "haiku" } }] },
      harness: { ...native(), loop: "single_shot", instructions: "Summarise the request in one paragraph for the specialist." },
    })
    .agent("billing", 940, 0, {
      name: "Billing",
      role: "Handles billing and refunds",
      model: "sonnet",
      tools: ["issue_refund"],
      interface: { inputs: [port("in", "message")], outputs: [port("out", "message"), port("refund", "json", { schema: "Refund" })] },
      pipeline: { pre: [], post: [{ id: "p1", op: "route", name: "Reply or ask for a refund", fn: { lang: "js", code: "return input.refund ? { refund: input.refund } : { out: input };" } }] },
      harness: { ...native(), instructions: 'Verify the order before acting. To refund, reply with {"refund": {"order_id": ..., "amount": ...}}.' },
    })
    .agent("tech", 940, 270, { name: "Tech support", role: "Troubleshoots technical issues", model: "sonnet", tools: ["web_search"], harness: { ...native(), instructions: "Work through the troubleshooting playbook step by step." } })
    .node("lead", "human", 1300, 20, { name: "Support lead", role: "Approves refunds" })
    .plugin("mem", "memory", 1300, 420, { name: "User memory", scope: "end_user" })
    .edge("customer", "redact", "message")
    .edge("redact", "triage", "message")
    .edge("triage", "billing", "handoff", { source_port: "billing", carry: "summary" })
    .edge("triage", "tech", "handoff", { source_port: "tech", carry: "summary" })
    .edge("billing", "lead", "call", { source_port: "refund", label: "Refund approval", transform: { lang: "template", code: "Approve refund of ${{input.amount}} for order {{input.order_id}}?" } })
    .edge("billing", "customer", "message", { source_port: "out", label: "Reply" })
    .edge("billing", "mem", "access", {
      access: "read_write",
      binding: {
        mode: "auto_inject",
        read: { top_k: 8, filter: "scope == \"end_user\" && age_days < 90", budget_tokens: 2000 },
        write: { when: "after_turn", extract: { lang: "llm", code: "List new durable facts about the customer (orders, preferences, open issues) from this turn as JSON lines.", model: "haiku" } },
      },
    })
    .edge("tech", "mem", "access", { access: "read_write" });
  return b.doc;
}

function invoices(): SystemDoc {
  const b = new Builder(
    "Invoice extraction",
    "No agents at all: a bare model call extracts fields as JSON, a function checks the totals and routes the invoice, and a human only sees the ones that do not add up.",
  );
  b.schema({ id: "Invoice", description: "Fields pulled from an invoice", json_schema: '{\n  "type": "object",\n  "required": ["vendor", "total", "lines"],\n  "properties": {\n    "vendor": { "type": "string" },\n    "total": { "type": "number" },\n    "lines": { "type": "array", "items": { "type": "object", "properties": { "amount": { "type": "number" } } } }\n  }\n}' })
    .node("inbox", "human", 0, 60, { name: "Accounts inbox", role: "Drops invoice PDFs", approves: false })
    .node("extract", "model", 270, 50, {
      name: "Extract fields",
      model: "sonnet",
      system_prompt: "Extract invoice fields. Reply with JSON only.",
      prompt: "{{input}}",
      temperature: 0,
      interface: { inputs: [port("pdf", "file")], outputs: [port("fields", "json", { schema: "Invoice" })] },
    })
    .node("check", "function", 600, 50, {
      name: "Check totals",
      fn: { lang: "js", code: "const sum = input.lines.reduce((a, l) => a + l.amount, 0);\nreturn Math.abs(sum - input.total) < 0.01 ? { ok: input } : { mismatch: input };" },
      interface: { inputs: [port("in", "json", { schema: "Invoice" })], outputs: [port("ok", "json", { schema: "Invoice" }), port("mismatch", "json", { schema: "Invoice" })] },
    })
    .node("ledger", "env", 960, -60, { name: "Ledger DB", env_kind: "database", image: "", lifecycle: "persistent", snapshot: "on_write" })
    .node("clerk", "human", 960, 160, { name: "Clerk", role: "Fixes mismatched invoices" })
    .edge("inbox", "extract", "message", { target_port: "pdf" })
    .edge("extract", "check", "message")
    .edge("check", "clerk", "message", { source_port: "mismatch", label: "Totals do not add up", transform: { lang: "template", code: "{{input.vendor}}: lines sum differs from total {{input.total}}" } })
    .edge("clerk", "ledger", "access", { access: "read_write" });
  b.doc.budget = { usd: 1, max_rounds: 20, wallclock_min: 10 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

export interface TemplateInfo {
  id: string;
  name: string;
  summary: string;
  build: () => SystemDoc;
}

export const TEMPLATES: TemplateInfo[] = [
  { id: "blank", name: "Blank system", summary: "Start from scratch", build: () => emptySystem() },
  { id: "debate", name: "Debate with a judge", summary: "room env · output wrapper parses a Verdict", build: debate },
  { id: "coding", name: "Coding team", summary: "Claude Code · gate · routed outputs · edge transform", build: codingTeam },
  { id: "research", name: "Research team", summary: "Group ports · spawn · bare model call", build: research },
  { id: "support", name: "Support triage", summary: "function node · routed handoffs · approval", build: support },
  { id: "invoices", name: "Invoice extraction", summary: "model + function only, no agents", build: invoices },
];

/** Names of the templates seeded by earlier versions (0.1, Chinese UI); stored copies are replaced on upgrade. */
export const LEGACY_SEED_NAMES = ["\u8fa9\u8bba\u52a0\u88c1\u5224", "\u5171\u4eab\u4ed3\u5e93\u7684\u7f16\u7a0b\u56e2\u961f", "\u52a8\u6001\u62db\u52df\u7684\u7814\u7a76\u56e2\u961f", "\u5ba2\u670d\u5206\u8bca\u8f6c\u63a5"];
