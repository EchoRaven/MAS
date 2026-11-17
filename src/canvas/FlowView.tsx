import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { defaultData, newId } from "@/model/defaults";
import type { EdgeKind, NodeKind, SysNode, SystemDoc } from "@/model/types";
import { resolveTheme, useUiStore } from "@/store/ui";
import { absolutePosition, toFlowEdges, toFlowNodes, type FlowEdge, type FlowNode, type RunStatus } from "./convert";
import { EDGE_TYPES } from "./edges";
import { NODE_TYPES } from "./nodes";

export const DND_MIME = "application/x-mas-kind";

/** Groups first: a parent must precede its children. */
function ordered(nodes: SysNode[]) {
  return [...nodes.filter((n) => n.data.kind === "group"), ...nodes.filter((n) => n.data.kind !== "group")];
}

/** Nearest spot to `p` that does not overlap an existing top-level node. */
export function freeSpot(doc: SystemDoc, p: { x: number; y: number }) {
  const taken = doc.nodes.filter((n) => !n.parent && n.data.kind !== "group");
  const hits = (q: { x: number; y: number }) => taken.some((n) => Math.abs(n.position.x - q.x) < 230 && Math.abs(n.position.y - q.y) < 110);
  for (let r = 0; r < 8; r++) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const q = { x: Math.round(p.x + dx * 250 * r), y: Math.round(p.y + dy * 130 * r) };
      if (!hits(q)) return q;
    }
  }
  return p;
}

export function addNode(doc: SystemDoc, kind: NodeKind, position: { x: number; y: number }): { doc: SystemDoc; id: string } {
  const id = newId(kind);
  const data = defaultData(kind);
  const sameKind = doc.nodes.filter((n) => n.data.kind === kind).length;
  if ("name" in data && sameKind > 0) data.name = `${data.name} ${sameKind + 1}`;
  const node: SysNode = { id, position, data };
  if (kind === "group") node.size = { width: 480, height: 300 };
  return { doc: { ...doc, nodes: ordered([...doc.nodes, node]) }, id };
}

function kindFor(doc: SystemDoc, source: string, target: string): { source: string; target: string; kind: EdgeKind } {
  const k = (id: string) => doc.nodes.find((n) => n.id === id)?.data.kind;
  const isRes = (id: string) => k(id) === "env" || k(id) === "store";
  if (isRes(source) && !isRes(target)) return { source: target, target: source, kind: "access" };
  if (isRes(target)) return { source, target, kind: "access" };
  return { source, target, kind: "message" };
}

