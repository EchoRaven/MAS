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
 * - check: JS kept with the dataset decides (a Game of 24 expression, a constraint): for answers with no single form
 * - none: nothing is graded; the outputs are kept, to compare two systems pairwise (open-ended tasks)
 */
export type Grader = "answer" | "contains" | "number" | "math" | "llm" | "code" | "check" | "none";

/**
 * Two evaluations of the same open-ended questions, judged pairwise by a model: for each question, which output is
 * better, asked in both orders so that a judge's preference for the first or the second cancels out. A win needs
 * both orders to agree; anything else is a tie.
 */
export interface PairwiseResult {
  a: string;
  b: string;
  a_name: string;
  b_name: string;
  judge: string;
  criterion: string;
  a_wins: number;
  b_wins: number;
  ties: number;
  /** per question: the pick in each order ("unread": the judge gave no verdict line), the verdict, and the end of each reply */
  per: { input: string; first: "a" | "b" | "tie" | "unread"; second: "a" | "b" | "tie" | "unread"; verdict: "a" | "b" | "tie"; why?: [string, string]; scores?: [number | null, number | null] }[];
  /** pointwise: each output scored alone (1-10) and the higher score wins; first and second are then that verdict */
  mode?: "pairwise" | "pointwise";
  usd: number;
  at: string;
}

/**
 * How often a pairwise judge picked whichever response it was shown first, of the readings where it picked one.
 * Near half is no position bias; near all of them means the order decided, and its verdicts are mostly ties.
 */
export function firstPicks(per: PairwiseResult["per"], mode?: PairwiseResult["mode"]): { first: number; picked: number } {
  if (mode === "pointwise") return { first: 0, picked: 0 }; // no order: each output was read alone
  let first = 0, picked = 0;
  for (const x of per) {
    // reading 1 shows a first, reading 2 shows b first
    if (x.first === "a" || x.first === "b") (picked++, x.first === "a" && first++);
    if (x.second === "a" || x.second === "b") (picked++, x.second === "b" && first++);
  }
  return { first, picked };
}

/** What a pairwise judge is asked when no criterion is given. */
export const DEFAULT_CRITERION = "Which response better does what the task asks: correct, complete, well organised and well written?";

/** A short tag for a criterion other than the default, so judgements by one judge under different criteria are kept apart. */
export function criterionTag(criterion: string): string {
  if (criterion === DEFAULT_CRITERION) return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < criterion.length; i++) h = Math.imul(h ^ criterion.charCodeAt(i), 0x01000193);
  return "c" + (h >>> 0).toString(36);
}

/** What pooling needs of an evaluation: its system, models, run variables and whether it was marked invalid. */
export interface PoolableEval {
  id: string;
  system_name: string;
  on_model?: string;
  model_map?: Record<string, string>;
  vars?: Record<string, unknown>;
  invalid?: { reason: string } | null;
  /** the system's version (systemVersion): judgements of different versions are not pooled */
  system_version?: string;
}

/** A setup: the system with its models and run variables (MoA on flash-lite and MoA on gemini are not the same). */
export function setupLabel(e: PoolableEval): string {
  const models = e.on_model ? `on ${e.on_model}` : e.model_map ? Object.entries(e.model_map).map(([x, y]) => `${x}→${y}`).join(", ") : "";
  const vars = e.vars ? Object.entries(e.vars).map(([x, y]) => `${x}=${typeof y === "string" ? y.trim().slice(0, 24) : JSON.stringify(y)}`).join(", ") : "";
  return [e.system_name, [models, vars].filter(Boolean).join("; ")].filter(Boolean).join(" · ");
}

/**
 * Pairwise judgements pooled by setup: every valid judgement of setup A against setup B by the same judge under the
 * same criterion adds up, runs judged separately included, in one direction per pair (whichever setup sorts
 * first). Invalid evaluations and judgements with a missing verdict are left out. Groups of one are kept: the
 * caller decides what to show.
 */
