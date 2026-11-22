// Pure edits of a SystemDoc made from the canvas. FlowView and the toolbar
// call these; nothing here touches React.
import { defaultBinding, defaultData, newId } from "@/model/defaults";
import { compat, interfaceOf, isResource, usesResources } from "@/model/ports";
import type { NodeData, NodeKind, SysEdge, SysNode, SystemDoc } from "@/model/types";
import { RES_PORT } from "@/model/types";
import { BOUNDARY_IN, BOUNDARY_OUT } from "./convert";
import { isResHandle } from "./nodes/parts";

/** Nearest spot to `p` on the scope's canvas that does not overlap a node. */
export function freeSpot(doc: SystemDoc, scope: string | undefined, p: { x: number; y: number }) {
  const taken = doc.nodes.filter((n) => n.parent === scope);
  const hits = (q: { x: number; y: number }) => taken.some((n) => Math.abs(n.position.x - q.x) < 250 && Math.abs(n.position.y - q.y) < 110);
  for (let r = 0; r < 8; r++) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const q = { x: Math.round(p.x + dx * 270 * r), y: Math.round(p.y + dy * 130 * r) };
      if (!hits(q)) return q;
    }
  }
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Add a component. `data` overrides the kind's defaults (presets, imports). */
export function addNode(doc: SystemDoc, kind: NodeKind, position: { x: number; y: number }, scope?: string, data?: NodeData): { doc: SystemDoc; id: string } {
  const id = newId(kind);
  const d = data ?? defaultData(kind);
  const sameName = doc.nodes.filter((n) => "name" in n.data && "name" in d && (n.data.name === d.name || n.data.name.startsWith(`${d.name} `))).length;
  if ("name" in d && sameName > 0) d.name = `${d.name} ${sameName + 1}`;
  const node: SysNode = { id, position: freeSpot(doc, scope, position), data: d };
  if (scope) node.parent = scope;
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, id };
}

/** What copying takes: the components (a group with its members) and the connections among them. */
export interface Clip {
  nodes: SysNode[];
  edges: SysEdge[];
}

/** Copy components: a group takes its members with it, and the connections between copied components come too. */
export function copyNodes(doc: SystemDoc, ids: string[]): Clip {
  const take = new Set(ids.filter((id) => doc.nodes.some((n) => n.id === id)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of doc.nodes) if (n.parent && take.has(n.parent) && !take.has(n.id)) { take.add(n.id); grew = true; }
  }
  const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  return { nodes: copy(doc.nodes.filter((n) => take.has(n.id))), edges: copy(doc.edges.filter((e) => take.has(e.source) && take.has(e.target))) };
}

/**
 * Paste copied components with new ids: members stay in their copied group, the rest go into the canvas level
 * shown (scope), moved by offset so they do not sit on the originals; a name already taken gets " (copy)".
 * Returns the new top-level ids, to select them.
 */
export function pasteNodes(doc: SystemDoc, clip: Clip, scope: string | undefined, offset = { x: 40, y: 40 }): { doc: SystemDoc; ids: string[] } {
  if (!clip.nodes.length) return { doc, ids: [] };
  const map = new Map(clip.nodes.map((n) => [n.id, newId(n.data.kind)]));
  const names = new Set(doc.nodes.map((n) => ("name" in n.data ? n.data.name : "")));
  const top: string[] = [];
  const nodes: SysNode[] = clip.nodes.map((n) => {
    const inner = !!n.parent && map.has(n.parent);
    const data = JSON.parse(JSON.stringify(n.data)) as NodeData;
    if ("name" in data && names.has(data.name)) data.name = `${data.name} (copy)`;
    const node: SysNode = { ...n, id: map.get(n.id)!, data, position: inner ? n.position : { x: n.position.x + offset.x, y: n.position.y + offset.y } };
    if (inner) node.parent = map.get(n.parent!);
    else if (scope) node.parent = scope;
    else delete node.parent;
    if (!inner) top.push(node.id);
    return node;
  });
  const edges: SysEdge[] = clip.edges.map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: newId("e"), source: map.get(e.source)!, target: map.get(e.target)! }));
  return { doc: { ...doc, nodes: [...doc.nodes, ...nodes], edges: [...doc.edges, ...edges] }, ids: top };
}

/** Delete components; a group takes its members with it. */
export function deleteNodes(doc: SystemDoc, ids: string[]): SystemDoc {
  const gone = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of doc.nodes) if (n.parent && gone.has(n.parent) && !gone.has(n.id)) { gone.add(n.id); grew = true; }
  }
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !gone.has(n.id)),
    edges: doc.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
  };
}

export function moveNodes(doc: SystemDoc, moves: Record<string, { x: number; y: number }>): SystemDoc {
  return { ...doc, nodes: doc.nodes.map((n) => (moves[n.id] ? { ...n, position: { x: Math.round(moves[n.id].x), y: Math.round(moves[n.id].y) } } : n)) };
}

export interface ConnectRequest {
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
}

