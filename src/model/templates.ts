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
  const b = new Builder("辩论加裁判", "正反方在同一个 room 里轮流发言，裁判每三轮评一次，给出结论即结束。");
  b.agent("pro", 40, 60, { name: "正方", role: "为命题辩护", model: "sonnet", harness: { ...defaultAgent().harness, instructions: "你是正方。每次发言针对对方上一轮的论点，给出一个新论据。" } })
    .agent("con", 40, 300, { name: "反方", role: "反驳命题", model: "sonnet", harness: { ...defaultAgent().harness, instructions: "你是反方。指出正方论证中最薄弱的一环。" } })
    .agent("judge", 620, 180, { name: "裁判", role: "评判并决定何时结束", model: "opus", harness: { ...defaultAgent().harness, loop: "single_shot", instructions: "每三轮评估一次。若一方明显占优，输出 verdict；否则输出 null。" } })
    .node("arena", "channel", 340, 190, { name: "arena", policy: "round_robin", history: "persistent" })
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
    "共享仓库的编程团队",
    "planner 在看板上拆任务；coder（Claude Code）在共享仓库里实现；测试通过才能交给 reviewer（任意 ACP agent）；合并需要 PM 审批。",
  );
  const native = defaultAgent().harness;
  b.agent("planner", 40, 40, { name: "Planner", role: "拆分任务、分配到看板", model: "opus", tools: [], harness: { ...native, loop: "plan_execute", instructions: "把需求拆成可独立验证的任务卡，写到看板上并指派。" } })
    .agent("coder", 380, 200, {
      name: "Coder",
      role: "实现任务",
      model: "opus",
      tools: ["run_tests"],
      triggers: ["on_state", "on_message"],
      harness: { ...native, tier: "process", runner: "claude-code", loop: undefined, instructions: "认领看板上指派给你的任务，在 /work 中实现并让测试通过。", own_memory: "disable" },
    })
    .agent("reviewer", 760, 40, {
      name: "Reviewer",
      role: "代码评审",
      model: "sonnet",
      tools: ["merge_pr"],
      triggers: ["on_handoff"],
      harness: { ...native, tier: "process", runner: "acp", loop: undefined, command: "<任意支持 ACP 的 agent 启动命令>", instructions: "审查改动；通过则提交合并请求。" },
    })
    .node("pm", "human", 1060, 220, { name: "PM", role: "批准合并" })
    .node("repo", "env", 380, 420, { name: "repo", env_kind: "sandbox", image: "node:22", egress: ["registry.npmjs.org", "github.com"] })
    .node("board", "store", 40, 300, { name: "看板", store_kind: "board", scope: "system" })
    .node("team", "channel", 720, 300, { name: "team", policy: "mention" })
    .edge("planner", "board", "access", { access: "read_write" })
    .edge("coder", "board", "access", { access: "read_write" })
    .edge("coder", "repo", "access", { access: "read_write" })
    .edge("reviewer", "repo", "access", { access: "read" })
    .edge("coder", "reviewer", "handoff", {
      carry: "summary",
      label: "提交评审",
      gate: { name: "tests_pass", condition: "check: npm test", on_fail: "block", escalate_after: 3 },
    })
    .edge("reviewer", "pm", "call", { label: "请求批准合并" })
    .edge("planner", "team", "message")
    .edge("coder", "team", "message")
    .edge("reviewer", "team", "message")
    .edge("pm", "team", "message");
  b.doc.budget = { usd: 20, max_rounds: 200, wallclock_min: 120 };
  return b.doc;
}

function research(): SystemDoc {
  const b = new Builder(
    "动态招募的研究团队",
    "lead 拆分问题，按需招募 searcher 并行检索，writer 汇总成报告。整个团队封装为一个 Group，对外只暴露问题和报告。",
  );
  const native = defaultAgent().harness;
  b.group("team", 260, 30, 560, 380, { name: "研究团队", entry: "lead", output_from: "writer", budget_usd: 3 })
    .agent("lead", 30, 60, { name: "Lead", role: "拆分问题、招募检索员", model: "opus", spawn: { template: "searcher", max_instances: 6 }, harness: { ...native, loop: "plan_execute", instructions: "把问题拆成 3-6 个子问题，每个子问题招募一个 searcher 并行检索。" } }, "team")
    .agent("searcher", 300, 60, { name: "Searcher（模板）", role: "检索一个子问题", model: "haiku", tools: ["web_search", "fetch"], harness: { ...native, instructions: "只回答分配给你的子问题，附来源。" } }, "team")
    .agent("writer", 170, 250, { name: "Writer", role: "汇总成报告", model: "sonnet", harness: { ...native, loop: "single_shot", instructions: "把检索结果整合成一份有来源的报告。" } }, "team")
    .node("asker", "human", 30, 180, { name: "提问者", role: "提出研究问题", approves: false })
    .node("kb", "store", 900, 180, { name: "知识库", store_kind: "knowledge", backend: "builtin", scope: "system", write: "none", sources: ["./docs"] })
    .edge("asker", "team", "call", { label: "研究问题 → 报告" })
    .edge("lead", "searcher", "call", { label: "子问题" })
    .edge("lead", "writer", "handoff", { carry: "full" })
    .edge("writer", "kb", "access", { access: "read" });
  const writer = b.doc.nodes.find((n) => n.id === "writer")!.data as AgentData;
  writer.context.sources = [{ store: "kb", mode: "auto_inject", top_k: 5 }];
  b.doc.budget = { usd: 3, max_rounds: 60, wallclock_min: 20 };
  return b.doc;
}

function support(): SystemDoc {
  const b = new Builder("客服分诊转接", "分诊 agent 判断意图后转接给账单或技术专员；退款需要人工审批；按最终用户记住历史。");
  const native = defaultAgent().harness;
  b.node("customer", "human", 20, 180, { name: "客户", role: "最终用户", approves: false })
    .agent("triage", 260, 180, { name: "分诊", role: "识别意图并转接", model: "haiku", harness: { ...native, loop: "single_shot", instructions: "判断用户意图：账单、技术、其他。转接给对应专员。" }, modalities_in: ["text", "image"] })
    .agent("billing", 560, 60, { name: "账单专员", role: "处理账单与退款", model: "sonnet", tools: ["issue_refund"], harness: { ...native, instructions: "核实订单后处理；退款需要审批。" } })
    .agent("tech", 560, 300, { name: "技术专员", role: "排查技术问题", model: "sonnet", tools: ["web_search"], harness: { ...native, instructions: "按排查手册逐步定位问题。" } })
    .node("lead", "human", 860, 60, { name: "客服主管", role: "审批退款" })
    .node("mem", "store", 860, 300, { name: "用户记忆", store_kind: "memory", scope: "end_user", write: "auto_extract" })
    .edge("customer", "triage", "message")
    .edge("triage", "billing", "handoff", { carry: "summary" })
    .edge("triage", "tech", "handoff", { carry: "summary" })
    .edge("billing", "lead", "call", { label: "退款审批" })
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
  { id: "blank", name: "空白系统", summary: "从零开始搭建", build: () => emptySystem() },
  { id: "debate", name: "辩论加裁判", summary: "room · round_robin · 终止 policy", build: debate },
  { id: "coding", name: "编程团队", summary: "共享仓库 · Claude Code · gate · 人工审批", build: codingTeam },
  { id: "research", name: "研究团队", summary: "Group 封装 · 动态招募 · 知识库", build: research },
  { id: "support", name: "客服分诊", summary: "handoff · 用户记忆 · 不可逆动作审批", build: support },
];
