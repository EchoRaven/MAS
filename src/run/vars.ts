// Run variables: values a run starts with, which function code reads as
// ctx.vars.<name> (Exchange-of-Thought's paradigm, say).
import type { SystemDoc } from "@/model/types";

/** "paradigm=report, rounds=3" or one per line; numbers, true/false and JSON are parsed, the rest stays text. */
export function parseVars(text: string): { vars: Record<string, unknown>; bad: string[] } {
  const vars: Record<string, unknown> = {};
  const bad: string[] = [];
  // a comma separates two variables only when another name= follows, so JSON values keep theirs
  for (const part of text.split(/\n|,(?=\s*[A-Za-z_]\w*\s*=)/)) {
    const t = part.trim();
    if (!t) continue;
    const m = /^([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(t);
    if (!m) {
      bad.push(t);
      continue;
    }
    const raw = m[2].trim();
    let v: unknown = raw;
    if (/^-?\d+(\.\d+)?$/.test(raw)) v = Number(raw);
    else if (raw === "true" || raw === "false") v = raw === "true";
    else if (/^[[{"]/.test(raw)) {
      try {
        v = JSON.parse(raw);
      } catch {
        /* keep the text */
      }
    }
    vars[m[1]] = v;
  }
  return { vars, bad };
}

export const formatVars = (vars: Record<string, unknown> | undefined) =>
  Object.entries(vars ?? {})
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");

const VAR_REF = /\{\{\s*vars\.([A-Za-z_]\w*)\s*(?:\?\?\s*([^}]*?)\s*)?\}\}/g;

/**
 * "{{vars.k}}" and "{{vars.k ?? 3}}" in text (an agent's instructions), filled from the run's variables;
 * a default is used when the run does not set it. Other braces, and a variable with neither, stay as written.
 */
export function fillVars(text: string, vars: Record<string, unknown>): string {
  if (!text.includes("{{")) return text;
  return text.replace(VAR_REF, (all, name: string, fallback: string | undefined) => {
    const v = vars[name];
    if (v !== undefined && v !== null && v !== "") return typeof v === "string" ? v : JSON.stringify(v);
    return fallback !== undefined ? fallback.replace(/^(["'])(.*)\1$/, "$2") : all;
  });
}

/** Variables the system's code reads but never sets: the ones a run can be started with. */
export function readVars(doc: SystemDoc): string[] {
  const read = new Set<string>();
  const written = new Set<string>();
  const scan = (code: string) => {
    for (const m of code.matchAll(/ctx\.vars\.([A-Za-z_]\w*)(\s*(?:\?\?|\|\|)?=(?!=))?/g)) (m[2] ? written : read).add(m[1]);
    for (const m of code.matchAll(/ctx\.vars\[["'](\w+)["']\]/g)) read.add(m[1]);
  };
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if ((k === "code" || k === "loop_fn") && typeof x === "string") scan(x);
      // "{{vars.k ?? 3}}" in instructions, round limits and replicas
      else if (typeof x === "string") for (const m of x.matchAll(VAR_REF)) read.add(m[1]);
      else walk(x);
    }
  };
  for (const n of doc.nodes) walk(n.data);
  for (const e of doc.edges) walk(e);
  return [...read].filter((k) => !written.has(k)).sort();
}
