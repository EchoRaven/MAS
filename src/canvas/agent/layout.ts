// An agent's internals as a graph: the wrapper around its harness.
//   input ports → input stages → context ← plugins
//                                   ↓
//                    model ↔ harness loop ↔ tools
//                                   ↓
//                 output stages → output ports
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { runnerById } from "@/model/defaults";
import { nodeName } from "@/model/ports";
import type { AgentData, PortSpec, SystemDoc } from "@/model/types";
import { resourceTools } from "../inspector/BindingEditor";

/** What clicking a part selects; the inspector maps it to a tab. */
export type Part = `in:${string}` | `out:${string}` | `pre:${number}` | `post:${number}` | "context" | "harness" | "model" | "tools" | `res:${string}`;

export interface PartData extends Record<string, unknown> {
  part: Part;
  title: string;
  subtitle: string;
  icon: "port-in" | "port-out" | "stage" | "context" | "harness" | "model" | "tools" | "plugin" | "env";
  /** managed by the harness, not the platform */
  dim?: boolean;
  badge?: string;
  port?: PortSpec;
}

export type PartNode = Node<PartData>;

const X = 230;

export function agentGraph(doc: SystemDoc, id: string, a: AgentData): { nodes: PartNode[]; edges: Edge[] } {
  const caps = a.harness.capabilities;
  const runner = runnerById(a.harness.runner);
  const usesModel = a.harness.tier === "native" || a.harness.tier === "sdk";
  const modelSpec = doc.models.find((m) => m.id === a.model);
  const nodes: PartNode[] = [];
  const edges: Edge[] = [];
  const link = (source: string, target: string, opts: Partial<Edge> = {}) =>
    edges.push({ id: `${source}->${target}`, source, target, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, style: { strokeWidth: 1.4 }, ...opts });

  const ins = a.interface.inputs;
  const outs = a.interface.outputs;
  const spread = (i: number, n: number) => (i - (n - 1) / 2) * 90;

  let x = 0;
  ins.forEach((p, i) => nodes.push({ id: `in:${p.id}`, type: "part", position: { x, y: spread(i, ins.length) }, data: { part: `in:${p.id}`, title: p.id, subtitle: `${p.type}${p.schema ? `<${p.schema}>` : ""}${p.required ? " · required" : ""}`, icon: "port-in", port: p } }));
  let prev: string[] = ins.map((p) => `in:${p.id}`);
  const chain = (next: string) => {
    for (const p of prev) link(p, next);
    prev = [next];
  };

  a.pipeline.pre.forEach((s, i) => {
    x += X;
    nodes.push({ id: `pre:${i}`, type: "part", position: { x, y: 0 }, data: { part: `pre:${i}`, title: s.name, subtitle: s.op.replace("_", " ") + (s.schema ? ` · ${s.schema}` : s.fn ? ` · ${s.fn.lang}` : ""), icon: "stage", badge: "in" } });
    chain(`pre:${i}`);
  });

  x += X;
  const noCtx = caps.context_control === "none";
  nodes.push({ id: "context", type: "part", position: { x, y: 0 }, data: { part: "context", title: "Context", subtitle: noCtx ? "Managed by the harness · prefix only" : `${a.context.history_strategy.replace(/_/g, " ")} · ${(a.context.budget_total / 1000).toFixed(0)}k tok`, icon: "context", dim: noCtx } });
  chain("context");

  // plugins and envs injected into the context hang below it
  const attached = doc.edges.filter((e) => e.kind === "access" && e.source === id);
  attached.forEach((e, i) => {
    const target = doc.nodes.find((n) => n.id === e.target);
    if (!target) return;
    const mode = e.binding?.mode ?? "tool";
    const nid = `res:${e.id}`;
    nodes.push({
      id: nid,
      type: "part",
      position: { x: x - 40 + i * 200 - ((attached.length - 1) * 200) / 2 + 40, y: 260 },
      data: { part: `res:${e.id}`, title: nodeName(target), subtitle: `${target.data.kind === "plugin" ? target.data.preset : target.data.kind === "env" ? target.data.env_kind : ""} · ${mode.replace("_", "-")}`, icon: target.data.kind === "plugin" ? "plugin" : "env" },
    });
    if (mode !== "tool") link(nid, "context", { style: { strokeDasharray: "4 4", strokeWidth: 1.2 }, sourceHandle: "t", targetHandle: "b" });
    else link(nid, "tools", { style: { strokeDasharray: "4 4", strokeWidth: 1.2 }, sourceHandle: "t", targetHandle: "b" });
  });

  x += X + 20;
  nodes.push({
    id: "harness",
    type: "part",
    position: { x, y: 0 },
    data: { part: "harness", title: a.harness.tier === "native" ? `Loop · ${a.harness.loop ?? "react"}` : (runner?.label ?? a.harness.tier), subtitle: `${a.harness.tier}${a.harness.max_steps ? ` · ≤${a.harness.max_steps} steps` : ""}`, icon: "harness", badge: a.harness.tier },
  });
  chain("harness");
  nodes.push({ id: "model", type: "part", position: { x, y: -150 }, data: { part: "model", title: usesModel ? (modelSpec?.model ?? a.model) : "Model", subtitle: usesModel ? (modelSpec?.provider ?? "not in catalog") : "Chosen by the harness itself", icon: "model", dim: !usesModel } });
  link("harness", "model", { sourceHandle: "t", targetHandle: "b", markerStart: { type: MarkerType.ArrowClosed, width: 12, height: 12 }, style: { strokeDasharray: "3 3" } });
  const resTools = attached.flatMap((e) => {
    const t = doc.nodes.find((n) => n.id === e.target);
    const all = t ? resourceTools(t.data) : [];
    return e.binding?.tools?.length ? all.filter((x) => e.binding!.tools!.includes(x)) : all;
  });
  const toolCount = a.tools.length + resTools.length;
  nodes.push({
    id: "tools",
    type: "part",
    position: { x: x + 120, y: 150 },
    data: { part: "tools", title: `Tools · ${toolCount}`, subtitle: caps.tool_injection.length ? `via ${caps.tool_injection.join(" / ")}` : "Not supported by this harness", icon: "tools", dim: caps.tool_injection.length === 0 },
  });
  link("harness", "tools", { sourceHandle: "b", targetHandle: "t", markerStart: { type: MarkerType.ArrowClosed, width: 12, height: 12 }, style: { strokeDasharray: "3 3" } });

  a.pipeline.post.forEach((s, i) => {
    x += X;
    nodes.push({ id: `post:${i}`, type: "part", position: { x, y: 0 }, data: { part: `post:${i}`, title: s.name, subtitle: s.op.replace("_", " ") + (s.schema ? ` · ${s.schema}` : s.fn ? ` · ${s.fn.lang}` : ""), icon: "stage", badge: "out" } });
    chain(`post:${i}`);
  });

  x += X;
  outs.forEach((p, i) => {
    nodes.push({ id: `out:${p.id}`, type: "part", position: { x, y: spread(i, outs.length) }, data: { part: `out:${p.id}`, title: p.id, subtitle: `${p.type}${p.schema ? `<${p.schema}>` : ""}`, icon: "port-out", port: p } });
    for (const s of prev) link(s, `out:${p.id}`);
  });
  return { nodes, edges };
}
