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
      issues.push({ severity: "error", message: `Edge ${e.id} points to a node that does not exist`, edgeId: e.id });
    }
  }

  const agents = doc.nodes.filter((n) => n.data.kind === "agent") as SysNode<AgentData>[];
  if (agents.length === 0) issues.push({ severity: "info", message: "There are no agents yet. Drag one in from the left." });

  for (const n of agents) {
    const a = n.data;
    const label = `"${a.name}"`;
    const runner = runnerById(a.harness.runner);
    if (!touching(n.id).length) issues.push({ severity: "warning", message: `${label} has no connections, so it is never woken and cannot talk to anyone`, nodeId: n.id });
    if ((a.harness.tier === "native" || a.harness.tier === "sdk") && !modelIds.has(a.model)) {
      issues.push({ severity: "error", message: `${label} uses model ${a.model || "(empty)"}, which is not in the model catalog`, nodeId: n.id });
    }
    if (a.harness.tier !== "native" && !runner) issues.push({ severity: "error", message: `${label} has no harness adapter selected`, nodeId: n.id });
    if (a.harness.tier === "process" && !a.harness.command && a.harness.runner !== "claude-code" && a.harness.runner !== "codex") {
      issues.push({ severity: "warning", message: `${label} uses a process harness and needs a launch command`, nodeId: n.id });
    }
    if (a.harness.tier === "remote" && !a.harness.url) issues.push({ severity: "warning", message: `${label} is a remote agent and needs an Agent Card URL`, nodeId: n.id });
    if (a.harness.capabilities.context_control === "none" && (a.context.sources.some((s) => s.mode === "auto_inject") || a.context.history_strategy !== "window_then_summary")) {
      issues.push({ severity: "info", message: `${label}'s harness does not expose context control: context settings apply only through message prefixes and MCP tools`, nodeId: n.id });
    }
    if (a.tools.length && a.harness.capabilities.tool_injection.length === 0) {
      issues.push({ severity: "warning", message: `${label}'s harness cannot inject tools, so its ${a.tools.length} configured tool(s) are unusable`, nodeId: n.id });
    }
    for (const t of a.tools) {
      const tool = toolById.get(t);
      if (!tool) {
        issues.push({ severity: "error", message: `${label} uses a tool that does not exist: ${t}`, nodeId: n.id });
        continue;
      }
      if (tool.needs_env && tool.needs_env !== "external") {
        const hasEnv = doc.edges.some((e) => e.kind === "access" && e.source === n.id && byId.get(e.target)?.data.kind === "env" && (byId.get(e.target)!.data as { env_kind: string }).env_kind === tool.needs_env);
        if (!hasEnv) issues.push({ severity: "warning", message: `${label}'s tool ${t} needs a ${tool.needs_env} env, but ${label} is not connected to one`, nodeId: n.id });
      }
      if (tool.effect === "irreversible") {
        const approver = doc.edges.some((e) => e.source === n.id && byId.get(e.target)?.data.kind === "human");
        if (!approver) issues.push({ severity: "warning", message: `${label} has the irreversible action ${t} but is not connected to a human approver (human approval is required by default)`, nodeId: n.id });
      }
    }
    for (const s of a.context.sources) {
      if (!byId.has(s.store)) issues.push({ severity: "error", message: `${label}'s context source ${s.store} does not exist`, nodeId: n.id });
    }
    if (a.spawn && !byId.has(a.spawn.template)) issues.push({ severity: "error", message: `${label}'s spawn template ${a.spawn.template} does not exist`, nodeId: n.id });
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
        issues.push({ severity: "warning", message: `"${s.data.name}" may forward ${missing.join(", ")}, which "${t.data.name}" does not support and is set to reject`, edgeId: e.id });
      }
    }
    if (t && (t.data.kind === "env" || t.data.kind === "store")) {
      issues.push({ severity: "error", message: `Edges to a ${t.data.kind} must be access edges`, edgeId: e.id });
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
      issues.push({ severity: "error", message: "call edges form a cycle: agents waiting on each other will deadlock. Change at least one to message" });
      break;
    }
  }

  for (const n of doc.nodes) {
    if (n.data.kind === "channel") {
      const c = n.data as ChannelData;
      const members = touching(n.id).length;
      if (members < 2) issues.push({ severity: "warning", message: `Room "${c.name}" has only ${members} member(s)`, nodeId: n.id });
      if (c.policy === "selector" && !c.selector) issues.push({ severity: "warning", message: `Room "${c.name}" uses the selector policy and needs a moderator`, nodeId: n.id });
    }
    if (n.data.kind === "group") {
      const g = n.data as GroupData;
      const members = doc.nodes.filter((m) => m.parent === n.id);
      if (!members.length) issues.push({ severity: "warning", message: `Group "${g.name}" has no members yet`, nodeId: n.id });
      else if (!members.some((m) => m.id === g.entry)) issues.push({ severity: "warning", message: `Group "${g.name}" has no entry member`, nodeId: n.id });
    }
    if (n.data.kind === "store" || n.data.kind === "env") {
      if (!touching(n.id).length) issues.push({ severity: "info", message: `"${nameOf(n)}" is not used by any agent`, nodeId: n.id });
    }
  }

  for (const e of doc.edges) {
    if (e.gate && !e.gate.condition.trim()) issues.push({ severity: "warning", message: `Gate "${e.gate.name}" has no condition`, edgeId: e.id });
  }

  if (doc.budget.usd == null && doc.budget.max_rounds == null) {
    issues.push({ severity: "warning", message: "The system has no budget or round limit and may run forever" });
  }
  return issues;
}
