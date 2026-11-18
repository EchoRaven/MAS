// Counts that a run can set: how many samples a model component takes
// (ModelNodeData.replicas) and how many rounds a group may run
// (GroupData.iterate.max_rounds). One reading for the engine, the validator
// and the simulator:
//   5                   five
//   "{{vars.n}}"        the run variable n (an evaluation can sweep it)
//   "{{vars.n ?? 10}}"  the run variable n, or 10 when the run does not set it

const VAR = /^\s*\{\{\s*vars\.([A-Za-z_]\w*)\s*(?:\?\?\s*(\d+)\s*)?\}\}\s*$/;
export const MAX_REPLICAS = 50;
export const MAX_ROUNDS = 100;

export type CountSpec = { kind: "fixed"; n: number } | { kind: "var"; name: string; fallback: number | null } | { kind: "invalid"; why: string };

/** A count as written: a whole number from 1 to max, or a run variable with an optional default. */
export function parseCount(r: number | string, what: string, max: number): CountSpec {
  if (typeof r === "number" || /^\s*\d+\s*$/.test(r)) {
    const n = Number(r);
    return Number.isInteger(n) && n >= 1 && n <= max ? { kind: "fixed", n } : { kind: "invalid", why: `${what} must be a whole number from 1 to ${max} (got ${r})` };
  }
  const m = VAR.exec(r);
  if (!m) return { kind: "invalid", why: `${what} must be a number, {{vars.<name>}} or {{vars.<name> ?? <default>}} (got ${JSON.stringify(r)})` };
  const fallback = m[2] === undefined ? null : Number(m[2]);
  if (fallback !== null && (fallback < 1 || fallback > max)) return { kind: "invalid", why: `the default for ${what} must be from 1 to ${max}` };
  return { kind: "var", name: m[1], fallback };
}

/** The count for this run. Throws when it cannot be read. */
export function resolveCount(r: number | string, vars: Record<string, unknown>, what: string, max: number): number {
  const s = parseCount(r, what, max);
  if (s.kind === "invalid") throw new Error(s.why);
  if (s.kind === "fixed") return s.n;
  const v = vars[s.name];
  let n: number;
  if (v === undefined || v === null || v === "") {
    if (s.fallback === null) throw new Error(`${what} reads the run variable ${s.name}, which this run does not set (give it, or a default: {{vars.${s.name} ?? 3}})`);
    n = s.fallback;
  } else n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > max) throw new Error(`${what} must be from 1 to ${max} (the run variable ${s.name} gave ${JSON.stringify(v)})`);
  return n;
}

/** The count to assume when the run's variables are not known (estimates, simulated runs). */
export function estimateCount(r: number | string): number {
  const s = parseCount(r, "count", Number.MAX_SAFE_INTEGER);
  return s.kind === "fixed" ? s.n : s.kind === "var" ? (s.fallback ?? 1) : 1;
}

// ---- replicas: absent or 1 is a plain call; more is an ensemble that sends a list ----

export type ReplicaSpec = { kind: "one" } | CountSpec;

export function parseReplicas(r: number | string | null | undefined): ReplicaSpec {
  if (r == null || r === "" || r === 1 || r === "1") return { kind: "one" };
  return parseCount(r, "replicas", MAX_REPLICAS);
}

/** The number of samples for this run: null for a plain single call, else the count (a list even when it is 1). */
export function replicaCount(r: number | string | null | undefined, vars: Record<string, unknown>): number | null {
  if (parseReplicas(r).kind === "one") return null;
  const n = resolveCount(r as number | string, vars, "replicas", MAX_REPLICAS);
  return n === 1 ? null : n;
}

export const replicaEstimate = (r: number | string | null | undefined): number => (parseReplicas(r).kind === "one" ? 1 : estimateCount(r as number | string));

// ---- rounds of a group ----

export const roundLimit = (r: number | string, vars: Record<string, unknown>): number => resolveCount(r, vars, "max rounds", MAX_ROUNDS);
