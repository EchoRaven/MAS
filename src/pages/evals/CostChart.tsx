// Accuracy against cost per question, one point per evaluation: what a system buys for what it costs. The
// points no other is better than on both (the cost frontier) are filled and named; the rest are rings, named on
// hover. Cost is on a log scale (one agent's cents to five debaters' dollars). The table below is the data view.
import { useState } from "react";

export interface CostPoint {
  id: string;
  label: string;
  setup: string;
  /** 0..1 */
  acc: number;
  /** dollars per question answered */
  perCase: number;
}

/** The points that no other point beats on both accuracy and cost (ties on both keep the first). */
export function frontier(points: CostPoint[]): Set<string> {
  const out = new Set<string>();
  for (const p of points) {
    const beaten = points.some((q) => q !== p && q.acc >= p.acc && q.perCase <= p.perCase && (q.acc > p.acc || q.perCase < p.perCase));
    if (!beaten) out.add(p.id);
  }
  return out;
}

const W = 640;
const H = 260;
const PAD = { l: 44, r: 16, t: 14, b: 34 };

/** Dollars at the precision a cost per question needs. */
const money = (c: number) => (c >= 1 ? `$${c.toFixed(0)}` : c >= 0.01 ? `$${c.toFixed(2)}` : c >= 0.001 ? `$${c.toFixed(3)}` : `$${c.toFixed(4)}`);

export function CostChart({ points }: { points: CostPoint[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const pts = points.filter((p) => p.perCase > 0 && Number.isFinite(p.perCase));
  if (pts.length < 2) return null;
  const front = frontier(pts);
  const lo = Math.log10(Math.min(...pts.map((p) => p.perCase)));
  const hi = Math.log10(Math.max(...pts.map((p) => p.perCase)));
  const [x0, x1] = [Math.floor(lo * 2) / 2, Math.max(Math.ceil(hi * 2) / 2, Math.floor(lo * 2) / 2 + 0.5)];
  const accs = pts.map((p) => p.acc);
  const [y0, y1] = [Math.max(0, Math.floor(Math.min(...accs) * 10) / 10), Math.min(1, Math.ceil(Math.max(...accs) * 10) / 10 || 1)];
  const sx = (c: number) => PAD.l + ((Math.log10(c) - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (a: number) => H - PAD.b - ((a - y0) / Math.max(0.05, y1 - y0)) * (H - PAD.t - PAD.b);
  // a tick at each power of ten and at 3x it
  const xticks: number[] = [];
  for (let e = Math.floor(x0); e <= Math.ceil(x1); e++) for (const m of [1, 3]) if (Math.log10(m * 10 ** e) >= x0 - 1e-9 && Math.log10(m * 10 ** e) <= x1 + 1e-9) xticks.push(m * 10 ** e);
  const yticks: number[] = [];
  for (let a = y0; a <= y1 + 1e-9; a += y1 - y0 > 0.3 ? 0.1 : 0.05) yticks.push(Math.round(a * 100) / 100);
  const line = pts.filter((p) => front.has(p.id)).sort((a, b) => a.perCase - b.perCase);
  const h = pts.find((p) => p.id === hover);
  return (
    <figure className="mt-4">
      <figcaption className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Accuracy against cost per question</span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className="fill-sky-600" /></svg>
          on the cost frontier: nothing cheaper is as accurate
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" className="fill-none stroke-zinc-400 dark:stroke-zinc-600" strokeWidth="1.5" /></svg>
          beaten on both by another
        </span>
      </figcaption>
      <div className="relative w-full max-w-[640px]">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Accuracy against cost per question for ${pts.length} evaluations; ${line.map((p) => p.label).join(", ")} on the cost frontier`}>
          {yticks.map((a) => (
            <g key={a}>
              <line x1={PAD.l} x2={W - PAD.r} y1={sy(a)} y2={sy(a)} className="stroke-border" strokeWidth="1" />
              <text x={PAD.l - 6} y={sy(a) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{Math.round(a * 100)}%</text>
            </g>
          ))}
          {xticks.map((c) => (
            <text key={c} x={sx(c)} y={H - PAD.b + 16} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">{money(c)}</text>
          ))}
          <text x={(PAD.l + W - PAD.r) / 2} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[11px]">cost per question (log scale)</text>
          <polyline points={line.map((p) => `${sx(p.perCase)},${sy(p.acc)}`).join(" ")} className="fill-none stroke-sky-600" strokeWidth="2" strokeLinejoin="round" opacity="0.5" />
          {pts.map((p) => {
            const on = front.has(p.id);
            return (
              <g key={p.id} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover((x) => (x === p.id ? null : x))} onFocus={() => setHover(p.id)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${p.label}, ${p.setup}: ${Math.round(p.acc * 1000) / 10}% at ${money(p.perCase)} a question`}>
                <circle cx={sx(p.perCase)} cy={sy(p.acc)} r="12" fill="transparent" />
                {on ? (
                  <circle cx={sx(p.perCase)} cy={sy(p.acc)} r="5" className="fill-sky-600 stroke-card" strokeWidth="2" />
                ) : (
                  <circle cx={sx(p.perCase)} cy={sy(p.acc)} r="4" className="fill-card stroke-zinc-400 dark:stroke-zinc-600" strokeWidth="1.5" />
                )}
              </g>
            );
          })}
          {/* the frontier's names, after every point so that none is drawn over them; beside the point, on its
              level (to the left near the right edge), on a halo of the surface */}
          {line.map((p) => (
            <text key={p.id} x={sx(p.perCase) > W - 160 ? sx(p.perCase) - 9 : sx(p.perCase) + 9} y={sy(p.acc) + 4} textAnchor={sx(p.perCase) > W - 160 ? "end" : "start"} className="pointer-events-none fill-foreground stroke-card text-[11px]" strokeWidth="3" paintOrder="stroke">
              {p.label}
            </text>
          ))}
        </svg>
        {h && (
          <div className="pointer-events-none absolute z-10 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-sm" style={{ left: `${(sx(h.perCase) / W) * 100}%`, top: `${(sy(h.acc) / H) * 100}%`, transform: "translate(10px, -110%)" }}>
            <div className="font-medium">{h.label}</div>
            <div className="text-muted-foreground">{h.setup}</div>
            <div className="tabular-nums">
              {Math.round(h.acc * 1000) / 10}% · {money(h.perCase)} a question
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
