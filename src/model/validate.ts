import { runnerById } from "./defaults";
import type { AgentData, ChannelData, GroupData, SysNode, SystemDoc } from "./types";

export type Severity = "error" | "warning" | "info";
export interface Issue {
  severity: Severity;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

const nameOf = (n: SysNode) => ("name" in n.data ? n.data.name : n.id);

/** Static checks of a system definition (what the canvas flags while you build). */
export function validate(doc: SystemDoc): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const touching = (id: string) => doc.edges.filter((e) => e.source === id || e.target === id);
  const modelIds = new Set(doc.models.map((m) => m.id));
  const toolById = new Map(doc.tools.map((t) => [t.id, t]));

  for (const e of doc.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      issues.push({ severity: "error", message: `连线 ${e.id} 指向不存在的节点`, edgeId: e.id });
    }
  }

  const agents = doc.nodes.filter((n) => n.data.kind === "agent") as SysNode<AgentData>[];
  if (agents.length === 0) issues.push({ severity: "info", message: "系统里还没有 agent。从左侧拖一个进来。" });

  for (const n of agents) {
    const a = n.data;
    const label = `「${a.name}」`;
    const runner = runnerById(a.harness.runner);
    if (!touching(n.id).length) issues.push({ severity: "warning", message: `${label}没有任何连线，不会被唤醒，也无法和别人通信`, nodeId: n.id });
    if ((a.harness.tier === "native" || a.harness.tier === "sdk") && !modelIds.has(a.model)) {
      issues.push({ severity: "error", message: `${label}引用的模型 ${a.model || "（空）"} 不在模型目录里`, nodeId: n.id });
    }
    if (a.harness.tier !== "native" && !runner) issues.push({ severity: "error", message: `${label}没有选择 harness 适配器`, nodeId: n.id });
    if (a.harness.tier === "process" && !a.harness.command && a.harness.runner !== "claude-code" && a.harness.runner !== "codex") {
      issues.push({ severity: "warning", message: `${label}是 process 级 harness，需要填写启动命令`, nodeId: n.id });
    }
    if (a.harness.tier === "remote" && !a.harness.url) issues.push({ severity: "warning", message: `${label}是远程 agent，需要填写 Agent Card 地址`, nodeId: n.id });
    if (a.harness.capabilities.context_control === "none" && (a.context.sources.some((s) => s.mode === "auto_inject") || a.context.history_strategy !== "window_then_summary")) {
      issues.push({ severity: "info", message: `${label}的 harness 不开放上下文控制：上下文设置只通过消息前缀和 MCP tool 生效`, nodeId: n.id });
    }
    if (a.tools.length && a.harness.capabilities.tool_injection.length === 0) {
      issues.push({ severity: "warning", message: `${label}的 harness 不支持注入 tool，配置的 ${a.tools.length} 个 tool 用不了`, nodeId: n.id });
    }
    for (const t of a.tools) {
      const tool = toolById.get(t);
      if (!tool) {
        issues.push({ severity: "error", message: `${label}引用了不存在的 tool：${t}`, nodeId: n.id });
        continue;
      }
      if (tool.needs_env && tool.needs_env !== "external") {
        const hasEnv = doc.edges.some((e) => e.kind === "access" && e.source === n.id && byId.get(e.target)?.data.kind === "env" && (byId.get(e.target)!.data as { env_kind: string }).env_kind === tool.needs_env);
        if (!hasEnv) issues.push({ severity: "warning", message: `${label}的 tool ${t} 需要一个 ${tool.needs_env} 类型的 env，但 ${label}没有连到这样的 env`, nodeId: n.id });
      }
      if (tool.effect === "irreversible") {
        const approver = doc.edges.some((e) => e.source === n.id && byId.get(e.target)?.data.kind === "human");
        if (!approver) issues.push({ severity: "warning", message: `${label}有不可逆动作 ${t}，但没有连到任何人做审批（默认需要人工审批）`, nodeId: n.id });
      }
    }
    for (const s of a.context.sources) {
      if (!byId.has(s.store)) issues.push({ severity: "error", message: `${label}的上下文来源 ${s.store} 不存在`, nodeId: n.id });
    }
    if (a.spawn && !byId.has(a.spawn.template)) issues.push({ severity: "error", message: `${label}的招募模板 ${a.spawn.template} 不存在`, nodeId: n.id });
  }

  // modality mismatch on direct message/call/handoff edges
  for (const e of doc.edges) {
    if (e.kind === "access") continue;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (s?.data.kind === "agent" && t?.data.kind === "agent") {
      const out = s.data.modalities_in.filter((m) => m !== "text");
      const missing = out.filter((m) => !(t.data as AgentData).modalities_in.includes(m));
      if (missing.length && (t.data as AgentData).on_unsupported === "reject") {
        issues.push({ severity: "warning", message: `「${s.data.name}」可能转发 ${missing.join("、")}，「${t.data.name}」不支持且设为拒收`, edgeId: e.id });
      }
    }
    if (t && (t.data.kind === "env" || t.data.kind === "store")) {
      issues.push({ severity: "error", message: `连到 ${t.data.kind} 的连线必须是 access 类型`, edgeId: e.id });
    }
  }

  // call cycles
  const callAdj = new Map<string, string[]>();
  for (const e of doc.edges.filter((x) => x.kind === "call")) callAdj.set(e.source, [...(callAdj.get(e.source) ?? []), e.target]);
  const seen = new Set<string>();
  const stack = new Set<string>();
  const dfs = (v: string): boolean => {
    if (stack.has(v)) return true;
    if (seen.has(v)) return false;
    seen.add(v);
    stack.add(v);
    for (const w of callAdj.get(v) ?? []) if (dfs(w)) return true;
    stack.delete(v);
    return false;
  };
  for (const v of callAdj.keys()) {
    if (dfs(v)) {
      issues.push({ severity: "error", message: "call 连线形成了环：互相同步等待会死锁，至少把一条改成 message" });
      break;
    }
  }

  for (const n of doc.nodes) {
    if (n.data.kind === "channel") {
      const c = n.data as ChannelData;
      const members = touching(n.id).length;
      if (members < 2) issues.push({ severity: "warning", message: `Room「${c.name}」只有 ${members} 个成员`, nodeId: n.id });
      if (c.policy === "selector" && !c.selector) issues.push({ severity: "warning", message: `Room「${c.name}」使用 selector 策略，需要指定主持者`, nodeId: n.id });
    }
    if (n.data.kind === "group") {
      const g = n.data as GroupData;
      const members = doc.nodes.filter((m) => m.parent === n.id);
      if (!members.length) issues.push({ severity: "warning", message: `Group「${g.name}」里还没有成员`, nodeId: n.id });
      else if (!members.some((m) => m.id === g.entry)) issues.push({ severity: "warning", message: `Group「${g.name}」没有设置入口成员`, nodeId: n.id });
    }
    if (n.data.kind === "store" || n.data.kind === "env") {
      if (!touching(n.id).length) issues.push({ severity: "info", message: `「${nameOf(n)}」没有被任何 agent 使用`, nodeId: n.id });
    }
  }

  for (const e of doc.edges) {
    if (e.gate && !e.gate.condition.trim()) issues.push({ severity: "warning", message: `Gate「${e.gate.name}」没有填写条件`, edgeId: e.id });
  }

  if (doc.budget.usd == null && doc.budget.max_rounds == null) {
    issues.push({ severity: "warning", message: "系统没有预算或轮数上限，可能无限运行" });
  }
  return issues;
}