export function poolJudgements(evals: PoolableEval[], judged: PairwiseResult[]): { a: string; b: string; judge: string; w: number; l: number; t: number; n: number }[] {
  const byId = new Map(evals.map((e) => [e.id, e]));
  // a setup judged under more than one system version (a template fixed in between) is told apart by its version
  const versions = new Map<string, Set<string>>();
  for (const e of evals) if (!e.invalid) versions.set(setupLabel(e), (versions.get(setupLabel(e)) ?? new Set()).add(e.system_version ?? ""));
  const label = (e: PoolableEval) => ((versions.get(setupLabel(e))?.size ?? 0) > 1 ? `${setupLabel(e)} · version ${e.system_version ? e.system_version.slice(0, 5) : "before versions"}` : setupLabel(e));
  const groups = new Map<string, { a: string; b: string; judge: string; w: number; l: number; t: number; n: number }>();
  for (const p of judged) {
    const ea = byId.get(p.a), eb = byId.get(p.b);
    if (!ea || !eb || ea.invalid || eb.invalid) continue;
    if (p.per.some((x) => x.first === "unread" || x.second === "unread")) continue;
    const [sa, sb] = [label(ea), label(eb)];
    const flip = sa > sb;
    const [na, nb] = flip ? [sb, sa] : [sa, sb];
    const own = criterionTag(p.criterion);
    const k = `${na}|${nb}|${p.judge}|${own}`;
    const g = groups.get(k) ?? { a: na, b: nb, judge: own ? `${p.judge}, own criterion` : p.judge, w: 0, l: 0, t: 0, n: 0 };
    g.w += flip ? p.b_wins : p.a_wins;
    g.l += flip ? p.a_wins : p.b_wins;
    g.t += p.ties;
    g.n++;
    groups.set(k, g);
  }
  return [...groups.values()];
}