export function FlowView({
  doc,
  update,
  readOnly = false,
  status,
  activeEdges,
  blockedEdges,
  issueCounts,
  onSelect,
}: {
  doc: SystemDoc;
  update?: (fn: (d: SystemDoc) => SystemDoc) => void;
  readOnly?: boolean;
  status?: Record<string, RunStatus>;
  activeEdges?: Set<string>;
  blockedEdges?: Set<string>;
  issueCounts?: { nodes: Record<string, number>; edges: Record<string, number> };
  onSelect?: (sel: { nodeId?: string; edgeId?: string }) => void;
}) {
  const rf = useReactFlow<FlowNode, FlowEdge>();
  const theme = useUiStore((s) => s.theme);
  const [selected, setSelected] = useState<{ nodes: Set<string>; edges: Set<string> }>({ nodes: new Set(), edges: new Set() });

  const sortedDoc = useMemo(() => ({ ...doc, nodes: ordered(doc.nodes) }), [doc]);
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowNodes(sortedDoc, { readOnly }));
  const [edges, setEdges] = useState<FlowEdge[]>(() => toFlowEdges(sortedDoc));

  useEffect(() => {
    setNodes(toFlowNodes(sortedDoc, { selected: selected.nodes, status, issues: issueCounts?.nodes, readOnly }));
    // selection is tracked separately; rebuilding on it would fight React Flow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedDoc, status, issueCounts, readOnly]);
  useEffect(() => {
    setEdges(toFlowEdges(sortedDoc, { selected: selected.edges, active: activeEdges, blocked: blockedEdges, issues: issueCounts?.edges }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedDoc, activeEdges, blockedEdges, issueCounts]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      if (readOnly || !update) return;
      const removed = changes.flatMap((c) => (c.type === "remove" ? [c.id] : []));
      if (removed.length) {
        update((d) => ({
          ...d,
          nodes: d.nodes
            .filter((n) => !removed.includes(n.id))
            .map((n) => (n.parent && removed.includes(n.parent) ? { ...n, parent: undefined, position: absolutePosition(d, n.id) } : n)),
          edges: d.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)),
        }));
      }
      const resized = changes.flatMap((c) => (c.type === "dimensions" && c.resizing === false && c.dimensions ? [c] : []));
      if (resized.length) {
        update((d) => ({
          ...d,
          nodes: d.nodes.map((n) => {
            const c = resized.find((r) => r.id === n.id);
            if (!c || n.data.kind !== "group" || !c.dimensions) return n;
            const live = rf.getNode(n.id);
            return { ...n, size: { width: Math.round(c.dimensions.width), height: Math.round(c.dimensions.height) }, position: live ? live.position : n.position };
          }),
        }));
      }
    },
    [readOnly, update, rf],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      setEdges((es) => applyEdgeChanges(changes, es));
      if (readOnly || !update) return;
      const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
      if (removed.length) update((d) => ({ ...d, edges: d.edges.filter((e) => !removed.includes(e.id)) }));
    },
    [readOnly, update],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!update || !c.source || !c.target || c.source === c.target) return;
      update((d) => {
        const { source, target, kind } = kindFor(d, c.source!, c.target!);
        if (d.edges.some((e) => e.source === source && e.target === target)) return d;
        return { ...d, edges: [...d.edges, { id: newId("e"), source, target, kind, ...(kind === "access" ? { access: "read_write" as const } : {}) }] };
      });
    },
    [update],
  );

  /** On drop: commit positions, and move the node into / out of a group. */
  const onNodeDragStop = useCallback(
    (_: unknown, __: FlowNode, dragged: FlowNode[]) => {
      if (!update) return;
      update((d) => {
        let nodes = d.nodes;
        for (const fn of dragged) {
          const live = rf.getInternalNode(fn.id);
          const abs = live?.internals.positionAbsolute ?? fn.position;
          const cur = nodes.find((n) => n.id === fn.id);
          if (!cur) continue;
          let parent = cur.parent;
          let position = fn.position;
          if (cur.data.kind !== "group") {
            const hit = rf
              .getIntersectingNodes({ x: abs.x, y: abs.y, width: fn.measured?.width ?? 1, height: fn.measured?.height ?? 1 })
              .find((n) => n.type === "group" && n.id !== fn.id);
            const nextParent = hit?.id;
            if (nextParent !== parent) {
              if (nextParent) {
                const gAbs = rf.getInternalNode(nextParent)?.internals.positionAbsolute ?? { x: 0, y: 0 };
                position = { x: abs.x - gAbs.x, y: abs.y - gAbs.y };
              } else {
                position = abs;
              }
              parent = nextParent;
            }
          }
          nodes = nodes.map((n) => (n.id === fn.id ? { ...n, parent, position: { x: Math.round(position.x), y: Math.round(position.y) } } : n));
        }
        return { ...d, nodes: ordered(nodes) };
      });
    },
    [update, rf],
  );

  // React Flow re-registers this handler whenever its identity changes and may
  // fire it again, so it must be stable and must not set state when nothing changed.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const lastSel = useRef("");
  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: OnSelectionChangeParams) => {
    const key = `${ns.map((n) => n.id).sort().join(",")}|${es.map((e) => e.id).sort().join(",")}`;
    if (key === lastSel.current) return;
    lastSel.current = key;
    setSelected({ nodes: new Set(ns.map((n) => n.id)), edges: new Set(es.map((e) => e.id)) });
    if (ns.length === 1 && es.length === 0) onSelectRef.current?.({ nodeId: ns[0].id });
    else if (es.length === 1 && ns.length === 0) onSelectRef.current?.({ edgeId: es[0].id });
    else if (ns.length === 0 && es.length === 0) onSelectRef.current?.({});
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData(DND_MIME) as NodeKind;
      if (!kind || !update) return;
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      let createdId = "";
      update((d) => {
        const r = addNode(d, kind, kind === "group" ? { x: Math.round(p.x - 90), y: Math.round(p.y - 30) } : freeSpot(d, { x: p.x - 90, y: p.y - 30 }));
        createdId = r.id;
        return r.doc;
      });
      if (createdId) onSelectRef.current?.({ nodeId: createdId });
    },
    [rf, update],
  );

  return (
    <ReactFlow<FlowNode, FlowEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={readOnly ? undefined : onConnect}
      onNodeDragStop={readOnly ? undefined : onNodeDragStop}
      onSelectionChange={onSelectionChange}
      onDrop={readOnly ? undefined : onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      connectionMode={ConnectionMode.Loose}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
      colorMode={resolveTheme(theme)}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1, minZoom: 0.55 }}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap pannable zoomable position="bottom-right" className="hidden md:block" style={{ width: 140, height: 96 }} />
    </ReactFlow>
  );
}
