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
  type IsValidConnection,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import type { NodeKind, SystemDoc } from "@/model/types";
import { resolveTheme, useUiStore } from "@/store/ui";
import { BOUNDARY_IN, BOUNDARY_OUT, toFlowEdges, toFlowNodes, type FlowEdge, type FlowNode, type RunStatus } from "./convert";
import { EDGE_TYPES } from "./edges";
import { NODE_TYPES } from "./nodes";
import { addNode, connect, connectionHint, deleteNodes, moveNodes } from "./ops";
import type { NodeData } from "@/model/types";

export const DND_MIME = "application/x-mas-component";

/** What the palette puts on the drag: a kind, optionally with preset data. */
export interface DragPayload {
  kind: NodeKind;
  data?: NodeData;
}

export function FlowView({
  doc,
  scope,
  update,
  readOnly = false,
  status,
  activeEdges,
  blockedEdges,
  issueCounts,
  onSelect,
  onOpen,
  onError,
}: {
  doc: SystemDoc;
  /** the group whose canvas this is; undefined = the root */
  scope?: string;
  update?: (fn: (d: SystemDoc) => SystemDoc) => void;
  readOnly?: boolean;
  status?: Record<string, RunStatus>;
  activeEdges?: Set<string>;
  blockedEdges?: Set<string>;
  issueCounts?: { nodes: Record<string, number>; edges: Record<string, number> };
  onSelect?: (sel: { nodeId?: string; edgeId?: string }) => void;
  /** double-click: open a group's canvas or an agent's internals */
  onOpen?: (nodeId: string) => void;
  onError?: (message: string) => void;
}) {
  const rf = useReactFlow<FlowNode, FlowEdge>();
  const theme = useUiStore((s) => s.theme);
  const [selected, setSelected] = useState<{ nodes: Set<string>; edges: Set<string> }>({ nodes: new Set(), edges: new Set() });

  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowNodes(doc, scope, { readOnly }));
  const [edges, setEdges] = useState<FlowEdge[]>(() => toFlowEdges(doc, scope));

  useEffect(() => {
    setNodes(toFlowNodes(doc, scope, { selected: selected.nodes, status, issues: issueCounts?.nodes, readOnly }));
    // selection is tracked separately; rebuilding on it would fight React Flow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, scope, status, issueCounts, readOnly]);
  useEffect(() => {
    setEdges(toFlowEdges(doc, scope, { selected: selected.edges, active: activeEdges, blocked: blockedEdges, issues: issueCounts?.edges }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, scope, activeEdges, blockedEdges, issueCounts]);

  // a new scope: frame its content
  const firstScope = useRef(true);
  useEffect(() => {
    if (firstScope.current) { firstScope.current = false; return; }
    const id = window.setTimeout(() => rf.fitView({ padding: 0.15, maxZoom: 1, minZoom: 0.55 }), 30);
    return () => window.clearTimeout(id);
  }, [scope, rf]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      if (readOnly || !update) return;
      const removed = changes.flatMap((c) => (c.type === "remove" && c.id !== BOUNDARY_IN && c.id !== BOUNDARY_OUT ? [c.id] : []));
      if (removed.length) update((d) => deleteNodes(d, removed));
    },
    [readOnly, update],
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

  const docRef = useRef(doc);
  docRef.current = doc;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const onConnect = useCallback(
    (c: Connection) => {
      if (!update || !c.source || !c.target) return;
      const r = connect(docRef.current, scope, c);
      if (r.error) onErrorRef.current?.(r.error);
      if (r.doc !== docRef.current) update(() => r.doc);
      if (r.id) onSelectRef.current?.({ edgeId: r.id });
    },
    [update, scope],
  );

  const isValidConnection: IsValidConnection<FlowEdge> = useCallback(
    (c) => !!c.source && !!c.target && connectionHint(docRef.current, scope, { source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? null, targetHandle: c.targetHandle ?? null }) !== "invalid",
    [scope],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, __: FlowNode, dragged: FlowNode[]) => {
      if (!update) return;
      const moves = Object.fromEntries(dragged.filter((n) => n.id !== BOUNDARY_IN && n.id !== BOUNDARY_OUT).map((n) => [n.id, n.position]));
      update((d) => moveNodes(d, moves));
    },
    [update],
  );

  // React Flow re-registers this handler whenever its identity changes and may
  // fire it again, so it must be stable and must not set state when nothing changed.
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
      const raw = e.dataTransfer.getData(DND_MIME);
      if (!raw || !update) return;
      const payload = JSON.parse(raw) as DragPayload;
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const r = addNode(docRef.current, payload.kind, { x: p.x - 100, y: p.y - 30 }, scope, payload.data);
      update(() => r.doc);
      onSelectRef.current?.({ nodeId: r.id });
    },
    [rf, update, scope],
  );

  const minimap = useMemo(() => nodes.length > 6, [nodes.length]);

  return (
    <ReactFlow<FlowNode, FlowEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={readOnly ? undefined : onConnect}
      isValidConnection={isValidConnection}
      onNodeDragStop={readOnly ? undefined : onNodeDragStop}
      onNodeDoubleClick={(_, n) => n.id !== BOUNDARY_IN && n.id !== BOUNDARY_OUT && onOpen?.(n.id)}
      onSelectionChange={onSelectionChange}
      onDrop={readOnly ? undefined : onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      connectionMode={ConnectionMode.Strict}
      zoomOnDoubleClick={false}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
      colorMode={resolveTheme(theme)}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1, minZoom: 0.55 }}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
      <Controls showInteractive={false} position="bottom-left" />
      {minimap && <MiniMap pannable zoomable position="bottom-right" className="hidden md:block" style={{ width: 140, height: 96 }} />}
    </ReactFlow>
  );
}
