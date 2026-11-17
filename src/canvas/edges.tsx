import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, useReactFlow, type EdgeProps } from "@xyflow/react";
import { Filter, ShieldAlert, ShieldCheck, SquareFunction } from "lucide-react";
import { cn } from "@/lib/utils";
import { EDGE_COLOR, type FlowEdge } from "./convert";

/** A feedback edge: out of the right side, up, back over both nodes, into the left side (access edges run below). */
function loopPath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const drop = Math.min(sy, ty) - 80;
  const path = `M ${sx} ${sy} C ${sx + 70} ${sy}, ${sx + 70} ${drop}, ${sx} ${drop} L ${tx} ${drop} C ${tx - 70} ${drop}, ${tx - 70} ${ty}, ${tx} ${ty}`;
  return [path, (sx + tx) / 2, drop];
}

const KIND_SHORT = { message: "msg", call: "call", handoff: "handoff", access: "" } as const;

export const SysEdgeView = memo(function SysEdgeView(props: EdgeProps<FlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, markerStart, selected, data } = props;
  const e = data!.sys;
  const rf = useReactFlow();
  // the label lives in its own layer: clicking it selects this edge
  const selectSelf = () => {
    rf.setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    rf.setEdges((es) => es.map((x) => (x.selected !== (x.id === id) ? { ...x, selected: x.id === id } : x)));
  };
  // an output that feeds back to an earlier input loops underneath instead of cutting across
  const backward = sourcePosition === Position.Right && targetPosition === Position.Left && targetX < sourceX - 20;
  const [path, lx, ly] = backward ? loopPath(sourceX, sourceY, targetX, targetY) : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const color = data?.blocked ? "hsl(var(--destructive))" : EDGE_COLOR[e.kind];
  const width = e.kind === "handoff" ? 2.25 : 1.5;
  const ports = data?.showPorts;
  const portText = ports?.source || ports?.target ? `${ports.source ? e.source_port : ""}→${ports.target ? e.target_port : ""}` : null;
  const text =
    e.kind === "access"
      ? [e.access === "read" ? "read" : "read/write", e.binding?.mode && e.binding.mode !== "tool" ? e.binding.mode.replace("_", "-") : null].filter(Boolean).join(" · ")
      : [portText, e.label, e.kind === "handoff" && e.carry ? `carries ${e.carry}` : null].filter(Boolean).join(" · ") || KIND_SHORT[e.kind];

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
    </>
  );
});

export const EDGE_TYPES = { sys: SysEdgeView };
