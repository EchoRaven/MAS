// How many samples a model component takes (ModelNodeData.replicas). One
// reading for the engine, the validator and the simulator:
//   absent, "" or 1     one call, one reply
//   5                   five calls, a list of five replies
//   "{{vars.n}}"        the run variable n (an evaluation can sweep it)
//   "{{vars.n ?? 10}}"  the run variable n, or 10 when the run does not set it

const VAR = /^\s*\{\{\s*vars\.([A-Za-z_]\w*)\s*(?:\?\?\s*(\d+)\s*)?\}\}\s*$/;
export const MAX_REPLICAS = 50;

export type ReplicaSpec = { kind: "one" } | { kind: "fixed"; n: number } | { kind: "var"; name: string; fallback: number | null } | { kind: "invalid"; why: string };

export function parseReplicas(r: number | string | null | undefined): ReplicaSpec {
  if (r == null || r === "" || r === 1 || r === "1") return { kind: "one" };
  if (typeof r === "number" || /^\s*\d+\s*$/.test(r)) {
    const n = Number(r);
    return Number.isInteger(n) && n >= 1 && n <= MAX_REPLICAS ? (n === 1 ? { kind: "one" } : { kind: "fixed", n }) : { kind: "invalid", why: `replicas must be a whole number from 1 to ${MAX_REPLICAS} (got ${r})` };
  }
  const m = VAR.exec(r);
  if (!m) return { kind: "invalid", why: `replicas must be a number, {{vars.<name>}} or {{vars.<name> ?? <default>}} (got ${JSON.stringify(r)})` };
  const fallback = m[2] === undefined ? null : Number(m[2]);
  if (fallback !== null && (fallback < 1 || fallback > MAX_REPLICAS)) return { kind: "invalid", why: `the default for replicas must be from 1 to ${MAX_REPLICAS}` };
  return { kind: "var", name: m[1], fallback };
}

/** The number of samples for this run: null for a plain single call, else 2..50. Throws when it cannot be read. */
export function replicaCount(r: number | string | null | undefined, vars: Record<string, unknown>): number | null {
  const s = parseReplicas(r);
  if (s.kind === "one") return null;
  if (s.kind === "invalid") throw new Error(s.why);
  let n: number;
  if (s.kind === "fixed") n = s.n;
  else {
    const v = vars[s.name];
    if (v === undefined || v === null || v === "") {
      if (s.fallback === null) throw new Error(`replicas reads the run variable ${s.name}, which this run does not set (give it, or a default: {{vars.${s.name} ?? 5}})`);
      n = s.fallback;
    } else n = Number(v);
  }
  if (!Number.isFinite(n)) throw new Error(`replicas must be a number (the run variable gave ${JSON.stringify(n)})`);
  n = Math.floor(n);
  if (n < 1 || n > MAX_REPLICAS) throw new Error(`replicas must be between 1 and ${MAX_REPLICAS} (got ${n})`);
  return n === 1 ? null : n;
}

/** Samples to assume when the run's variables are not known (estimates, simulated runs). */
export const replicaEstimate = (r: number | string | null | undefined): number => {
  const s = parseReplicas(r);
  return s.kind === "fixed" ? s.n : s.kind === "var" ? (s.fallback ?? 1) : 1;
};
