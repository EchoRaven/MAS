// Evaluations: a system run over a set of cases, each graded against the
// answer it should give. What the papers report as accuracy.

export interface EvalCase {
  input: string;
  expected: string;
}

/**
 * How an output is compared with the expected answer.
 * - answer: the final answer (after "Answer:" / "Final:", else the last line) equals it, ignoring case and punctuation
 * - contains: the output contains it anywhere
 * - number: the last number in the final answer equals it (fractions and percentages too)
 * - llm: a model judges whether the output gives the expected answer
 */
export type Grader = "answer" | "contains" | "number" | "llm";

export interface EvalCaseResult {
  input: string;
  expected: string;
  status: "pending" | "running" | "done" | "error";
  run_id?: string;
  output?: string;
  /** the part of the output that was graded */
  answer?: string;
  pass?: boolean;
  why?: string;
  usd?: number;
  seconds?: number;
}

export interface EvalRecord {
  id: string;
  system_id: string;
  system_name: string;
  grader: Grader;
  mock: boolean;
  status: "running" | "finished" | "stopped";
  started_at: string;
  finished_at?: string;
  cases: EvalCaseResult[];
  passed: number;
  graded: number;
  usd: number;
}

const ANSWER_LINE = /(?:^|\n)\s*(?:\*\*)?(?:final answer|answer|final)(?:\*\*)?\s*[:：]\s*(?:\*\*)?([^\n]+)/gi;

/** The final answer in an output: the last "Answer:" / "Final:" line, else the last non-empty line. */
export function finalAnswer(output: string): string {
  const marked = [...output.matchAll(ANSWER_LINE)].map((m) => m[1]);
  if (marked.length) return marked[marked.length - 1].replace(/\*+/g, "").trim();
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/\$|\\boxed\{|\}/g, "")
    .replace(/[^\p{L}\p{N}./%-]+/gu, " ")
    .replace(/[.]+(\s|$)/g, "$1")
    .trim();

/** A number in a text: 12, -3.5, 1,234, 1/3, 40%. */
export function parseNumber(s: string): number | null {
  const t = s.replace(/,(?=\d{3})/g, "");
  const nums = [...t.matchAll(/-?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?%?/g)].map((m) => m[0]);
  if (!nums.length) return null;
  const last = nums[nums.length - 1].replace(/\s/g, "");
  if (last.includes("/")) {
    const [a, b] = last.split("/").map(Number);
    return b ? a / b : null;
  }
  if (last.endsWith("%")) return Number(last.slice(0, -1)) / 100;
  return Number(last);
}

/** Grades an output by a rule (every grader but llm). */
export function gradeByRule(grader: Exclude<Grader, "llm">, output: string, expected: string): { pass: boolean; answer: string; why: string } {
  const answer = finalAnswer(output);
  if (grader === "contains") {
    const pass = normalize(output).includes(normalize(expected));
    return { pass, answer, why: pass ? "the output contains the expected answer" : "the expected answer is not in the output" };
  }
  if (grader === "number") {
    const got = parseNumber(answer) ?? parseNumber(output);
    const want = parseNumber(expected);
    if (want === null) return { pass: false, answer, why: `the expected answer "${expected}" is not a number` };
    if (got === null) return { pass: false, answer, why: "no number in the answer" };
    const pass = Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want));
    return { pass, answer, why: pass ? `${got} = ${want}` : `${got} ≠ ${want}` };
  }
  const a = normalize(answer);
  const e = normalize(expected);
  // an option letter alone ("B") matches an answer that starts with it ("B. Hyperkalaemia", "(B)")
  const letter = /^[a-z]$/.test(e) && new RegExp(`^\\(?${e}\\)?(\\s|$)`).test(a);
  const pass = a === e || letter;
  return { pass, answer, why: pass ? "the final answer matches" : `"${answer}" is not "${expected}"` };
}
