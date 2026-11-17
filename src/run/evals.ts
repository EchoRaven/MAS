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
  /** which question (index into the set) and which repeat of it (0-based) */
  case?: number;
  repeat?: number;
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
  /** how many times every question was run */
  repeats?: number;
  mock: boolean;
  /** every chat model of the system was served by this one */
  on_model?: string;
  /** run variables every case started with */
  vars?: Record<string, unknown>;
  /** chosen models of the system served by others */
  model_map?: Record<string, string>;
  status: "running" | "finished" | "stopped";
  /** why it stopped on its own, when it did */
  stop_reason?: string;
  started_at: string;
  finished_at?: string;
  cases: EvalCaseResult[];
  passed: number;
  graded: number;
  usd: number;
}

/** Which question set an evaluation ran: the same questions and answers give the same id, whatever the order or repeats. */
export function caseSetId(cases: Pick<EvalCaseResult, "input" | "expected">[]): string {
  const uniq = [...new Set(cases.map((c) => `${c.input}\u0000${c.expected}`))].sort();
  let h = 0x811c9dc5;
  for (const ch of uniq.join("\u0001")) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return `set_${(h >>> 0).toString(36)}_${uniq.length}`;
}

/** Accuracy of each repeat, their mean and standard deviation, and how often each question passed. */
export function repeatStats(rec: Pick<EvalRecord, "cases" | "repeats">) {
  const n = rec.repeats ?? 1;
  const per = Array.from({ length: n }, (_, r) => {
    const cs = rec.cases.filter((c) => (c.repeat ?? 0) === r && c.pass !== undefined);
    return cs.length ? cs.filter((c) => c.pass).length / cs.length : null;
  }).filter((x): x is number => x !== null);
  const mean = per.length ? per.reduce((a, b) => a + b, 0) / per.length : null;
  const sd = per.length > 1 && mean !== null ? Math.sqrt(per.reduce((a, b) => a + (b - mean) ** 2, 0) / (per.length - 1)) : null;
  const byCase = new Map<number, { passed: number; graded: number }>();
  rec.cases.forEach((c, i) => {
    const k = c.case ?? i;
    const e = byCase.get(k) ?? { passed: 0, graded: 0 };
    if (c.pass !== undefined) e.graded++;
    if (c.pass) e.passed++;
    byCase.set(k, e);
  });
  return { per, mean, sd, byCase };
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

/** Every number in a text, in order: 12, -3.5, 1,234, 1/3, 40%. */
export function numbersIn(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/-?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?%?/g)) {
    const v = parseNumber(m[0]);
    if (v !== null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * The number an answer gives. \boxed{…} wins; then a short bold value; then
 * the first number in the answer that the question does not already contain
 * ("There are 49 ways to make 50 cents": 50 is from the question); then the
 * first number at all.
 */
export function answerNumber(answer: string, question = ""): number | null {
  const boxed = /\\boxed\{([^}]*)\}/.exec(answer);
  if (boxed && parseNumber(boxed[1]) !== null) return parseNumber(boxed[1]);
  for (const b of answer.matchAll(/\*\*([^*]+)\*\*/g)) {
    const words = b[1].trim().split(/\s+/).length;
    const n = numbersIn(b[1]);
    if (words <= 4 && n.length) return n[0];
  }
  const given = new Set(numbersIn(question));
  const all = numbersIn(answer);
  return all.find((v) => !given.has(v)) ?? all[0] ?? null;
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
export function gradeByRule(grader: Exclude<Grader, "llm">, output: string, expected: string, question = ""): { pass: boolean; answer: string; why: string } {
  const answer = finalAnswer(output);
  if (grader === "contains") {
    const pass = normalize(output).includes(normalize(expected));
    return { pass, answer, why: pass ? "the output contains the expected answer" : "the expected answer is not in the output" };
  }
  if (grader === "number") {
    const got = answerNumber(answer, question) ?? parseNumber(output);
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
  {
    name: "Competition (20)",
    grader: "number",
    // answers computed by program, not by hand
    text: [
      "How many integers from 1 to 1000 are divisible by none of 2, 3 and 5? | 266",
      "What is the sum of the decimal digits of 2^50? | 76",
      "How many trailing zeros does 1000! have? | 249",
      "How many shortest lattice paths go from (0,0) to (10,10), moving one step right or up at a time, without passing through the point (5,5)? | 121252",
      "How many integers from 1 to 10000 are perfect squares or perfect cubes (or both)? | 117",
      "What are the last two digits of 7^2024? Give them as a number. | 1",
      "In how many ways can a 2 × 12 strip be tiled with 1 × 2 dominoes? | 233",
      "How many 5-card poker hands (from a standard 52-card deck) contain exactly one pair and nothing better? | 1098240",
      "How many solutions in positive integers does a + b + c + d = 20 have, if each of a, b, c, d is at most 8? | 315",
      "What is the sum of all prime numbers below 100? | 1060",
      "In how many ways can 7 letters be put into their 7 addressed envelopes so that no letter is in its own envelope? | 1854",
      "What is the expected number of rolls of a fair six-sided die until every face has appeared at least once? | 14.7",
      "How many squares of all sizes are there on an 8 × 8 chessboard? | 204",
      "What is the greatest common divisor of 2^60 − 1 and 2^42 − 1? | 63",
      "How many four-digit numbers have digits that are strictly increasing from left to right? | 126",
      "Two cards are drawn from a standard 52-card deck without replacement. What is the probability that both are aces? Give it as a fraction. | 1/221",
      "In how many ways can 10 identical balls be placed into 4 distinct boxes so that no box is empty? | 84",
      "How many diagonals does a convex 20-sided polygon have? | 170",
      "What is the smallest positive integer with exactly 24 positive divisors? | 360",
      "What is the remainder when 3^200 is divided by 13? | 9",
    ].join("\n"),
  },
  {
    name: "Exact computation (30)",
    grader: "number",
    // generated with a fixed seed, answers computed by program: long multiplication, date spans, letter counts, digit sums of powers, coprime counts
    text: [
      "What is 29090 × 13198? | 383929820",
      "What is 40706 × 36515? | 1486379590",
      "What is 38181 × 55015? | 2100527715",
      "What is 49418 × 38376? | 1896465168",
      "What is 55180 × 70953? | 3915186540",
      "What is 17967 × 11417? | 205129239",
      "How many days are there from June 10, 1997 to August 23, 2010? (Count the days in between: from the first date to the second is the difference.) | 4822",
      "How many days are there from September 24, 1957 to August 6, 2013? (Count the days in between: from the first date to the second is the difference.) | 20405",
      "How many days are there from May 22, 1958 to September 19, 2022? (Count the days in between: from the first date to the second is the difference.) | 23496",
      "How many days are there from March 20, 1984 to September 6, 2008? (Count the days in between: from the first date to the second is the difference.) | 8936",
      "How many days are there from October 23, 1987 to November 7, 2023? (Count the days in between: from the first date to the second is the difference.) | 13164",
      "How many days are there from February 5, 1984 to October 3, 2003? (Count the days in between: from the first date to the second is the difference.) | 7180",
      "How many times does the letter \"e\" appear in: \"abracadabra abracadabra mississippi strawberry mississippi\"? | 1",
      "How many times does the letter \"i\" appear in: \"strawberry bookkeeper indivisibility strawberry indivisibility\"? | 12",
      "How many times does the letter \"i\" appear in: \"bookkeeper bookkeeper abracadabra abracadabra strawberry\"? | 0",
      "How many times does the letter \"p\" appear in: \"bookkeeper indivisibility bookkeeper mississippi bookkeeper\"? | 5",
      "How many times does the letter \"r\" appear in: \"onomatopoeia abracadabra indivisibility mississippi onomatopoeia\"? | 2",
      "How many times does the letter \"a\" appear in: \"onomatopoeia mississippi bookkeeper strawberry strawberry\"? | 4",
      "What is the sum of the decimal digits of 39^12? | 81",
      "What is the sum of the decimal digits of 24^10? | 63",
      "What is the sum of the decimal digits of 37^12? | 73",
      "What is the sum of the decimal digits of 24^14? | 81",
      "What is the sum of the decimal digits of 34^12? | 73",
      "What is the sum of the decimal digits of 27^14? | 90",
      "How many integers from 1 to 512 are coprime to 30? | 137",
      "How many integers from 1 to 1653 are coprime to 42? | 472",
      "How many integers from 1 to 1233 are coprime to 84? | 352",
      "How many integers from 1 to 2579 are coprime to 30? | 688",
      "How many integers from 1 to 2894 are coprime to 12? | 965",
      "How many integers from 1 to 2580 are coprime to 42? | 737",
    ].join("\n"),
  },
];
