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
export type Grader = "answer" | "contains" | "number" | "math" | "llm" | "code";

export interface EvalCaseResult {
  /** false when the run's answer is not the kind the system declares (system.result): a bug in the system, whatever the grade */
  result_ok?: boolean;
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
  /** each run's wall-clock limit, in minutes, instead of the system's own (slow models need longer) */
  time_limit_min?: number;
  /** run variables every case started with */
  vars?: Record<string, unknown>;
  /** the dataset the cases came from, its version, and the sample drawn from it */
  dataset?: { id: string; name: string; version: string; n?: number; seed?: number };
  /** chosen models of the system served by others */
  model_map?: Record<string, string>;
  /** what every answer had to be (type, an "Answer:" line), checked per run */
  expect?: import("@/model/types").ResultSpec;
  /** queued: waiting for the evaluations started before it in the same batch */
  status: "queued" | "running" | "finished" | "stopped";
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

/**
 * Why cases failed, grouped: the specifics (numbers, names, messages) are
 * dropped so that one systematic problem shows as one large group ("17 ×
 * tests fail: AssertionError", "5 × no output") instead of scattered rows.
 * Groups are sorted by size; each lists the indices of its cases.
 */
export function failureReasons(cases: Pick<EvalCaseResult, "pass" | "status" | "why" | "result_ok">[]): { reason: string; count: number; cases: number[] }[] {
  const reasonOf = (why: string, status: string) => {
    const w = why.trim();
    if (/ ≠ /.test(w)) return "wrong answer";
    const q = /^"([\s\S]*)" is not "([\s\S]*)"$/.exec(w);
    if (q) {
      // a sentence where a letter or a number was expected: the system gave no answer line, so the grader read
      // its reasoning (MedAgents ended with "why" after the option: 0 of 57)
      const [got, want] = [q[1].trim(), q[2].trim()];
      if (want.length <= 12 && !/\s/.test(want) && got.length > 40 && /\s/.test(got)) return "a sentence, not an answer: no final answer line";
      return "wrong answer";
    }
    let m = /^tests fail: ([A-Za-z_][\w.]*(?:Error|Exception|Exit|Interrupt))/.exec(w);
    if (m) return `tests fail: ${m[1]}`;
    if (/^tests fail/.test(w)) return "tests fail";
    if (/^timed out/.test(w)) return "timed out";
    if (/^no output/.test(w)) return "no output";
    if (/^no number in the answer/.test(w)) return "no number in the answer";
    if (/^judge: FAIL/.test(w)) return "the judge said FAIL";
    if (status === "error" && !w) return "error";
    return w.replace(/\d+(\.\d+)?/g, "#").replace(/\s+/g, " ").slice(0, 70) || "failed";
  };
  const by = new Map<string, number[]>();
  cases.forEach((c, i) => {
    if (c.pass !== false && c.status !== "error") return;
    // the wrong kind of answer explains a failure before its details do
    const r = c.result_ok === false ? "not the declared result type" : reasonOf(c.why ?? "", c.status);
    by.set(r, [...(by.get(r) ?? []), i]);
  });
  return [...by].map(([reason, idx]) => ({ reason, count: idx.length, cases: idx })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/**
 * Seconds left in a running evaluation: the mean time of the cases done, times the cases left, over the cases
 * running at once. Null until a case has finished.
 */
export function etaSeconds(rec: Pick<EvalRecord, "cases">): number | null {
  const done = rec.cases.filter((c) => (c.status === "done" || c.status === "error") && typeof c.seconds === "number");
  if (!done.length) return null;
  const mean = done.reduce((n, c) => n + (c.seconds ?? 0), 0) / done.length;
  const left = rec.cases.filter((c) => c.status === "pending" || c.status === "running").length;
  const width = Math.max(1, rec.cases.filter((c) => c.status === "running").length);
  return Math.round((mean * left) / width);
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

/** Two-sided exact McNemar p-value: of d discordant questions, `small` went one way (binomial, p = 1/2). */
export function mcnemarP(fixed: number, lost: number): number {
  const d = fixed + lost;
  if (!d) return 1;
  const k = Math.min(fixed, lost);
  // P(X <= k) for X ~ Bin(d, 1/2), in logs so a few hundred questions do not overflow
  const logC = (n: number, r: number) => {
    let x = 0;
    for (let i = 1; i <= r; i++) x += Math.log(n - r + i) - Math.log(i);
    return x;
  };
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logC(d, i) - d * Math.LN2);
  return Math.min(1, 2 * tail);
}

/**
 * A system against a reference on the same questions, question by question: the ones it fixed (the reference
 * got wrong), the ones it lost, and whether that difference is more than chance (exact McNemar). With repeats, a
 * question counts as right for a system when more than half its runs got it. Questions are matched by their text.
 */
export function pairedDiff(sys: Pick<EvalRecord, "cases">, ref: Pick<EvalRecord, "cases">) {
  const right = (rec: Pick<EvalRecord, "cases">) => {
    const by = new Map<string, { passed: number; graded: number; case: number }>();
    rec.cases.forEach((c, i) => {
      if (c.pass === undefined) return;
      const e = by.get(c.input) ?? { passed: 0, graded: 0, case: c.case ?? i };
      e.graded++;
      if (c.pass) e.passed++;
      by.set(c.input, e);
    });
    return new Map([...by].map(([k, e]) => [k, { ok: e.passed * 2 > e.graded, case: e.case }]));
  };
  const a = right(sys);
  const b = right(ref);
  const fixed: number[] = [];
  const lost: number[] = [];
  let both = 0;
  let neither = 0;
  for (const [q, x] of a) {
    const y = b.get(q);
    if (!y) continue;
    if (x.ok && !y.ok) fixed.push(x.case);
    else if (!x.ok && y.ok) lost.push(x.case);
    else if (x.ok) both++;
    else neither++;
  }
  fixed.sort((m, n) => m - n);
  lost.sort((m, n) => m - n);
  return { fixed, lost, both, neither, shared: fixed.length + lost.length + both + neither, p: mcnemarP(fixed.length, lost.length) };
}

const ANSWER_LINE = /(?:^|\n)\s*(?:\*\*)?(?:final answer|answer|final)(?:\*\*)?\s*[:：]\s*(?:\*\*)?([^\n]+)/gi;

/**
 * The final answer in an output: the last "Answer:" / "Final:" line (or the
 * line after it, when the marker stands alone as in "**Final Answer:**"),
 * else the last non-empty line. Bold markers are kept: they say which part
 * is the answer.
 */
export function finalAnswer(raw: string): string {
  // a group chat's stop word after the answer ("… = 155\n\nTERMINATE", AutoGen) is not the answer
  const output = raw.replace(/(?:\s*\bTERMINATE\b[.!]?\s*)+$/, "").trim() || raw;
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
export function numbersIn(raw: string): number[] {
  const s = raw.replace(/([-\u2212])\s*[$€£¥]\s*/g, "$1").replace(/[$€£¥]\s*-/g, "-");
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
/** LaTeX in an answer, as plain text: \frac{1}{221} → 1/221, 1{,}098{,}240 → 1098240, \text{B} → B, a Unicode minus → "-". */
export function plain(s: string): string {
  return s
    .replace(/\u2212/g, "-")
    .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\{,\}/g, "")
    .replace(/\\(?:text|textbf|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1")
    .replace(/\\[,;!: ]/g, "");
}

/** Whether an output marks its answer: a line "Answer: …" / "Final answer: …" / "Final: …", or \boxed{…}. */
export function hasMarkedAnswer(output: string): boolean {
  return [...output.matchAll(ANSWER_LINE)].length > 0 || boxedContent(output) !== null;
}

/** What the last \boxed{…} holds, braces balanced. */
export function boxedContent(s: string): string | null {
  const at = s.lastIndexOf("\\boxed{");
  if (at < 0) return null;
  // "\\boxed" is 6 characters: the brace that opens the box is at + 6
  let depth = 0;
  for (let i = at + 6; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return s.slice(at + 7, i);
  }
  return null;
}

export function answerNumber(raw: string, question = ""): number | null {
  const answer = plain(raw);
  const boxed = boxedContent(answer);
  if (boxed !== null && parseNumber(boxed) !== null) return parseNumber(boxed);
  for (const b of answer.matchAll(/\*\*([^*]+)\*\*/g)) {
    const words = b[1].trim().split(/\s+/).length;
    const n = numbersIn(b[1]);
    if (words <= 4 && n.length) return n[0];
  }
  const given = new Set(numbersIn(plain(question)));
  const all = numbersIn(answer);
  return all.find((v) => !given.has(v)) ?? all[0] ?? null;
}

/**
 * A math answer in a canonical form, after the MATH benchmark's own
 * normalisation (Hendrycks et al., is_equiv / strip_string): spacing,
 * \left \right, \dfrac, degrees, dollars, \text{}, a leading "x =", and
 * fractions written \frac12. Two answers are equal when these forms are, or
 * when both are numbers that are equal.
 */
export function mathForm(raw: string): string {
  let s = raw.trim();
  s = s.replace(/\\!|\\,|\\;|\\:|\\ /g, "").replace(/\s+/g, "");
  s = s.replace(/\\left|\\right/g, "").replace(/\\[dt]frac/g, "\\frac");
  s = s.replace(/\^\{?\\circ\}?/g, "").replace(/\\circ/g, "").replace(/\\?\$/g, "").replace(/\\%|%/g, "");
  // a unit after the answer ("270\text{ degrees}", "5\mbox{ cm}") is not part of it; a word alone (\text{Evelyn}) is the answer
  s = s.replace(/(.)\\(?:text|mbox|mathrm)\{[a-zA-Z]+\}$/, "$1");
  s = s.replace(/\\(?:text|textbf|mathrm|mbox)\{([^{}]*)\}/g, "$1");
  // \frac12 -> \frac{1}{2}, \frac1{2} -> \frac{1}{2}, \sqrt2 -> \sqrt{2}
  s = s.replace(/\\frac(\d)(\d)/g, "\\frac{$1}{$2}").replace(/\\frac(\d)\{/g, "\\frac{$1}{").replace(/\\frac\{([^{}]*)\}(\d)/g, "\\frac{$1}{$2}").replace(/\\sqrt(\w)/g, "\\sqrt{$1}");
  // "x=5" or "k = 3": the value (only for a single short variable, not an equation)
  const assign = /^[a-zA-Z]\w?=(.+)$/.exec(s);
  if (assign && !assign[1].includes("=")) s = assign[1];
  s = s.replace(/\.$/, "").replace(/^0\./, ".").replace(/(\d)\.0+(?!\d)/g, "$1");
  // a/b written with a slash is \frac{a}{b}, when both sides are single terms: 4/3, 3\sqrt{3}/4, \pi/2
  const slash = /^(-?)([^/+\-,()]+)\/([^/+\-,()]+)$/.exec(s);
  if (slash) s = `${slash[1]}\\frac{${slash[2]}}{${slash[3]}}`;
  if (s === ".5") s = "\\frac{1}{2}";
  return s;
}

/** The forms an answer stands for: "a \pm b" is both a+b and a-b; a list is its items, in any order. */
function mathItems(form: string): string[] {
  const pm = /^(.*)\\pm(.*)$/.exec(form);
  const items = pm ? [`${pm[1]}+${pm[2]}`, `${pm[1]}-${pm[2]}`] : form.split(",");
  return items.map((x) => mathForm(x)).filter(Boolean).sort();
}

function mathValue(s: string): number | null {
  // \frac43 and \frac{4}{3} both read as 4/3
  const t = plain(mathForm(s)).replace(/[{}\s]/g, "");
  if (!/^-?[\d.,/]+$/.test(t)) return null;
  return parseNumber(t);
}

export const normalize = (s: string) =>
  plain(s)
    .toLowerCase()
    .replace(/\$|\\boxed\{|\}/g, "")
    .replace(/[^\p{L}\p{N}./%-]+/gu, " ")
    .replace(/[.]+(\s|$)/g, "$1")
    .trim();

/** A number in a text: 12, -3.5, 1,234, 1/3, 40%. */
export function parseNumber(s: string): number | null {
  // a currency sign between the sign and the digits ("-$70,145,984", "$-5") still leaves a negative number
  const t = s.replace(/([-\u2212])\s*[$€£¥]\s*/g, "$1").replace(/[$€£¥]\s*-/g, "-").replace(/,(?=\d{3})/g, "");
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
export function gradeByRule(grader: Exclude<Grader, "llm" | "code">, output: string, expected: string, question = ""): { pass: boolean; answer: string; why: string } {
  const answer = finalAnswer(output);
  if (grader === "contains") {
    const pass = normalize(output).includes(normalize(expected));
    return { pass, answer, why: pass ? "the output contains the expected answer" : "the expected answer is not in the output" };
  }
  if (grader === "math") {
    // the last \boxed{} is the answer, as MATH asks; else the final answer line
    const got = boxedContent(output) ?? boxedContent(answer) ?? answer.replace(/^(final answer|answer|final)\s*[:：]\s*/i, "");
    const want = boxedContent(expected) ?? expected;
    const [a, e] = [mathForm(got), mathForm(want)];
    const [na, ne] = [mathValue(got), mathValue(want)];
    const [ia, ie] = [mathItems(a), mathItems(e)];
    // a list (or a ±) matches the same items in any order, or the same numbers
    const sameItems = ia.length > 1 && ia.length === ie.length && ia.every((x, i) => x === ie[i]);
    const pass = a === e || sameItems || (na !== null && ne !== null && Math.abs(na - ne) <= 1e-6 * Math.max(1, Math.abs(ne)));
    return { pass, answer: got.trim(), why: pass ? `${got.trim()} = ${want}` : `${got.trim().slice(0, 80)} ≠ ${want}` };
  }
  if (grader === "number") {
    const got = answerNumber(answer, question) ?? parseNumber(output);
    const want = parseNumber(expected);
    if (want === null) return { pass: false, answer, why: `the expected answer "${expected}" is not a number` };
    if (got === null) return { pass: false, answer, why: "no number in the answer" };
    const close = (x: number) => Math.abs(x - want) <= 1e-6 * Math.max(1, Math.abs(want));
    // "33%" answers "what percent…?" whose expected answer is written 33 (GSM8K), as well as 0.33
    const asPercent = !expected.includes("%") && /\d\s*%/.test(answer) && close(got * 100);
    const pass = close(got) || asPercent;
    return { pass, answer, why: pass ? (asPercent ? `${answer.match(/-?[\d.,]+\s*%/)?.[0] ?? got * 100 + "%"} = ${want}` : `${got} = ${want}`) : `${got} ≠ ${want}` };
  }
  const a = normalize(answer.replace(/\*+/g, ""));
  const e = normalize(expected);
  // an option letter alone ("B") matches an answer that starts with it ("B. Hyperkalaemia", "(B)")
  const letter = /^[a-z]$/.test(e) && new RegExp(`^\\(?${e}\\)?(\\s|$)`).test(a);
  const pass = a === e || letter;
  return { pass, answer, why: pass ? "the final answer matches" : `"${answer}" is not "${expected}"` };
}

/**
 * One case from a benchmark record, in the shapes the common sets come in:
 * - plain: {input | question | prompt, expected | answer | target}
 * - GSM8K: {question, answer: "…worked solution… #### 18"}, where the answer is what follows ####
 * - MMLU-style multiple choice: {question, choices: [...], answer: 2 | "C"}, asked with lettered options, graded by letter
 */
export function caseFromRecord(o: Record<string, unknown>): EvalCase | null {
  // HumanEval-style code problems: {prompt, test, entry_point}; graded by running the tests on the answer (grader "code")
  if (typeof o.prompt === "string" && typeof o.test === "string" && typeof o.entry_point === "string") {
    return {
      input: `${o.prompt}\n\nComplete this Python function. Reply with the whole function in one \`\`\`python code block.`,
      expected: JSON.stringify({ kind: "code", prompt: o.prompt, test: o.test, entry_point: o.entry_point }),
    };
  }
  const question = o.input ?? o.question ?? o.prompt ?? o.problem;
  let answer = o.expected ?? o.answer ?? o.target ?? o.label;
  if (question == null || answer == null) return null;
  const choices = Array.isArray(o.choices) ? o.choices : Array.isArray(o.options) ? o.options : null;
  if (choices && choices.length >= 2 && choices.length <= 10) {
    const letters = "ABCDEFGHIJ";
    const idx = typeof answer === "number" ? answer : /^\d+$/.test(String(answer)) ? Number(answer) : letters.indexOf(String(answer).trim().toUpperCase());
    if (idx < 0 || idx >= choices.length) return null;
    const lines = choices.map((ch, i) => `${letters[i]}) ${String(ch)}`);
    return { input: `${String(question)}\n\n${lines.join("\n")}\n\nAnswer with the letter of the correct option.`, expected: letters[idx] };
  }
  const text = String(answer);
  const gsm = /####\s*(.+?)\s*$/s.exec(text);
  if (gsm) answer = gsm[1].replace(/,/g, "");
  return { input: String(question), expected: String(answer) };
}

const INPUT_COLS = ["input", "question", "prompt", "problem"];
const EXPECTED_COLS = ["expected", "answer", "target", "solution", "label"];

/** CSV rows (RFC 4180: quoted fields, "" for a quote, newlines inside quotes). */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      (row = []), (field = "");
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

/** A CSV whose header names an input column and an answer column (question/answer, input/expected, …), or null. */
function parseCsvCases(text: string): { cases: EvalCase[]; skipped: number } | null {
  const first = text.split(/\r?\n/, 1)[0].toLowerCase();
  if (!first.includes(",")) return null;
  const rows = csvRows(text);
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const qi = head.findIndex((h) => INPUT_COLS.includes(h));
  const ai = head.findIndex((h) => EXPECTED_COLS.includes(h));
  if (qi < 0 || ai < 0) return null;
  const cases: EvalCase[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const input = (r[qi] ?? "").trim();
    const expected = (r[ai] ?? "").trim();
    if (input && expected) cases.push({ input, expected });
    else skipped++;
  }
  return { cases, skipped };
}

/**
 * Cases from text: a CSV with a header (question,answer / input,expected / …),
 * JSON lines ({input, expected}, or question/answer), or one case per line as
 * "question | expected" (a tab works as well).
 */
export function parseCases(text: string): { cases: EvalCase[]; skipped: number } {
  const csv = parseCsvCases(text);
  if (csv) return csv;
  const cases: EvalCase[] = [];
  let skipped = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("{")) {
      try {
        const c = caseFromRecord(JSON.parse(line) as Record<string, unknown>);
        if (c) {
          cases.push(c);
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
  {
    name: "Hard computation (30)",
    grader: "number",
    // harder than "Exact computation": six-digit products, digit sums of larger powers, date spans across centuries,
    // letter counts in long strings, modular inverses, binomials mod p; answers computed by program
    text: [
      "What is 788012 × 971041? | 765191960492",
      "What is 313654 × 459538? | 144135931852",
      "What is 178056 × 147679? | 26295132024",
      "What is 889129 × 118969? | 105778788001",
      "What is 336035 × 499821? | 167957349735",
      "What is the sum of the decimal digits of 61^24? | 181",
      "What is the sum of the decimal digits of 86^23? | 155",
      "What is the sum of the decimal digits of 85^19? | 157",
      "What is the sum of the decimal digits of 54^27? | 216",
      "What is the sum of the decimal digits of 96^17? | 189",
      "How many days are there from September 2, 1829 to January 7, 2013? (The difference between the two dates.) | 66967",
      "How many days are there from June 24, 1835 to October 17, 1996? (The difference between the two dates.) | 58920",
      "How many days are there from July 5, 1826 to October 8, 2003? (The difference between the two dates.) | 64743",
      "How many days are there from August 14, 1813 to January 28, 2003? (The difference between the two dates.) | 69198",
      "How many days are there from March 27, 1859 to May 20, 2025? (The difference between the two dates.) | 60685",
      "How many times does the letter \"e\" appear in: \"bookkeeper assassination onomatopoeia assassination onomatopoeia assassination abracadabra mississippi parallelogram\"? | 6",
      "How many times does the letter \"i\" appear in: \"abracadabra mississippi mississippi indivisibility abracadabra indivisibility onomatopoeia abracadabra abracadabra\"? | 21",
      "How many times does the letter \"e\" appear in: \"onomatopoeia abracadabra mississippi abracadabra abracadabra mississippi assassination abracadabra assassination\"? | 1",
      "How many times does the letter \"i\" appear in: \"abracadabra bookkeeper assassination indivisibility mississippi assassination onomatopoeia onomatopoeia abracadabra\"? | 16",
      "How many times does the letter \"p\" appear in: \"indivisibility bookkeeper parallelogram abracadabra indivisibility bookkeeper onomatopoeia onomatopoeia onomatopoeia\"? | 6",
      "What is the multiplicative inverse of 286 modulo 1009? (The number x between 1 and 1008 with 286·x ≡ 1 mod 1009.) | 441",
      "What is the multiplicative inverse of 763 modulo 7919? (The number x between 1 and 7918 with 763·x ≡ 1 mod 7919.) | 685",
      "What is the multiplicative inverse of 1777 modulo 2003? (The number x between 1 and 2002 with 1777·x ≡ 1 mod 2003.) | 452",
      "What is the multiplicative inverse of 355 modulo 1009? (The number x between 1 and 1008 with 355·x ≡ 1 mod 1009.) | 955",
      "What is the multiplicative inverse of 109 modulo 1009? (The number x between 1 and 1008 with 109·x ≡ 1 mod 1009.) | 324",
      "What is C(45, 12) mod 10007, where C is the binomial coefficient? | 3815",
      "What is C(47, 14) mod 997, where C is the binomial coefficient? | 165",
      "What is C(53, 19) mod 10007, where C is the binomial coefficient? | 8079",
      "What is C(36, 9) mod 997, where C is the binomial coefficient? | 558",
      "What is C(35, 8) mod 10007, where C is the binomial coefficient? | 9363",
    ].join("\n"),
  },
];
