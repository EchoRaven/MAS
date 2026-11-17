import { defaultAgent, defaultData, emptySystem, RUNNERS } from "./defaults";
import type { AgentData, EdgeKind, NodeData, SysEdge, SysNode, SystemDoc } from "./types";

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
  node(id: string, kind: Exclude<NodeData["kind"], "agent">, x: number, y: number, patch: Record<string, unknown> = {}, parent?: string) {
    const data = { ...defaultData(kind), ...patch } as NodeData;
    this.doc.nodes.push({ id, position: { x, y }, parent, data });
    return this;
  }
  group(id: string, x: number, y: number, w: number, h: number, patch: Record<string, unknown>) {
    const data = { ...defaultData("group"), ...patch } as NodeData;
    // groups must come before their members (canvas requirement)
    this.doc.nodes.unshift({ id, position: { x, y }, size: { width: w, height: h }, data } as SysNode);
    return this;
  }
  edge(source: string, target: string, kind: EdgeKind, extra: Partial<SysEdge> = {}) {
    this.doc.edges.push({ id: `e${++this.n}`, source, target, kind, ...extra });
    return this;
  }
}

function debate(): SystemDoc {
  const b = new Builder("Debate with a judge", "Pro and con take turns in one room; the judge scores every three rounds and the run ends once there is a verdict.");
  b.agent("pro", 0, 0, { name: "Pro", role: "Argues for the motion", model: "sonnet", harness: { ...defaultAgent().harness, instructions: "You argue for the motion. Each turn, answer the other side's last point with one new argument." } })
    .agent("con", 0, 240, { name: "Con", role: "Argues against the motion", model: "sonnet", harness: { ...defaultAgent().harness, instructions: "You argue against the motion. Point out the weakest link in the pro side's case." } })
    .agent("judge", 560, 120, { name: "Judge", role: "Scores and decides when to stop", model: "opus", harness: { ...defaultAgent().harness, loop: "single_shot", instructions: "Evaluate every three rounds. If one side is clearly ahead, output a verdict; otherwise output null." } })
    .node("arena", "channel", 320, 140, { name: "arena", policy: "round_robin", history: "persistent" })
    .edge("pro", "arena", "message")
    .edge("con", "arena", "message")
    .edge("judge", "arena", "message");
  b.doc.budget = { usd: 2, max_rounds: 12, wallclock_min: 10 };
  b.doc.termination = ["judge_outputs_verdict", "max_rounds"];
  b.doc.policies = [{ id: "p1", on: "output(judge)", condition: "output.verdict != null", action: "terminate" }];
  return b.doc;
}

function codingTeam(): SystemDoc {
  const b = new Builder(
    "Coding team on a shared repo",
    "The planner splits work into board tasks; the coder (Claude Code) implements them in the shared repo; work reaches the reviewer (any ACP agent) only once tests pass; merging needs PM approval.",
  );
  const native = defaultAgent().harness;
  b.agent("planner", 0, 20, { name: "Planner", role: "Splits work into tasks on the board", model: "opus", tools: [], harness: { ...native, loop: "plan_execute", instructions: "Break the request into independently verifiable task cards, post them on the board and assign them." } })
    .agent("coder", 300, 150, {
      name: "Coder",
      role: "Implements tasks",
      model: "opus",
      tools: ["run_tests"],
      triggers: ["on_state", "on_message"],
      harness: { ...native, tier: "process", runner: "claude-code", loop: undefined, instructions: "Pick up the board tasks assigned to you, implement them in /work and make the tests pass.", own_memory: "disable" },
    })
    .agent("reviewer", 600, 20, {
      name: "Reviewer",
      role: "Reviews code",
      model: "sonnet",
      tools: ["merge_pr"],
      triggers: ["on_handoff"],
      harness: { ...native, tier: "process", runner: "acp", loop: undefined, command: "<launch command of any ACP-capable agent>", instructions: "Review the change; if it is good, request a merge." },
    })
    .node("pm", "human", 620, 320, { name: "PM", role: "Approves merges" })
    .node("repo", "env", 315, 330, { name: "repo", env_kind: "sandbox", image: "node:22", egress: ["registry.npmjs.org", "github.com"] })
    .node("board", "store", 20, 250, { name: "Board", store_kind: "board", scope: "system" })
    .node("team", "channel", 640, 190, { name: "team", policy: "mention" })
    .edge("planner", "board", "access", { access: "read_write" })
    .edge("coder", "board", "access", { access: "read_write" })
    .edge("coder", "repo", "access", { access: "read_write" })
    .edge("reviewer", "repo", "access", { access: "read" })
    .edge("coder", "reviewer", "handoff", {
      carry: "summary",
      label: "Submit for review",
      gate: { name: "tests_pass", condition: "check: npm test", on_fail: "block", escalate_after: 3 },
    })
    .edge("reviewer", "pm", "call", { label: "Request merge approval" })
    .edge("planner", "team", "message")
    .edge("coder", "team", "message")
    .edge("reviewer", "team", "message")
    .edge("pm", "team", "message");
  b.doc.budget = { usd: 20, max_rounds: 200, wallclock_min: 120 };
  return b.doc;
}