/**
 * Turn a drag between two handles into an edge. Boundary nodes stand for the
 * scope group's own ports. Access edges are made whenever an env or plugin is
 * involved, and always point from the user to the resource.
 */
export function connect(doc: SystemDoc, scope: string | undefined, c: ConnectRequest): { doc: SystemDoc; id?: string; error?: string } {
  const real = (id: string) => (id === BOUNDARY_IN || id === BOUNDARY_OUT ? scope! : id);
  let source = real(c.source);
  let target = real(c.target);
  if (source === target && c.source === c.target) return { doc, error: "A component cannot connect to itself" };
  const s = doc.nodes.find((n) => n.id === source);
  const t = doc.nodes.find((n) => n.id === target);
  if (!s || !t) return { doc };

  if (isResource(s.data.kind) || isResource(t.data.kind) || isResHandle(c.sourceHandle) || isResHandle(c.targetHandle)) {
    if (isResource(s.data.kind) && !isResource(t.data.kind)) [source, target] = [target, source];
    const user = doc.nodes.find((n) => n.id === source)!;
    const res = doc.nodes.find((n) => n.id === target)!;
    if (!usesResources(user.data.kind) || !isResource(res.data.kind)) return { doc, error: "Access edges run from an agent, a human or a function to an env or plugin" };
    if (doc.edges.some((e) => e.kind === "access" && e.source === source && e.target === target)) return { doc };
    const edge: SysEdge = { id: newId("e"), source, source_port: RES_PORT, target, target_port: RES_PORT, kind: "access", access: "read_write", binding: defaultBinding(res.data) };
    return { doc: { ...doc, edges: [...doc.edges, edge] }, id: edge.id };
  }

  const sp = c.sourceHandle ?? interfaceOf(s.data).outputs[0]?.id;
  const tp = c.targetHandle ?? interfaceOf(t.data).inputs[0]?.id;
  if (!sp || !tp) return { doc, error: "Both ends need a port" };
  if (doc.edges.some((e) => e.source === source && e.source_port === sp && e.target === target && e.target_port === tp)) return { doc };
  const edge: SysEdge = { id: newId("e"), source, source_port: sp, target, target_port: tp, kind: "message" };
  return { doc: { ...doc, edges: [...doc.edges, edge] }, id: edge.id };
}

/** Would this drag make a type-safe edge? Used to highlight valid targets while dragging. */
export function connectionHint(doc: SystemDoc, scope: string | undefined, c: ConnectRequest): "ok" | "coerce" | "needs_transform" | "invalid" {
  const real = (id: string) => (id === BOUNDARY_IN || id === BOUNDARY_OUT ? scope! : id);
  const s = doc.nodes.find((n) => n.id === real(c.source));
  const t = doc.nodes.find((n) => n.id === real(c.target));
  if (!s || !t) return "invalid";
  if (isResHandle(c.sourceHandle) || isResHandle(c.targetHandle)) return isResHandle(c.sourceHandle) && isResHandle(c.targetHandle) ? "ok" : "invalid";
  const sIfc = interfaceOf(s.data);
  const tIfc = interfaceOf(t.data);
  const sp = (c.source === BOUNDARY_IN ? sIfc.inputs : sIfc.outputs).find((p) => p.id === c.sourceHandle);
  const tp = (c.target === BOUNDARY_OUT ? tIfc.outputs : tIfc.inputs).find((p) => p.id === c.targetHandle);
  if (!sp || !tp) return "invalid";
  return compat(sp, tp).level;
}

/**
 * Move one end of an edge to another handle. The edge keeps its id and its
 * settings (label, transform, gate, binding); its ports, and its kind if it
 * becomes or stops being an access edge, follow the new ends. Waypoints are
 * dropped since the route changed.
 */
export function reconnect(doc: SystemDoc, scope: string | undefined, edgeId: string, c: ConnectRequest): { doc: SystemDoc; error?: string } {
  const old = doc.edges.find((e) => e.id === edgeId);
  if (!old) return { doc };
  const without = { ...doc, edges: doc.edges.filter((e) => e.id !== edgeId) };
  const r = connect(without, scope, c);
  if (r.error || !r.id) return { doc, error: r.error ?? "That connection already exists" };
  const fresh = r.doc.edges.find((e) => e.id === r.id)!;
  const sameFamily = (old.kind === "access") === (fresh.kind === "access");
  const merged: SysEdge = sameFamily
    ? { ...old, source: fresh.source, source_port: fresh.source_port, target: fresh.target, target_port: fresh.target_port, points: undefined }
    : { ...fresh, id: old.id };
  return { doc: { ...doc, edges: doc.edges.map((e) => (e.id === edgeId ? merged : e)) } };
}

/** Save an edge's waypoints; an empty list makes it a plain curve again. */
export function setEdgePoints(doc: SystemDoc, edgeId: string, points: { x: number; y: number }[]): SystemDoc {
  return {
    ...doc,
    edges: doc.edges.map((e) => {
      if (e.id !== edgeId) return e;
      const { points: _old, ...rest } = e;
      void _old;
      return points.length ? { ...rest, points: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) } : rest;
    }),
  };
}
