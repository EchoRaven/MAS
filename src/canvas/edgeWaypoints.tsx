// Draggable waypoints on a selected edge: move a dot, pull a new one out of
// a segment's "+", double-click a dot to remove it.
import { useRef, type PointerEvent } from "react";
import { useReactFlow, ViewportPortal } from "@xyflow/react";
import type { Pt } from "./edgePaths";

export function Waypoints({
  edgeId,
  points,
  mids,
  onLive,
  onCommit,
}: {
  edgeId: string;
  points: Pt[];
  mids: Pt[];
  /** the points while dragging (null = drag ended) */
  onLive: (pts: Pt[] | null) => void;
  onCommit: (pts: Pt[]) => void;
}) {
  const rf = useReactFlow();
  const drag = useRef<{ index: number; pts: Pt[]; moved: boolean } | null>(null);

  const start = (ev: PointerEvent, index: number, pts: Pt[]) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    (ev.target as Element).setPointerCapture(ev.pointerId);
    drag.current = { index, pts, moved: false };
  };
  const move = (ev: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    d.pts = d.pts.map((q, i) => (i === d.index ? p : q));
    onLive(d.pts);
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    onLive(null);
    if (d?.moved) onCommit(d.pts);
  };
  const dot = "nodrag nopan pointer-events-auto absolute rounded-full";

  return (
    <ViewportPortal>
      {points.map((p, i) => (
        <div
          key={`p${i}`}
          data-testid={`waypoint-${edgeId}-${i}`}
          title="Drag to move · double-click to remove"
          className={`${dot} h-3 w-3 cursor-grab border-2 border-ring bg-card shadow-sm active:cursor-grabbing`}
          style={{ transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)` }}
          onPointerDown={(ev) => start(ev, i, points)}
          onPointerMove={move}
          onPointerUp={end}
          onDoubleClick={(ev) => {
            ev.stopPropagation();
            onCommit(points.filter((_, j) => j !== i));
          }}
        />
      ))}
      {mids.map((m, k) => (
        <div
          key={`m${k}`}
          data-testid={`waypoint-add-${edgeId}-${k}`}
          title="Drag to add a waypoint"
          className={`${dot} flex h-3.5 w-3.5 cursor-copy items-center justify-center border border-ring/50 bg-card/90 text-[10px] leading-none text-ring opacity-70 hover:opacity-100`}
          style={{ transform: `translate(-50%, -50%) translate(${m.x}px, ${m.y}px)` }}
          // a new point goes between the segment's two ends: index k in the waypoint list
          onPointerDown={(ev) => start(ev, k, [...points.slice(0, k), m, ...points.slice(k)])}
          onPointerMove={move}
          onPointerUp={end}
        >
          +
        </div>
      ))}
    </ViewportPortal>
  );
}
