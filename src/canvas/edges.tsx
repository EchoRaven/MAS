import { memo, useContext, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, useReactFlow, type EdgeProps } from "@xyflow/react";
import { Filter, ShieldAlert, ShieldCheck, SquareFunction } from "lucide-react";
import { cn } from "@/lib/utils";
import { EdgeEditContext } from "./context";
import { EDGE_COLOR, type FlowEdge } from "./convert";
import { loopPath, pointAlong, routedPath, type Pt } from "./edgePaths";
import { Waypoints } from "./edgeWaypoints";

const KIND_SHORT = { message: "msg", call: "call", handoff: "handoff", access: "" } as const;

export const SysEdgeView = memo(function SysEdgeView(props: EdgeProps<FlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, markerStart, selected, data } = props;
  const e = data!.sys;
  const rf = useReactFlow();
  const edit = useContext(EdgeEditContext);
  // the label lives in its own layer: clicking it selects this edge
  const selectSelf = () => {
    rf.setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    rf.setEdges((es) => es.map((x) => (x.selected !== (x.id === id) ? { ...x, selected: x.id === id } : x)));
  };
  // waypoints follow the pointer while dragged and are saved on release
  const [live, setLive] = useState<Pt[] | null>(null);
  const points = live ?? e.points ?? [];
  const s = { x: sourceX, y: sourceY };
  const t = { x: targetX, y: targetY };
  const routed = routedPath(s, sourcePosition, t, targetPosition, points);
  // with no waypoints: the usual curve, or a loop above for an output feeding an earlier input
  const backward = sourcePosition === Position.Right && targetPosition === Position.Left && targetX < sourceX - 20;
  const [path, lx, ly] = points.length
    ? [routed.path, routed.label.x, routed.label.y - 16] // lifted off the curve so the segment's "+" stays reachable
    : backward
      ? loopPath(sourceX, sourceY, targetX, targetY)
      : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const color = data?.blocked ? "hsl(var(--destructive))" : EDGE_COLOR[e.kind];
  const width = e.kind === "handoff" ? 2.25 : 1.5;
  const ports = data?.showPorts;
  const portText = ports?.source || ports?.target ? `${ports.source ? e.source_port : ""}→${ports.target ? e.target_port : ""}` : null;
  const text =
    e.kind === "access"
      ? [e.access === "read" ? "read" : "read/write", e.binding?.mode && e.binding.mode !== "tool" ? e.binding.mode.replace("_", "-") : null].filter(Boolean).join(" · ")
      : [portText, e.label, e.kind === "handoff" && e.carry ? `carries ${e.carry}` : null].filter(Boolean).join(" · ") || KIND_SHORT[e.kind];
  // where new waypoints can be pulled out: each segment's middle, or, on a plain edge, one spot clear of the label
  const mids = points.length ? routed.mids : backward ? [{ x: lx - 48, y: ly }] : [pointAlong(s, sourcePosition, t, targetPosition, 0.28)];

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{
          stroke: color,
          strokeWidth: selected ? width + 1 : width,
          strokeDasharray: e.kind === "access" ? "4 4" : data?.active ? "6 4" : undefined,
          animation: data?.active ? "mas-dash 0.6s linear infinite" : undefined,
          opacity: data?.active || selected ? 1 : 0.85,
        }}
        interactionWidth={18}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex cursor-pointer items-center gap-1"
          onClick={selectSelf}
          title={edit.setPoints ? "Select the edge to route it through waypoints" : undefined}
          data-testid={`edge-label-${id}`}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
        >
          {e.gate && (
            <span
              title={`Gate "${e.gate.name}": ${e.gate.condition}`}
              className={cn(
                "flex h-6 w-6 rotate-45 items-center justify-center rounded-[5px] border bg-card shadow-[var(--ring-shadow)]",
                data?.blocked ? "border-destructive text-destructive" : "border-warning/60 text-warning",
              )}
            >
              <span className="-rotate-45">{data?.blocked ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}</span>
            </span>
          )}
          {e.transform && (
            <span title={`Transform (${e.transform.lang}): ${e.transform.code}`} className="flex h-5 w-5 items-center justify-center rounded-md bg-card text-info shadow-[var(--ring-shadow)]">
              <SquareFunction className="h-3 w-3" />
            </span>
          )}
          {e.filter && (
            <span title={`Filter: ${e.filter}`} className="flex h-5 w-5 items-center justify-center rounded-md bg-card text-muted-foreground shadow-[var(--ring-shadow)]">
              <Filter className="h-3 w-3" />
            </span>
          )}
          {text && (
            <span
              className={cn(
                "rounded-full bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-[var(--ring-shadow)]",
                selected && "text-foreground ring-1 ring-ring",
                data?.issues ? "text-warning" : "",
              )}
            >
              {text}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
      {selected && edit.setPoints && (
        <Waypoints edgeId={id} points={points} mids={mids} onLive={setLive} onCommit={(pts) => edit.setPoints!(id, pts)} />
      )}
    </>
  );
});

export const EDGE_TYPES = { sys: SysEdgeView };
