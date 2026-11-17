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
  /** every chat model of the system was served by this one */
  on_model?: string;
  status: "running" | "finished" | "stopped";
  started_at: string;
  finished_at?: string;
  cases: EvalCaseResult[];
  passed: number;
  graded: number;
  usd: number;
}

const ANSWER_LINE = /(?:^|\n)\s*(?:\*\*)?(?:final answer|answer|final)(?:\*\*)?\s*[:：]\s*(?:\*\*)?([^\n]+)/gi;

/**
 * The final answer in an output: the last "Answer:" / "Final:" line (or the
 * line after it, when the marker stands alone as in "**Final Answer:**"),
 * else the last non-empty line. Bold markers are kept: they say which part
 * is the answer.
 */
export function finalAnswer(output: string): string {
  const marked = [...output.matchAll(ANSWER_LINE)];
  if (marked.length) {
    const m = marked[marked.length - 1];
    const same = m[1].replace(/^\*+|\*+$/g, "").trim();
    if (same) return m[1].trim();
    const after = output.slice((m.index ?? 0) + m[0].length).split("\n").map((l) => l.trim()).find(Boolean);
    if (after) return after;
  }
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/** The number an answer gives: \boxed{…} first, then bold text, then the first number in it. */
export function answerNumber(answer: string): number | null {
  const boxed = /\\boxed\{([^}]*)\}/.exec(answer);
  if (boxed && parseNumber(boxed[1]) !== null) return parseNumber(boxed[1]);
  for (const b of answer.matchAll(/\*\*([^*]+)\*\*/g)) if (parseNumber(b[1]) !== null) return firstNumber(b[1]);
  return firstNumber(answer);
}

function firstNumber(s: string): number | null {
  const m = /-?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?%?/.exec(s);
  return m ? parseNumber(m[0]) : null;
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
    const got = answerNumber(answer) ?? parseNumber(output);
    const want = parseNumber(expected);
    if (want === null) return { pass: false, answer, why: `the expected answer "${expected}" is not a number` };
    if (got === null) return { pass: false, answer, why: "no number in the answer" };
    const pass = Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want));
    return { pass, answer, why: pass ? `${got} = ${want}` : `${got} ≠ ${want}` };
  }
  const a = normalize(answer.replace(/\*+/g, ""));
  const e = normalize(expected);
  // an option letter alone ("B") matches an answer that starts with it ("B. Hyperkalaemia", "(B)")
  const letter = /^[a-z]$/.test(e) && new RegExp(`^\\(?${e}\\)?(\\s|$)`).test(a);
  const pass = a === e || letter;
  return { pass, answer, why: pass ? "the final answer matches" : `"${answer}" is not "${expected}"` };
}

/**
 * Cases from pasted text: JSON lines ({input, expected}, or question/answer),
 * or one case per line as "question | expected" (a tab works as well).
 */
export function parseCases(text: string): { cases: EvalCase[]; skipped: number } {
  const cases: EvalCase[] = [];
  let skipped = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("{")) {
      try {
        const o = JSON.parse(line) as Record<string, unknown>;
        const input = o.input ?? o.question ?? o.prompt;
        const expected = o.expected ?? o.answer ?? o.target;
        if (input != null && expected != null) {
          cases.push({ input: String(input), expected: String(expected) });
          continue;
        }
      } catch {
        /* not JSON: counted as skipped */
      }
      skipped++;
      continue;
    }
    const cut = Math.max(line.lastIndexOf(" | "), line.lastIndexOf("\t"));
    if (cut <= 0) {
      skipped++;
      continue;
    }
    const sep = line[cut] === "\t" ? 1 : 3;
    const input = line.slice(0, cut).trim();
    const expected = line.slice(cut + sep).trim();
    if (input && expected) cases.push({ input, expected });
    else skipped++;
  }
  return { cases, skipped };
}

/** Small ready-made sets to try an evaluation with. Answers checked by hand. */
export const SAMPLE_SETS: { name: string; grader: Grader; text: string }[] = [
  {
    name: "Reasoning traps",
    grader: "number",
    text: [
      "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost, in dollars? | 0.05",
      "A train leaves at 3:40 pm and arrives at 6:15 pm the same day. How many minutes does the trip take? | 155",
      "If 5 machines take 5 minutes to make 5 widgets, how many minutes would 100 machines take to make 100 widgets? | 5",
      "A patch of lily pads doubles in size every day. It covers the whole lake on day 48. On which day did it cover half the lake? | 47",
      "Alice walks up a hill at 1 m/s and comes back down the same path at 3 m/s. What is her average speed for the whole trip, in m/s? | 1.5",
      "How many trailing zeros does 100! have when written in base 12? | 48",
    ].join("\n"),
  },
  {
    name: "Harder counting",
    grader: "number",
    text: [
      "What is the sum of all integers from 1 to 200 that are divisible by 3 or by 5? | 9368",
      "In how many ways can 8 people sit around a round table if two particular people refuse to sit next to each other? (Rotations of the same seating count once.) | 3600",
      "How many three-digit numbers have digits that add up to 10? | 54",
      "In how many ways can you make 50 cents from pennies, nickels, dimes and quarters? | 49",
      "What is the remainder when 2^100 is divided by 7? | 2",
      "A clock shows 3:15. What is the smaller angle between the hour and minute hands, in degrees? | 7.5",
      "How many positive divisors does 360 have? | 24",
      "What is 17 × 24 − 13 × 19? | 161",
    ].join("\n"),
  },
];