function research(): SystemDoc {
  const b = new Builder(
    "Research team with spawning",
    "The lead splits the question and spawns searchers to work in parallel; the writer turns the findings into a report. The team is wrapped in a Group that exposes only the question and the report.",
  );
  const native = defaultAgent().harness;
  b.group("team", 230, 0, 540, 360, { name: "Research team", entry: "lead", output_from: "writer", budget_usd: 3 })
    .agent("lead", 20, 50, { name: "Lead", role: "Splits the question, spawns searchers", model: "opus", spawn: { template: "searcher", max_instances: 6 }, harness: { ...native, loop: "plan_execute", instructions: "Split the question into 3-6 sub-questions and spawn one searcher per sub-question to search in parallel." } }, "team")
    .agent("searcher", 296, 50, { name: "Searcher (template)", role: "Researches one sub-question", model: "haiku", tools: ["web_search", "fetch"], harness: { ...native, instructions: "Answer only the sub-question you were given, with sources." } }, "team")
    .agent("writer", 160, 240, { name: "Writer", role: "Writes the report", model: "sonnet", harness: { ...native, loop: "single_shot", instructions: "Combine the search results into one sourced report." } }, "team")
    .node("asker", "human", 0, 150, { name: "Asker", role: "Poses the research question", approves: false })
    .node("kb", "store", 410, 420, { name: "Knowledge base", store_kind: "knowledge", backend: "builtin", scope: "system", write: "none", sources: ["./docs"] })
    .edge("asker", "team", "call", { label: "Question → report" })
    .edge("lead", "searcher", "call", { label: "Sub-question" })
    .edge("lead", "writer", "handoff", { carry: "full" })
    .edge("writer", "kb", "access", { access: "read" });
  const writer = b.doc.nodes.find((n) => n.id === "writer")!.data as AgentData;
  writer.context.sources = [{ store: "kb", mode: "auto_inject", top_k: 5 }];
  b.doc.budget = { usd: 3, max_rounds: 60, wallclock_min: 20 };
  return b.doc;
}

function support(): SystemDoc {
  const b = new Builder("Support triage", "A triage agent detects intent and hands off to billing or tech support; refunds need human approval; history is remembered per end user.");
  const native = defaultAgent().harness;
  b.node("customer", "human", 0, 170, { name: "Customer", role: "End user", approves: false })
    .agent("triage", 220, 160, { name: "Triage", role: "Detects intent and routes", model: "haiku", harness: { ...native, loop: "single_shot", instructions: "Classify the user's intent as billing, technical or other, and hand off to the matching specialist." }, modalities_in: ["text", "image"] })
    .agent("billing", 500, 30, { name: "Billing", role: "Handles billing and refunds", model: "sonnet", tools: ["issue_refund"], harness: { ...native, instructions: "Verify the order before acting; refunds need approval." } })
    .agent("tech", 500, 290, { name: "Tech support", role: "Troubleshoots technical issues", model: "sonnet", tools: ["web_search"], harness: { ...native, instructions: "Work through the troubleshooting playbook step by step." } })
    .node("lead", "human", 780, 50, { name: "Support lead", role: "Approves refunds" })
    .node("mem", "store", 780, 310, { name: "User memory", store_kind: "memory", scope: "end_user", write: "auto_extract" })
    .edge("customer", "triage", "message")
    .edge("triage", "billing", "handoff", { carry: "summary" })
    .edge("triage", "tech", "handoff", { carry: "summary" })
    .edge("billing", "lead", "call", { label: "Refund approval" })
    .edge("billing", "mem", "access", { access: "read_write" })
    .edge("tech", "mem", "access", { access: "read_write" });
  for (const id of ["billing", "tech"]) {
    (b.doc.nodes.find((n) => n.id === id)!.data as AgentData).context.sources = [{ store: "mem", mode: "auto_inject", top_k: 8 }];
  }
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
  { id: "debate", name: "Debate with a judge", summary: "room · round_robin · termination policy", build: debate },
  { id: "coding", name: "Coding team", summary: "shared repo · Claude Code · gate · human approval", build: codingTeam },
  { id: "research", name: "Research team", summary: "Group · spawn · knowledge base", build: research },
  { id: "support", name: "Support triage", summary: "handoff · user memory · approval for irreversible actions", build: support },
];
