import { runnerById } from "./defaults";
import { compat, edgeScope, interfaceOf, isResource, nodeName, sourcePort, targetPort, usesResources } from "./ports";
import type { AgentData, EnvData, FunctionNodeData, GroupData, ModelNodeData, PortSpec, SysNode, SystemDoc } from "./types";
import { RES_PORT } from "./types";
import { validatePipelines } from "./validatePipelines";

export type Severity = "error" | "warning" | "info";
export interface Issue {
  severity: Severity;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

const PORT_ID = /^[a-z][a-z0-9_]*$/;

/** Static checks of a system definition (what the canvas flags while you build). */
export function validate(doc: SystemDoc): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, message: string, at: { nodeId?: string; edgeId?: string } = {}) => issues.push({ severity, message, ...at });
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const touching = (id: string) => doc.edges.filter((e) => e.source === id || e.target === id);
  const modelIds = new Set(doc.models.map((m) => m.id));
  const schemaIds = new Set(doc.schemas.map((s) => s.id));
  const toolById = new Map(doc.tools.map((t) => [t.id, t]));
  const q = (n: SysNode) => `"${nodeName(n)}"`;

  // ---- interfaces
  for (const n of doc.nodes) {
    const ifc = interfaceOf(n.data);
    const all: PortSpec[] = [...ifc.inputs, ...ifc.outputs];
    const seen = new Set<string>();
    for (const p of all) {
      if (!PORT_ID.test(p.id)) add("error", `${q(n)} has a port named "${p.id}": use lowercase letters, digits and _`, { nodeId: n.id });
      if (p.id === RES_PORT) add("error", `${q(n)}: "${RES_PORT}" is reserved for access edges`, { nodeId: n.id });
      if (seen.has(p.id)) add("error", `${q(n)} has two ports named "${p.id}" (port names must be unique across inputs and outputs)`, { nodeId: n.id });
      seen.add(p.id);
      if (p.type === "json" && p.schema && !schemaIds.has(p.schema)) add("error", `${q(n)} port "${p.id}" uses schema ${p.schema}, which is not defined`, { nodeId: n.id });
    }
    if (n.data.kind === "group") continue; // group ports are checked below, from both sides
    for (const p of ifc.inputs.filter((x) => x.required)) {
      if (!doc.edges.some((e) => e.target === n.id && e.target_port === p.id)) add("warning", `${q(n)} input "${p.id}" is required but nothing is connected to it`, { nodeId: n.id });
    }
  }

  // ---- edges
  for (const e of doc.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      add("error", `Edge ${e.id} points to a node that does not exist`, { edgeId: e.id });
      continue;
    }
    if (e.kind === "access") {
      const b = e.binding;
      for (const [what, fn] of [["query", b?.read?.query], ["format", b?.read?.format], ["write extract", b?.write?.extract]] as const) {
        if (fn && !fn.code.trim()) add("warning", `${q(s)} → ${q(t)}: the ${what} function is empty`, { edgeId: e.id });
      }
      if (b?.write?.when && b.write.when !== "never" && e.access === "read") add("warning", `${q(s)} → ${q(t)} is read-only but its binding writes (${b.write.when})`, { edgeId: e.id });
      const mcpTools = t.data.kind === "env" ? (t.data.manifest?.exposes.mcp?.tools ?? []) : [];
      for (const tool of b?.tools ?? []) if (mcpTools.length && !mcpTools.includes(tool)) add("warning", `${q(t)} does not expose a tool named ${tool}`, { edgeId: e.id });
      if (!usesResources(s.data.kind) || !isResource(t.data.kind)) add("error", `Access edges run from an agent or human to an env or plugin (${q(s)} → ${q(t)})`, { edgeId: e.id });
      else if (s.parent !== t.parent) add("error", `${q(s)} uses ${q(t)}, which is on another canvas. Move the resource into the same group`, { edgeId: e.id });
      continue;
    }
    if (isResource(t.data.kind) || isResource(s.data.kind)) {
      add("error", `Edges to an ${isResource(t.data.kind) ? t.data.kind : s.data.kind} must be access edges`, { edgeId: e.id });
      continue;
    }
    const sp = sourcePort(doc, e);
    const tp = targetPort(doc, e);
    if (!sp) add("error", `${q(s)} has no output port "${e.source_port}"`, { edgeId: e.id });
    if (!tp) add("error", `${q(t)} has no input port "${e.target_port}"`, { edgeId: e.id });
    if (sp && tp) {
      if (edgeScope(doc, e) === null) add("error", `${q(s)} → ${q(t)} crosses a group boundary. Connect through the group's ports`, { edgeId: e.id });
      const name = (id: string) => id;
      const c = compat(sp, tp, name);
      if (e.transform) {
        if (!e.transform.code.trim()) add("warning", `The transform on ${q(s)} → ${q(t)} is empty`, { edgeId: e.id });
      } else if (c.level === "needs_transform") {
        add("error", `${q(s)}.${sp.id} → ${q(t)}.${tp.id}: ${c.note}`, { edgeId: e.id });
      }
    }
    if ((e.kind === "call" || e.kind === "handoff") && !(t.data.kind === "agent" || t.data.kind === "human" || t.data.kind === "group" || t.data.kind === "model")) {
      add("warning", `A ${e.kind} expects a reply or a new owner; a ${t.data.kind} gives neither. Use message`, { edgeId: e.id });
    }
    if (e.gate && !e.gate.condition.trim()) add("warning", `Gate "${e.gate.name}" has no condition`, { edgeId: e.id });
  }

  // ---- agents
  const agents = doc.nodes.filter((n) => n.data.kind === "agent") as SysNode<AgentData>[];
  if (doc.nodes.length === 0) add("info", "The canvas is empty. Add components from the toolbar on the left.");

  for (const n of agents) {
    const a = n.data;
    const label = q(n);
    const runner = runnerById(a.harness.runner);
    if (!touching(n.id).length) add("warning", `${label} has no connections, so it is never woken and cannot talk to anyone`, { nodeId: n.id });
    if ((a.harness.tier === "native" || a.harness.tier === "sdk") && !modelIds.has(a.model)) add("error", `${label} uses model ${a.model || "(empty)"}, which is not in the model catalog`, { nodeId: n.id });
    if (a.harness.tier !== "native" && !runner) add("error", `${label} has no harness adapter selected`, { nodeId: n.id });
    if (a.harness.tier === "process" && !a.harness.command && a.harness.runner !== "claude-code" && a.harness.runner !== "codex") add("warning", `${label} uses a process harness and needs a launch command`, { nodeId: n.id });
    if (a.harness.tier === "remote" && !a.harness.url) add("warning", `${label} is a remote agent and needs an Agent Card URL`, { nodeId: n.id });
    if (a.harness.capabilities.context_control === "none" && (doc.edges.some((e) => e.kind === "access" && e.source === n.id && e.binding?.mode === "auto_inject") || a.context.history_strategy !== "window_then_summary")) {
      add("info", `${label}'s harness does not expose context control: context settings apply only through message prefixes and MCP tools`, { nodeId: n.id });
    }
    if (a.tools.length && a.harness.capabilities.tool_injection.length === 0) add("warning", `${label}'s harness cannot inject tools, so its ${a.tools.length} configured tool(s) are unusable`, { nodeId: n.id });
    for (const t of a.tools) {
      const tool = toolById.get(t);
      if (!tool) {
        add("error", `${label} uses a tool that does not exist: ${t}`, { nodeId: n.id });
        continue;
      }
      if (tool.needs_env && tool.needs_env !== "external") {
        const hasEnv = doc.edges.some((e) => e.kind === "access" && e.source === n.id && (byId.get(e.target)?.data as EnvData | undefined)?.env_kind === tool.needs_env);
        if (!hasEnv) add("warning", `${label}'s tool ${t} needs a ${tool.needs_env} env, but ${label} is not connected to one`, { nodeId: n.id });
      }
      if (tool.effect === "irreversible") {
        const approver = doc.edges.some((e) => e.source === n.id && e.kind !== "access" && byId.get(e.target)?.data.kind === "human");
        if (!approver) add("warning", `${label} has the irreversible action ${t} but is not connected to a human approver (human approval is required by default)`, { nodeId: n.id });
      }
    }
    if (a.spawn && !byId.has(a.spawn.template)) add("error", `${label}'s spawn template ${a.spawn.template} does not exist`, { nodeId: n.id });
    for (const p of [...a.pipeline.pre, ...a.pipeline.post]) {
      if ((p.op === "parse_json" || p.op === "validate") && !p.schema) add("warning", `${label}: stage "${p.name}" checks against a schema but none is set`, { nodeId: n.id });
      if ((p.op === "transform" || p.op === "filter" || p.op === "route" || p.op === "summarize") && !p.fn?.code.trim()) add("warning", `${label}: stage "${p.name}" has no function`, { nodeId: n.id });
    }
    if (a.pipeline.post.some((p) => p.op === "route") && a.interface.outputs.length < 2) add("info", `${label} routes its output but has only one output port`, { nodeId: n.id });
    if (a.interface.outputs.length > 1 && !a.pipeline.post.some((p) => p.op === "route")) add("info", `${label} has ${a.interface.outputs.length} outputs and no route stage: every output port gets every reply`, { nodeId: n.id });
  }

  // modality mismatch between agents
  for (const e of doc.edges) {
    if (e.kind === "access") continue;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (s?.data.kind === "agent" && t?.data.kind === "agent") {
      const fwd = s.data.modalities_in.filter((m) => m !== "text");
      const missing = fwd.filter((m) => !(t.data as AgentData).modalities_in.includes(m));
      if (missing.length && (t.data as AgentData).on_unsupported === "reject") add("warning", `${q(s)} may forward ${missing.join(", ")}, which ${q(t)} does not support and is set to reject`, { edgeId: e.id });
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
      add("error", "call edges form a cycle: agents waiting on each other will deadlock. Change at least one to message");
      break;
    }
  }

  // ---- other components
  for (const n of doc.nodes) {
    const d = n.data;
    if (d.kind === "env" && d.env_kind === "room") {
      const members = doc.edges.filter((e) => e.kind === "access" && e.target === n.id).length;
      if (members < 2) add("warning", `Room ${q(n)} has only ${members} member(s)`, { nodeId: n.id });
      if (d.room?.policy === "selector" && !d.room.selector) add("warning", `Room ${q(n)} uses the selector policy and needs a moderator`, { nodeId: n.id });
    } else if ((d.kind === "plugin" || d.kind === "env") && !touching(n.id).length) {
      add("info", `${q(n)} is not used by anyone`, { nodeId: n.id });
    }
    if (d.kind === "model") {
      const m = d as ModelNodeData;
      if (!modelIds.has(m.model)) add("error", `${q(n)} uses model ${m.model || "(empty)"}, which is not in the model catalog`, { nodeId: n.id });
      if (!touching(n.id).length) add("warning", `${q(n)} has no connections`, { nodeId: n.id });
    }
    if (d.kind === "function") {
      const f = d as FunctionNodeData;
      if (!f.fn.code.trim()) add("warning", `${q(n)} has no code`, { nodeId: n.id });
      if (!touching(n.id).length) add("warning", `${q(n)} has no connections`, { nodeId: n.id });
    }
    if (d.kind === "group") {
      const g = d as GroupData;
      const members = doc.nodes.filter((m) => m.parent === n.id);
      if (!members.length) add("warning", `Group "${g.name}" has no members yet. Double-click it to open its canvas`, { nodeId: n.id });
      for (const p of g.interface.inputs) {
        if (!doc.edges.some((e) => e.source === n.id && e.source_port === p.id)) add("warning", `Group "${g.name}" input "${p.id}" is not wired to anything inside`, { nodeId: n.id });
        if (p.required && !doc.edges.some((e) => e.target === n.id && e.target_port === p.id)) add("warning", `Group "${g.name}" input "${p.id}" is required but nothing outside feeds it`, { nodeId: n.id });
      }
      for (const p of g.interface.outputs) {
        if (!doc.edges.some((e) => e.target === n.id && e.target_port === p.id)) add("warning", `Group "${g.name}" output "${p.id}" is never written from inside`, { nodeId: n.id });
      }
    }
  }

  validatePipelines(doc, add);

  if (doc.budget.usd == null && doc.budget.max_rounds == null) add("warning", "The system has no budget or round limit and may run forever");
  return issues;
}
