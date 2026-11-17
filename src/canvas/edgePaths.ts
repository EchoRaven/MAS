// Edge geometry: feedback loops and edges routed through user waypoints.
import { Position } from "@xyflow/react";

export interface Pt {
  x: number;
  y: number;
}

/** A feedback edge: out of the right side, up, back over both nodes, into the left side (access edges run below). */
export function loopPath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const drop = Math.min(sy, ty) - 80;
  return [`M ${sx} ${sy} C ${sx + 70} ${sy}, ${sx + 70} ${drop}, ${sx} ${drop} L ${tx} ${drop} C ${tx - 70} ${drop}, ${tx - 70} ${ty}, ${tx} ${ty}`, (sx + tx) / 2, drop];
}

const DIR: Record<Position, Pt> = {
  [Position.Right]: { x: 1, y: 0 },
  [Position.Left]: { x: -1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};

const cubicAt = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
};

export interface RoutedPath {
  path: string;
  /** where the label goes: the middle of the middle segment */
  label: Pt;
  /** on-curve midpoint of each segment, where a new waypoint can be pulled out */
  mids: Pt[];
}

/**
 * A smooth curve from the source handle through every waypoint to the target
 * handle (Catmull-Rom tangents inside; the ends leave and enter along the
 * handles' directions).
 */
export function routedPath(s: Pt, sp: Position, t: Pt, tp: Position, points: Pt[]): RoutedPath {
  const a = [s, ...points, t];
  const n = a.length - 1;
  const dist = (p: Pt, q: Pt) => Math.hypot(q.x - p.x, q.y - p.y);
  const tan: Pt[] = a.map((_, i) => {
    if (i === 0) {
      const k = Math.max(40, dist(a[0], a[1]));
      return { x: DIR[sp].x * k, y: DIR[sp].y * k };
    }
    if (i === n) {
      const k = Math.max(40, dist(a[n - 1], a[n]));
      return { x: -DIR[tp].x * k, y: -DIR[tp].y * k };
    }
    return { x: (a[i + 1].x - a[i - 1].x) * 0.5, y: (a[i + 1].y - a[i - 1].y) * 0.5 };
  });
  let path = `M ${s.x} ${s.y}`;
  const mids: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = a[i];
    const p3 = a[i + 1];
    const p1 = { x: p0.x + tan[i].x / 3, y: p0.y + tan[i].y / 3 };
    const p2 = { x: p3.x - tan[i + 1].x / 3, y: p3.y - tan[i + 1].y / 3 };
    path += ` C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
    mids.push(cubicAt(p0, p1, p2, p3, 0.5));
  }
  return { path, label: mids[Math.floor((mids.length - 1) / 2)], mids };
}

/** A point part-way along the waypoint-free curve (where to offer the first "+", clear of the label). */
export function pointAlong(s: Pt, sp: Position, t: Pt, tp: Position, frac: number): Pt {
  const k = Math.max(40, Math.hypot(t.x - s.x, t.y - s.y));
  const p1 = { x: s.x + (DIR[sp].x * k) / 3, y: s.y + (DIR[sp].y * k) / 3 };
  const p2 = { x: t.x + (DIR[tp].x * k) / 3, y: t.y + (DIR[tp].y * k) / 3 };
  return cubicAt(s, p1, p2, t, frac);
}
