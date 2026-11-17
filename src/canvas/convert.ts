import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { EdgeKind, NodeData, SysEdge, SystemDoc } from "@/model/types";

export type RunStatus = "idle" | "working" | "waiting" | "done" | "blocked";

export interface FlowNodeData extends Record<string, unknown> {
  sys: NodeData;
  status?: RunStatus;
  issues?: number;
  readOnly?: boolean;
  /** group: member count, for the header */
  members?: number;
}
export interface FlowEdgeData extends Record<string, unknown> {
  sys: SysEdge;
  active?: boolean;
  blocked?: boolean;
  issues?: number;
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
  message: "message · 异步消息",
  call: "call · 同步调用",
  handoff: "handoff · 移交控制",
  access: "access · 读写 env / store",
};

export function toFlowNodes(
  doc: SystemDoc,
  opts: { selected?: Set<string>; status?: Record<string, RunStatus>; issues?: Record<string, number>; readOnly?: boolean } = {},
): FlowNode[] {
  return doc.nodes.map((n) => {
    const isGroup = n.data.kind === "group";
    return {
      id: n.id,
      type: n.data.kind,
      position: n.position,
      parentId: n.parent,
      extent: undefined,
      selected: opts.selected?.has(n.id) ?? false,
      draggable: !opts.readOnly,
      connectable: !opts.readOnly,
      zIndex: isGroup ? -1 : undefined,
      style: isGroup && n.size ? { width: n.size.width, height: n.size.height } : undefined,
      data: {
        sys: n.data,
        status: opts.status?.[n.id],
        issues: opts.issues?.[n.id],
        readOnly: opts.readOnly,
        members: isGroup ? doc.nodes.filter((m) => m.parent === n.id).length : undefined,
      },
    };
  });
}

const SIZE: Record<string, { w: number; h: number }> = {
  agent: { w: 220, h: 92 },
  human: { w: 180, h: 58 },
  env: { w: 190, h: 58 },
  store: { w: 180, h: 58 },
  channel: { w: 140, h: 46 },
};

function box(doc: SystemDoc, id: string) {
  const n = doc.nodes.find((x) => x.id === id);
  const p = absolutePosition(doc, id);
  const s = n?.size ? { w: n.size.width, h: n.size.height } : (SIZE[n?.data.kind ?? "agent"] ?? SIZE.agent);
  return { cx: p.x + s.w / 2, cy: p.y + s.h / 2, w: s.w, h: s.h };
}

/** Pick the facing sides so edges leave and enter where they point. */
export function handlesFor(doc: SystemDoc, source: string, target: string): { sourceHandle: string; targetHandle: string } {
  const a = box(doc, source);
  const b = box(doc, target);
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  // compare against the boxes' aspect so wide nodes prefer left/right
  if (Math.abs(dx) / ((a.w + b.w) / 2) >= Math.abs(dy) / ((a.h + b.h) / 2)) {
    return dx >= 0 ? { sourceHandle: "r", targetHandle: "l" } : { sourceHandle: "l", targetHandle: "r" };
  }
  return dy >= 0 ? { sourceHandle: "b", targetHandle: "t" } : { sourceHandle: "t", targetHandle: "b" };
}

export function toFlowEdges(
  doc: SystemDoc,
  opts: { selected?: Set<string>; active?: Set<string>; blocked?: Set<string>; issues?: Record<string, number> } = {},
): FlowEdge[] {
  return doc.edges.map((e) => {
    const color = EDGE_COLOR[e.kind];
    const marker = { type: MarkerType.ArrowClosed, color, width: 16, height: 16 };
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      ...handlesFor(doc, e.source, e.target),
      type: "sys",
      selected: opts.selected?.has(e.id) ?? false,
      markerEnd: marker,
      markerStart: e.kind === "call" ? { ...marker } : undefined,
      data: { sys: e, active: opts.active?.has(e.id), blocked: opts.blocked?.has(e.id), issues: opts.issues?.[e.id] },
    };
  });
}

/** Absolute canvas position of a node (adds its group's offset). */
export function absolutePosition(doc: SystemDoc, id: string): { x: number; y: number } {
  const n = doc.nodes.find((x) => x.id === id);
  if (!n) return { x: 0, y: 0 };
  if (!n.parent) return n.position;
  const p = absolutePosition(doc, n.parent);
  return { x: p.x + n.position.x, y: p.y + n.position.y };
}
