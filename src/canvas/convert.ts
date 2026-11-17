import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { edgeScope, interfaceOf } from "@/model/ports";
import type { EdgeKind, NodeData, PortSpec, SysEdge, SystemDoc } from "@/model/types";

import type { RunStatus } from "@/run/events";
export type { RunStatus } from "@/run/events";

/** Virtual nodes for a group's own ports on its inner canvas. */
export const BOUNDARY_IN = "__in";
export const BOUNDARY_OUT = "__out";

export interface FlowNodeData extends Record<string, unknown> {
  sys: NodeData;
  status?: RunStatus;
  issues?: number;
  readOnly?: boolean;
  /** group: member count */
  members?: number;
  /** boundary nodes */
  boundary?: { dir: "in" | "out"; ports: PortSpec[]; group: string };
  /** names of ports that have an edge, for handle styling */
  wired?: string[];
}
export interface FlowEdgeData extends Record<string, unknown> {
  sys: SysEdge;
  active?: boolean;
  blocked?: boolean;
  issues?: number;
  /** label ports when the ends have more than one */
  showPorts?: { source: boolean; target: boolean };
}

export type FlowNode = Node<FlowNodeData>;
export type FlowEdge = Edge<FlowEdgeData>;

export const EDGE_COLOR: Record<EdgeKind, string> = {
  message: "hsl(var(--muted-foreground))",
  call: "hsl(var(--info))",
  handoff: "hsl(var(--warning))",
  access: "hsl(var(--muted-foreground) / 0.7)",
};

export const EDGE_LABEL: Record<EdgeKind, string> = {
  message: "message · async",
  call: "call · request / reply",
  handoff: "handoff · pass control",
  access: "access · use an env or plugin",
};

/** Access edges leave from the user's bottom or right and enter the resource's top or left, whichever faces it. */
function accessHandles(a?: { x: number; y: number }, b?: { x: number; y: number }) {
  if (!a || !b) return { sourceHandle: "res", targetHandle: "res" };
  const beside = b.x - a.x > 200 && Math.abs(b.y - a.y) < (b.x - a.x) * 1.2;
  return beside ? { sourceHandle: "res@r", targetHandle: "res@l" } : { sourceHandle: "res", targetHandle: "res" };
}

const inScope = (scope: string | undefined) => (n: { parent?: string }) => n.parent === scope;

/** The nodes drawn on one canvas: the root (scope undefined) or a group's own canvas. */
export function toFlowNodes(
  doc: SystemDoc,
  scope: string | undefined,
  opts: { selected?: Set<string>; status?: Record<string, RunStatus>; issues?: Record<string, number>; readOnly?: boolean } = {},
): FlowNode[] {
  const nodes = doc.nodes.filter(inScope(scope));
  const wiredOf = (id: string) => doc.edges.flatMap((e) => [e.source === id ? e.source_port : null, e.target === id ? e.target_port : null]).filter(Boolean) as string[];
  const out: FlowNode[] = nodes.map((n) => ({
    id: n.id,
    type: n.data.kind,
    position: n.position,
    selected: opts.selected?.has(n.id) ?? false,
    draggable: !opts.readOnly,
    connectable: !opts.readOnly,
    data: {
      sys: n.data,
      status: opts.status?.[n.id],
      issues: opts.issues?.[n.id],
      readOnly: opts.readOnly,
      members: n.data.kind === "group" ? doc.nodes.filter((m) => m.parent === n.id).length : undefined,
      wired: wiredOf(n.id),
    },
  }));
  const group = scope ? doc.nodes.find((n) => n.id === scope) : undefined;
  if (group && group.data.kind === "group") {
    const ifc = interfaceOf(group.data);
    const xs = nodes.map((n) => n.position.x);
    const ys = nodes.map((n) => n.position.y);
    const minX = xs.length ? Math.min(...xs) : 0;
    const maxX = xs.length ? Math.max(...xs) : 300;
    const midY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
    out.push(
      { id: BOUNDARY_IN, type: "boundary", position: { x: minX - 230, y: midY }, draggable: false, selectable: false, deletable: false, data: { sys: group.data, boundary: { dir: "in", ports: ifc.inputs, group: group.id }, readOnly: opts.readOnly } },
      { id: BOUNDARY_OUT, type: "boundary", position: { x: maxX + 300, y: midY }, draggable: false, selectable: false, deletable: false, data: { sys: group.data, boundary: { dir: "out", ports: ifc.outputs, group: group.id }, readOnly: opts.readOnly } },
    );
  }
  return out;
}

export function toFlowEdges(
  doc: SystemDoc,
  scope: string | undefined,
  opts: { selected?: Set<string>; active?: Set<string>; blocked?: Set<string>; issues?: Record<string, number> } = {},
): FlowEdge[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const multi = (id: string, dir: "in" | "out", inner: boolean) => {
    const n = byId.get(id);
    if (!n) return false;
    const ifc = interfaceOf(n.data);
    // inside a group its inputs act as sources and its outputs as targets
    const list = inner ? (dir === "out" ? ifc.inputs : ifc.outputs) : dir === "out" ? ifc.outputs : ifc.inputs;
    return list.length > 1;
  };
  return doc.edges
    .filter((e) => (e.kind === "access" ? byId.get(e.source)?.parent === scope && byId.get(e.target)?.parent === scope : edgeScope(doc, e) === scope))
    .map((e) => {
      const color = EDGE_COLOR[e.kind];
      const marker = { type: MarkerType.ArrowClosed, color, width: 16, height: 16 };
      const fromBoundary = scope !== undefined && e.source === scope;
      const toBoundary = scope !== undefined && e.target === scope;
      return {
        id: e.id,
        source: fromBoundary ? BOUNDARY_IN : e.source,
        target: toBoundary ? BOUNDARY_OUT : e.target,
        ...(e.kind === "access" ? accessHandles(byId.get(e.source)?.position, byId.get(e.target)?.position) : { sourceHandle: e.source_port, targetHandle: e.target_port }),
        type: "sys",
        selected: opts.selected?.has(e.id) ?? false,
        markerEnd: marker,
        markerStart: e.kind === "call" ? { ...marker } : undefined,
        data: {
          sys: e,
          active: opts.active?.has(e.id),
          blocked: opts.blocked?.has(e.id),
          issues: opts.issues?.[e.id],
          showPorts: { source: multi(e.source, "out", fromBoundary), target: multi(e.target, "in", toBoundary) },
        },
      };
    });
}