/** The http(s) links in a text, without trailing punctuation. */
export function linksIn(text: string): Set<string> {
  return new Set((text.match(/https?:\/\/[^\s)\]>"'|,]+/g) ?? []).map((u) => u.replace(/[.;:]+$/, "")));
}

/**
 * Of the links an output cites, those its own run's web searches or fetches returned. A judge model cannot check
 * recent facts or links; this can: a link no search returned was written from memory or made up.
 */
export function sourcedLinks(output: string, tools: { tool: string; args?: unknown; result?: unknown }[]): { cited: number; found: number; searches: number } {
  const searched = new Set<string>();
  let searches = 0;
  for (const t of tools) {
    if (t.tool !== "web_search" && t.tool !== "fetch") continue;
    searches++;
    for (const u of linksIn(String(t.result ?? ""))) searched.add(u);
    if (t.tool === "fetch") for (const u of linksIn(String(t.args ?? ""))) searched.add(u);
  }
  const mine = [...linksIn(output)];
  return { cited: mine.length, found: mine.filter((u) => searched.has(u)).length, searches };
}

/**
 * The shape of an output: its words, headings, list items and tables. A pairwise judge rewards length and
 * structure; shown beside a judgement, these tell a better answer from a longer or more formatted one.
 */
export function outputShape(text: string): { words: number; headings: number; items: number; tables: number } {
  return {
    words: text.split(/\s+/).filter(Boolean).length,
    headings: (text.match(/^#{1,6} /gm) ?? []).length,
    items: (text.match(/^\s*(?:[-*•]|\d+[.)]) /gm) ?? []).length,
    tables: /^\|.*\|\s*$/m.test(text) ? 1 : 0,
  };
}

/** The graders that compare an output with an expected answer by a rule. */
export type RuleGrader = Exclude<Grader, "llm" | "code" | "check" | "none">;

export interface EvalCaseResult {
  /** false when the run's answer is not the kind the system declares (system.result): a bug in the system, whatever the grade */
  result_ok?: boolean;
  /** the run was stopped at a limit before its conversation ended, and its answer is the conversation's last message */
  cut_short?: boolean;
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
  /**
   * On a miss graded by rule, the members (model and agent components) that marked the right answer in a message
   * they sent during the run: the team had it and lost it. Empty when none did: nobody found it.
   */
  reached?: string[];
  /** a second opinion on a miss graded by rule: the LLM judge's verdict (the grade stands; a "right" here is a grader to check) */
  audit?: { pass: boolean; why: string };
  /** the numbers the run reported about itself (metric events), the last value of each name */
  metrics?: Record<string, number>;
}

export interface EvalRecord {
  id: string;
  system_id: string;
  system_name: string;
  /** a hash of what the system does (systemVersion): runs of different versions are not pooled */
  system_version?: string;
  grader: Grader;
  /**
   * for grader "check": JS run on each output, with `output`, `answer` (the final answer), `expected` and
   * `question` in scope; it returns true / false or {pass, why}. Kept on the record so a regrade runs the same check.
   */
  check?: string;
  /** how many times every question was run */
  repeats?: number;
  mock: boolean;
  /** every chat model of the system was served by this one */
  on_model?: string;
  /** each run's wall-clock limit, in minutes, instead of the system's own (slow models need longer) */
  time_limit_min?: number;
  /** each run's spending limit (USD), when it replaced the system's budget */
  usd_limit?: number;
  /** the whole evaluation's spending limit (USD): past it, no further case started */
  max_usd?: number;
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
  /** how many cases a provider failed in passing (a 503, a dropped stream) and that ran once more at the end */
  auto_retried?: number;
  /** what checking the misses with the judge cost */
  audit_usd?: number;
  /** marked invalid by hand (a setup bug found later), with why: kept, but out of comparisons by default */
  invalid?: { reason: string; at: string } | null;
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
export function failureReasons(cases: Pick<EvalCaseResult, "pass" | "status" | "why" | "result_ok" | "reached" | "cut_short">[]): { reason: string; count: number; cases: number[] }[] {
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
    // why a run ended without an answer is the fix: a round limit set too low, a time limit, a provider error
    if (/^no output: .*stopped at the output limit/.test(w)) return "no output: reply cut at the output limit";
    const ended = /^no output \((?:finished|stopped|failed): (.*)\)$/.exec(w);
    if (ended) return `no output: ${ended[1].replace(/\s*\(no output\)/i, "").replace(/\d+(\.\d+)?/g, "#").trim().toLowerCase()}`;
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
    // a conversation stopped at a limit explains a miss before its wording does: the limit is the fix
    const r = c.result_ok === false ? "not the declared result type" : c.cut_short ? "cut short at a limit: the conversation did not end" : c.reached?.length ? "a member had it, the team lost it" : reasonOf(c.why ?? "", c.status);
    by.set(r, [...(by.get(r) ?? []), i]);
  });
  return [...by].map(([reason, idx]) => ({ reason, count: idx.length, cases: idx })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/**
 * Several evaluations of one setup (the same system, models, variables and grader on the same questions) as one:
 * their runs numbered one after another (a second evaluation's repeat 0 becomes repeat 1, and so on), costs and
 * counts added. A second run started later then counts in the paired test with the first.
 */
export function poolRuns(recs: EvalRecord[]): EvalRecord {
  const sorted = [...recs].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const cases: EvalCaseResult[] = [];
  let offset = 0;
  for (const r of sorted) {
    const runs = Math.max(1, ...r.cases.map((c) => (c.repeat ?? 0) + 1));
    for (const c of r.cases) cases.push({ ...c, repeat: (c.repeat ?? 0) + offset });
    offset += runs;
  }
  const last = sorted[sorted.length - 1];
  return {
    ...last,
    id: `pool:${sorted.map((r) => r.id).join(",")}`,
    repeats: offset,
    cases,
    passed: sorted.reduce((n, r) => n + r.passed, 0),
    graded: sorted.reduce((n, r) => n + r.graded, 0),
    usd: sorted.reduce((n, r) => n + r.usd, 0),
  };
}

/**
 * One setup's evaluations on different question sets (AIME and HMMT) as one: their cases one after another, each
 * question numbered past the sets before it, runs kept as they are, costs and counts added. Questions still match by
 * their text, so two pooled setups are compared question by question over all the sets.
 */
export function poolSets(recs: EvalRecord[]): EvalRecord {
  const cases: EvalCaseResult[] = [];
  let offset = 0;
  for (const r of recs) {
    const n = Math.max(0, ...r.cases.map((c, i) => (c.case ?? i) + 1));
    r.cases.forEach((c, i) => cases.push({ ...c, case: (c.case ?? i) + offset }));
    offset += n;
  }
  const last = [...recs].sort((a, b) => a.started_at.localeCompare(b.started_at))[recs.length - 1];
  return {
    ...last,
    id: `sets:${recs.map((r) => r.id).join(",")}`,
    cases,
    passed: recs.reduce((n, r) => n + r.passed, 0),
    graded: recs.reduce((n, r) => n + r.graded, 0),
    usd: recs.reduce((n, r) => n + r.usd, 0),
  };
}

/**
 * What a run of a system costs, from its earlier finished evaluations on the same models (the latest five): the mean
 * and the dearest of their per-run averages, and how many runs they cover. A game's cost per run varies with the model
 * more than anything (Avalon: $0.017 on flash-lite, $0.13 on 3.8-flash), so other models' runs are not counted.
 */
export function costPerRun(
  evals: (Pick<EvalRecord, "status" | "usd" | "mock" | "on_model" | "started_at"> & { invalid?: unknown; total?: number })[],
  onModel: string | undefined,
): { mean: number; max: number; runs: number; evals: number } | null {
  const same = evals
    .filter((e) => e.status === "finished" && !e.mock && !e.invalid && (e.on_model ?? "") === (onModel ?? "") && !!e.total && e.usd > 0)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 5);
  if (!same.length) return null;
  const each = same.map((e) => e.usd / e.total!);
  const runs = same.reduce((n, e) => n + e.total!, 0);
  return { mean: same.reduce((n, e) => n + e.usd, 0) / runs, max: Math.max(...each), runs, evals: same.length };
}

/**
 * The 95% Wilson interval of a proportion: how far an accuracy measured on n cases could be from the system's own
 * by chance. 19 of 30 is 63% (46–78): a 30-question score moves by about 15 points, so one run says little.
 */
export function wilson(passed: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const p = passed / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
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

/** The metrics the cases reported (a custom loop's metric(name, value)): per name, how many cases, mean, min and max. */
export function metricStats(cases: Pick<EvalCaseResult, "metrics">[]): { name: string; n: number; mean: number; min: number; max: number }[] {
  const by = new Map<string, number[]>();
  for (const c of cases) for (const [k, v] of Object.entries(c.metrics ?? {})) if (Number.isFinite(v)) by.set(k, [...(by.get(k) ?? []), v]);
  return [...by].map(([name, xs]) => ({ name, n: xs.length, mean: xs.reduce((s, x) => s + x, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) }));
}

/** Two-sided Fisher's exact p for a passed of n against b passed of m (unpaired: two sets of independent runs). */
export function fisherP(a: number, n: number, b: number, m: number): number {
  const k = a + b;
  const N = n + m;
  const logC = (x: number, r: number) => {
    if (r < 0 || r > x) return -Infinity;
    let s = 0;
    for (let i = 1; i <= r; i++) s += Math.log(x - r + i) - Math.log(i);
    return s;
  };
  const prob = (i: number) => Math.exp(logC(n, i) + logC(m, k - i) - logC(N, k));
  const p0 = prob(a);
  let p = 0;
  for (let i = Math.max(0, k - m); i <= Math.min(n, k); i++) {
    const q = prob(i);
    if (q <= p0 * (1 + 1e-9)) p += q;
  }
  return Math.min(1, p);
}

/**
 * A system against a reference on the same questions, question by question: the ones it fixed (the reference
 * got wrong), the ones it lost, and whether that difference is more than chance (exact McNemar). With repeats, a
 * question counts as right for a system when more than half its runs got it. Questions are matched by their text.
 * With only one or two shared questions, each repeated, `runs` holds each side's passed of graded runs and p is
 * Fisher's exact test on them instead.
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
  const shared = fixed.length + lost.length + both + neither;
  // one or two questions run many times (a game, a simulation): question by question there is nothing to pair, so
  // the runs are compared as two samples, passed of graded on each side, by Fisher's exact test
  const runs = (rec: Pick<EvalRecord, "cases">) => {
    const on = rec.cases.filter((c) => c.pass !== undefined && a.has(c.input) && b.has(c.input));
    const each = new Map<string, number>();
    for (const c of on) each.set(c.input, (each.get(c.input) ?? 0) + 1);
    return { passed: on.filter((c) => c.pass).length, graded: on.length, repeated: each.size > 0 && [...each.values()].every((n) => n > 1) };
  };
  if (shared && shared <= 2) {
    const { repeated: rx, ...x } = runs(sys);
    const { repeated: ry, ...y } = runs(ref);
    if (rx && ry) return { fixed, lost, both, neither, shared, p: fisherP(x.passed, x.graded, y.passed, y.graded), runs: { sys: x, ref: y } };
  }
  return { fixed, lost, both, neither, shared, p: mcnemarP(fixed.length, lost.length) };
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
    const rest = output.slice((m.index ?? 0) + m[0].length).split("\n").map((l) => l.trim());
    if (same) return listFrom(m[1].trim(), rest[0] ? rest : rest.slice(1)) ?? m[1].trim();
    const at = rest.findIndex(Boolean);
    if (at >= 0) return listFrom(rest[at], rest.slice(at + 1)) ?? rest[at];
  }
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  // a last line in parentheses is an aside ("(Calculation: 392 + 560 + … = 6604. …)"): the answer is the line before
  if (lines.length > 1 && /^\(.*\)$/.test(lines[lines.length - 1])) return lines[lines.length - 2];
  return lines[lines.length - 1] ?? "";
}

const LIST_ITEM = /^(?:\d+[.)]|[-*\u2022])\s+/;
/**
 * An answer given as a list, one item a line ("Answer: 1. apple\n2. banana\n3. cherry"): the items joined by
 * spaces, numbers and bullets dropped. Only when the answer's first line is itself a list item and the next line
 * continues the list; otherwise null and the answer is that one line.
 */
function listFrom(first: string, next: string[]): string | null {
  if (!LIST_ITEM.test(first) || !LIST_ITEM.test(next[0] ?? "")) return null;
  const items = [first];
  for (const l of next) {
    if (!LIST_ITEM.test(l)) break;
    items.push(l);
  }
  return items.map((l) => l.replace(LIST_ITEM, "").trim()).join(" ");
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

/**
 * The cases a retry runs again: errors, runs that gave no output, cases a stop or a restart left unrun, and
 * outputs the log once kept only the beginning of (… (N more chars)), whose answer at the end was lost, even
 * where the grader passed them on a number met before the cut.
 */
export function retryableCase(c: Pick<EvalCaseResult, "status" | "pass" | "why" | "output">): boolean {
  if (c.status === "error" || c.status === "pending") return true;
  // a cut output's answer is unknown either way: graded right, it was a number met in the reasoning before the cut
  if (/… \(\d+ more chars\)$/.test(c.output ?? "")) return true;
  return c.pass === false && /^no output|^not run|the server restarted/.test(c.why ?? "");
}

/**
 * Which members reached the expected answer during a run, from the messages they sent: a miss the team had and
 * lost, against one nobody found. A message counts only where it marks an answer ("Final:", "Answer:", \boxed{}),
 * so a number met in passing does not; a message that is a list (a component's replicas) counts item by item.
 */
/**
 * The answers one logged message holds: itself, or each item when it is a list of replies (a replicated model's
 * samples), read as written even when the log cut the list short.
 */
export function messageTexts(text: string): unknown[] {
  if (!/^\s*\["/.test(text)) return [text];
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return v;
  } catch {
    // a list of strings cut short in the log (messages are kept to 6000 characters): split it at its item
    // boundaries and read each item as written, so the items before the cut still count
    return text
      .replace(/^\s*\["/, "")
      .split(/(?<!\\)"\s*,\s*"/)
      .map((t) => t.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return [text];
}

export function reachedBy(
  messages: { from: string; text: string }[],
  nameOf: (id: string) => string | null,
  grader: Grader,
  expected: string,
  question = "",
): string[] {
  if (grader !== "answer" && grader !== "number" && grader !== "math") return [];
  const out = new Set<string>();
  const seen = new Set<string>();
  for (const m of messages) {
    const name = nameOf(m.from);
    if (!name || out.has(name)) continue;
    for (const t of messageTexts(m.text)) {
      if (typeof t !== "string" || seen.has(t)) continue;
      seen.add(t);
      if (hasMarkedAnswer(t) && gradeByRule(grader, t, expected, question).pass) {
        out.add(name);
        break;
      }
    }
  }
  return [...out];
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

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

export function answerNumber(raw: string, question = ""): number | null {
  const answer = plain(raw);
  const boxed = boxedContent(answer);
  if (boxed !== null && parseNumber(boxed) !== null) return parseNumber(boxed);
  // a sum written out ends in its result: "Total: 3 + 0 + 1 + 0 + 1 = 6" (only a number closing the line counts)
  const result = /=\s*\**\s*(-?\$?[\d,]+(?:\.\d+)?)\s*\**\s*\.?\s*$/.exec(answer);
  if (result) return parseNumber(result[1]);
  // a number written as a word, where no digit is given: "one"
  if (!/\d/.test(answer)) {
    const word = [...answer.toLowerCase().matchAll(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/g)].pop();
    if (word) return NUMBER_WORDS.indexOf(word[1]);
  }
  for (const b of answer.matchAll(/\*\*([^*]+)\*\*/g)) {
    const words = b[1].trim().split(/\s+/).length;
    const n = numbersIn(b[1]);
    if (words <= 4 && n.length) return n[0];
  }
  // numbers the question gives are not the answer; only the question's, not a long document after it (a ledger
  // holds nearly every number, and "Order 12529 paid $801" was read as 12529)
  const asked = question.split("\n---\n")[0].slice(0, 2000);
  const given = new Set(numbersIn(plain(asked)));
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
  // thin spaces (\, \! \; \: and "\ "), but not a matrix's row break "\\ "
  s = s.replace(/(?<!\\)\\[!,;: ]/g, "").replace(/\s+/g, "");
  s = s.replace(/\\left|\\right/g, "").replace(/\\[dt]frac/g, "\\frac");
  s = s.replace(/\^\{?\\circ\}?/g, "").replace(/\\circ/g, "").replace(/\\?\$/g, "").replace(/\\%|%/g, "");
  // a unit after the answer ("270\text{ degrees}", "5\mbox{ cm}") is not part of it; a word alone (\text{Evelyn}) is the answer
  s = s.replace(/(.)\\(?:text|mbox|mathrm)\{[a-zA-Z]+\}(?:\^\{?[23]\}?)?$/, "$1");
  // a base written as a subscript ("2516_8", "101_{2}"): the digits are the answer the question asks for
  s = s.replace(/^(\d+)_\{?(\d{1,2})\}?$/, "$1");
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
  // "3<\lambda\le4" is the interval (3,4], as MATH writes it
  const between = /^([^<>=,]+?)(<|\\leq?|\\le)\\?[a-zA-Z]+(<|\\leq?|\\le)([^<>=,]+)$/.exec(s);
  if (between) s = `${between[2] === "<" ? "(" : "["}${between[1]},${between[4]}${between[3] === "<" ? ")" : "]"}`;
  return s;
}

/** The entries of a matrix or vector, in order (\begin{pmatrix}1/5\\-18/5\end{pmatrix}), or null. */
function matrixEntries(form: string): string[] | null {
  const m = /^\\begin\{[pbvB]?matrix\}(.*)\\end\{[pbvB]?matrix\}$/.exec(form);
  return m ? m[1].split(/\\\\|&/).map((x) => mathForm(x)).filter(Boolean) : null;
}

/** Two answers (or entries) are the same: the same form, or the same number (0.2 and 1/5). */
function sameMath(a: string, b: string): boolean {
  if (a === b) return true;
  const [x, y] = [mathValue(a), mathValue(b)];
  return x !== null && y !== null && Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(y));
}

/** The signed terms of a sum at the top level (1+2\sqrt{3} -> +1, +2\sqrt{3}), sorted: a sum in any order. */
function sumTerms(form: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of form) {
    if ("{([".includes(ch)) depth++;
    if ("})]".includes(ch)) depth--;
    if (depth === 0 && (ch === "+" || ch === "-") && cur && !/[\^_]$/.test(cur)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.map((t) => (/^[+-]/.test(t) ? t : `+${t}`)).sort();
}

/** A form with every sum put in one order, inside braces too: \frac{9a+11}{20} and \frac{11+9a}{20} agree. */
function canonSums(form: string): string {
  let s = form;
  // innermost groups first; a sorted group is marked with \u0001 \u0002 so that it is not taken again
  for (let guard = 0; guard < 50 && /\{[^{}]*\}/.test(s); guard++) s = s.replace(/\{([^{}]*)\}/g, (_, inner: string) => `\u0001${sumTerms(inner).join("")}\u0002`);
  return sumTerms(s).join("");
}

/** Lists that hold the same items in any order, each matched once (by form or by value). */
function sameItemsAnyOrder(a: string[], b: string[]): boolean {
  if (a.length < 2 || a.length !== b.length) return false;
  const left = [...b];
  return a.every((x) => {
    const i = left.findIndex((y) => sameMath(x, y));
    return i >= 0 && left.splice(i, 1).length === 1;
  });
}

/** The forms an answer stands for: "a \pm b" is both a+b and a-b; a list is its items, in any order. */
function mathItems(form: string): string[] {
  // a set's braces are not part of its items: \{1\pm\sqrt{5},-2\}
  const inner = /^\\\{(.*)\\\}$/.exec(form)?.[1] ?? form;
  const items = inner.split(",").flatMap((x) => {
    const pm = /^(.*)\\pm(.*)$/.exec(x);
    return pm ? [`${pm[1]}+${pm[2]}`, `${pm[1]}-${pm[2]}`] : [x];
  });
  return items.map((x) => mathForm(x)).filter(Boolean).sort();
}

function mathValue(s: string): number | null {
  // \frac43 and \frac{4}{3} both read as 4/3
  // mathForm writes 0.25 as .25; parseNumber needs the leading zero back
  const t = plain(mathForm(s)).replace(/[{}\s]/g, "").replace(/^(-?)\./, "$10.");
  if (/^-?[\d.,/]+$/.test(t)) return parseNumber(t);
  // an expression with no variable (\frac{7}{3}\sqrt{3}, (3+\sqrt{6})^{-1/3}): its value, so that equal answers
  // written differently agree (HMMT's answers marked 7\sqrt{3}/3 wrong against \frac{7}{3}\sqrt{3})
  return latexValue(mathForm(s));
}

/**
 * The value of a LaTeX expression without variables: numbers, + - * /, \cdot, \times, ^ (braced or one digit),
 * \frac, \sqrt and \sqrt[n], \pi, parentheses and braces, and multiplication by juxtaposition (2\sqrt{3}). Null
 * for anything else (a variable, a comma, an interval) or a value that is not finite. A parser, not eval.
 */
export function latexValue(src: string): number | null {
  const s = src.replace(/\\left|\\right/g, "").replace(/\\[dt]frac/g, "\\frac").replace(/\\(?:cdot|times)/g, "*").replace(/\s+/g, "");
  let i = 0;
  const fail = () => {
    throw new Error("not a value");
  };
  const peek = () => s[i];
  const word = () => {
    const m = /^\\[a-zA-Z]+/.exec(s.slice(i));
    return m ? m[0] : null;
  };
  const group = (): number => {
    // {expr}, or a single digit or a command's own value (\frac12, ^2, \sqrt\pi)
    if (peek() === "{") {
      i++;
      const v = expr();
      if (peek() !== "}") fail();
      i++;
      return v;
    }
    if (/\d/.test(peek() ?? "")) return Number(s[i++]);
    return primary();
  };
  const primary = (): number => {
    const c = peek();
    if (c === undefined) fail();
    if (/[\d.]/.test(c)) {
      const m = /^\d*\.?\d+|^\d+/.exec(s.slice(i))!;
      i += m[0].length;
      return Number(m[0]);
    }
    if (c === "(" || c === "{" || c === "[") {
      const close = c === "(" ? ")" : c === "{" ? "}" : "]";
      i++;
      const v = expr();
      if (peek() !== close) fail();
      i++;
      return v;
    }
    const w = word();
    if (w === "\\pi") {
      i += 3;
      return Math.PI;
    }
    if (w === "\\frac") {
      i += 5;
      const a = group();
      const b = group();
      return a / b;
    }
    if (w === "\\sqrt") {
      i += 5;
      let n = 2;
      if (peek() === "[") {
        i++;
        n = expr();
        if (peek() !== "]") fail();
        i++;
      }
      const x = group();
      // an odd root of a negative number is real
      return x < 0 && n % 2 === 1 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n);
    }
    return fail();
  };
  const power = (): number => {
    const base = primary();
    if (peek() !== "^") return base;
    i++;
    const e = peek() === "-" ? (i++, -group()) : group();
    return Math.pow(base, e);
  };
  const unary = (): number => {
    if (peek() === "-") {
      i++;
      return -unary();
    }
    if (peek() === "+") {
      i++;
      return unary();
    }
    return power();
  };
  const term = (): number => {
    let v = unary();
    for (;;) {
      const c = peek();
      if (c === "*" || c === "/") {
        i++;
        const r = unary();
        v = c === "*" ? v * r : v / r;
      } else if (c !== undefined && (/[\d.({]/.test(c) || (c === "\\" && ["\\frac", "\\sqrt", "\\pi"].includes(word() ?? "")))) v *= power();
      else return v;
    }
  };
  function expr(): number {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const c = s[i++];
      const r = term();
      v = c === "+" ? v + r : v - r;
    }
    return v;
  }
  try {
    if (!s) return null;
    const v = expr();
    return i === s.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
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

/**
 * An answer trail a system logs: "answers by round: 12 → 12 → 15" (intrinsic self-correction, CRITIC). The label is
 * what the steps are ("round", "correction"); the answers are in order, the first before any revision.
 */
export function answerTrail(logs: string[]): { label: string; answers: string[] } | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const m = /^answers by ([^:]{1,40}): (.*)$/s.exec(logs[i].trim());
    if (m) return { label: m[1].trim(), answers: m[2].split(" → ").map((a) => a.trim()) };
  }
  return null;
}

/** How an evaluation's answers moved along their trails, each step graded by the evaluation's rule grader. */
export interface TrailStats {
  label: string;
  cases: number;
  /** right at the first step, and at the last */
  first: number;
  last: number;
  right_to_wrong: number;
  wrong_to_right: number;
  /** the same answer at every step */
  unchanged: number;
  /** mean steps after the first */
  mean_steps: number;
  /** right by step (0 = the first answer), over the cases that reached it */
  by_step: { step: number; right: number; cases: number }[];
}

export function trailStats(
  cases: { answers: string[]; expected: string; input: string }[],
  /** a rule grader, or a verdict per answer already worked out (a check grader runs async, before) */
  grader: RuleGrader | ((answer: string, expected: string, input: string) => boolean),
  label = "step",
): TrailStats {
  const s: TrailStats = { label, cases: 0, first: 0, last: 0, right_to_wrong: 0, wrong_to_right: 0, unchanged: 0, mean_steps: 0, by_step: [] };
  let steps = 0;
  for (const c of cases) {
    if (!c.answers.length) continue;
    const ok = c.answers.map((a) => (typeof grader === "function" ? grader(a, c.expected, c.input) : gradeByRule(grader, `Answer: ${a}`, c.expected, c.input).pass));
    s.cases++;
    steps += c.answers.length - 1;
    const [f, l] = [ok[0], ok[ok.length - 1]];
    s.first += +f;
    s.last += +l;
    if (f && !l) s.right_to_wrong++;
    if (!f && l) s.wrong_to_right++;
    if (new Set(c.answers).size === 1) s.unchanged++;
    ok.forEach((v, i) => {
      s.by_step[i] ??= { step: i, right: 0, cases: 0 };
      s.by_step[i].right += +v;
      s.by_step[i].cases++;
    });
  }
  s.mean_steps = s.cases ? steps / s.cases : 0;
  return s;
}

/** Grades an output by a rule (every grader but llm). */
export function gradeByRule(grader: RuleGrader, output: string, expected: string, question = ""): { pass: boolean; answer: string; why: string } {
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
    const sameItems = (ia.length > 1 && ia.length === ie.length && ia.every((x, i) => x === ie[i])) || sameItemsAnyOrder(ia, ie);
    // a matrix or vector matches entry by entry, in order
    const [ma, me] = [matrixEntries(a), matrixEntries(e)];
    const sameMatrix = !!ma && !!me && ma.length === me.length && ma.every((x, i) => sameMath(x, me[i]));
    // a sum in another order: 2\sqrt{3}+1 is 1+2\sqrt{3}
    const [ta, te] = [sumTerms(a), sumTerms(e)];
    const sameSum = (!a.includes(",") && ta.length > 1 && ta.length === te.length && ta.every((x, i) => x === te[i])) || (a !== e && canonSums(a) === canonSums(e));
    // a lettered choice, with or without its parentheses: E, (E), \text{(E)}
    const choice = (x: string) => /^\(?([A-Ea-e])\)?$/.exec(x)?.[1]?.toUpperCase() ?? null;
    const sameChoice = choice(a) !== null && choice(a) === choice(e);
    const pass = a === e || sameItems || sameMatrix || sameSum || sameChoice || (na !== null && ne !== null && Math.abs(na - ne) <= 1e-6 * Math.max(1, Math.abs(ne)));
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
