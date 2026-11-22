// Runs a system over a set of cases and grades each output: the evaluation a
// paper reports. Cases run a few at a time as ordinary runs, so each one can
// be replayed like any other.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MODELS } from "@/model/defaults";
import { modelUses, remapModels, runAllOn } from "@/model/modelUse";
import type { ResultSpec, SystemDoc } from "@/model/types";
import { type EvalCase, type EvalRecord, type Grader, type PairwiseResult, type RuleGrader, DEFAULT_CRITERION, criterionTag, finalAnswer, outputShape, sourcedLinks, gradeByRule, reachedBy, retryableCase } from "@/run/evals";
import type { RunEvent } from "@/run/events";
import type { Store } from "../store/files";
import type { Secrets } from "../store/secrets";
import { gradeCheck } from "./grading/check";
import { gradeCode } from "./grading/code";
import { Models, textOf, userText } from "./models";
import type { RunManager } from "./runs";

export interface EvalOptions {
  cases: EvalCase[];
  /** the dataset the cases came from, kept on the record */
  dataset?: EvalRecord["dataset"];
  grader: Grader;
  /** for grader "check": the JS that decides (from the dataset unless given) */
  check?: string;
  mock?: boolean;
  /** runs at once */
  concurrency?: number;
  /** the model that judges, for the llm grader */
  judge?: string;
  /** run variables every case starts with (ctx.vars) */
  vars?: Record<string, unknown>;
  /** run every question this many times (1-5), to see how much the score moves */
  repeats?: number;
  /** serve every chat model of the system with this one (a catalog or default model id) */
  on_model?: string;
  /** each run's wall-clock limit in minutes, instead of the system's (a slower model needs longer: 1–120) */
  time_limit_min?: number;
  /** each run's spending limit in USD, instead of the system's own budget: a run that passes it stops */
  usd_limit?: number;
  /** serve chosen models with others, after on_model: { sonnet: "gemini", gpt: "gemini_lite" } */
  model_map?: Record<string, string>;
  /** what every answer must be, checked on each run as the system's own result would be (marked: an "Answer:" line) */
  expect?: ResultSpec;
}

const MAX_CASES = 200;
/** errors no retry fixes: a rejected or disabled key, no credit, a used-up quota, a model that is gone */
const ACCOUNT_ERROR = /\b(401|403)\b|api[ _]key|service account|credit|billing|quota|permission denied|no longer available|model .*not found|does not exist/i;

/** A provider's passing failure (overloaded, a 5xx, a dropped stream, a rate limit), not the system's answer. */
const TRANSIENT = /^no output: .*(\b(429|5\d\d)\b|overloaded|unavailable|terminated|ECONNRESET|socket hang up|fetch failed|timed? ?out|rate limit)/i;

/** Forget a case's result so that it runs again. */
function resetCase(c: EvalRecord["cases"][number]) {
  for (const k of ["run_id", "output", "pass", "why", "usd", "seconds", "result_ok", "answer", "reached", "audit"] as const) delete (c as unknown as Record<string, unknown>)[k];
  c.status = "pending";
}

export class EvalManager {
  private stopped = new Set<string>();
  private active = new Set<string>();
  /** pairwise judgements in progress, by "a|b|judge": how far they are, or why they failed (kept ten minutes) */
  private judging = new Map<string, { a: string; b: string; judge: string; done: number; total: number; started: string; error?: string }>();
  /** queued evaluations run one at a time, in the order they were queued */
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private store: Store,
    private runs: RunManager,
    private secrets: Secrets,
    /** the Docker binary, for grading code by running it */
    private docker = "docker",
  ) {}

  /** With `queued`, it waits for the queued evaluations before it (a batch of systems on the same questions runs one by one). */
  /**
   * The system as the evaluation runs it (on_model, model_map, time limit applied); throws what would make it
   * fail every case: a time limit out of range, a model with no key. A batch checks all its systems first.
   */
  prepare(original: SystemDoc, opts: EvalOptions): SystemDoc {
    let doc = opts.on_model ? runAllOn(original, opts.on_model, DEFAULT_MODELS) : original;
    const minutes = Number(opts.time_limit_min);
    if (opts.time_limit_min != null && !(minutes >= 1 && minutes <= 120)) throw new Error("time_limit_min must be from 1 to 120 minutes");
    if (opts.time_limit_min != null) doc = { ...doc, budget: { ...doc.budget, wallclock_min: minutes } };
    const usd = Number(opts.usd_limit);
    if (opts.usd_limit != null && !(usd > 0 && usd <= 50)) throw new Error("usd_limit must be more than 0 and at most 50 USD");
    if (opts.usd_limit != null) doc = { ...doc, budget: { ...doc.budget, usd } };
    if (opts.model_map && Object.keys(opts.model_map).length) doc = remapModels(doc, opts.model_map, DEFAULT_MODELS);
    // the evaluation's expectation adds to what the system declares (its own type stays when it has one)
    if (opts.expect) doc = { ...doc, result: doc.result ? { ...doc.result, ...(opts.expect.marked ? { marked: true } : {}) } : opts.expect };
    // a model with no key would fail every case the same way, after the whole evaluation ran: refuse it now
    if (!opts.mock) {
      const missing = this.keyless(doc);
      if (missing.length) throw new Error(`${doc.name}: ${missing.join("; ")}. Add the key under Settings → Secrets, or run on another model (on_model / "Run on")`);
    }
    return doc;
  }

  start(original: SystemDoc, opts: EvalOptions, queued = false): EvalRecord {
    const doc = this.prepare(original, opts);
    const repeats = Number.isFinite(Number(opts.repeats ?? 1)) ? Math.max(1, Math.min(Math.floor(Number(opts.repeats ?? 1)), 5)) : 1;
    const cases = opts.cases.filter((c) => String(c.input ?? "").trim()).slice(0, Math.floor(MAX_CASES / repeats));
    if (!cases.length) throw new Error("No cases: each needs an input");
    if (opts.grader === "check" && !opts.check?.trim()) throw new Error("The grader check needs its JS: a dataset that carries one, or check in the request");
    const rec: EvalRecord = {
      id: `eval_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`,
      system_id: doc.id,
      system_name: doc.name,
      grader: opts.grader,
      ...(opts.grader === "check" && opts.check ? { check: opts.check } : {}),
      mock: !!opts.mock,
      repeats,
      ...(opts.dataset ? { dataset: opts.dataset } : {}),
      ...(opts.vars && Object.keys(opts.vars).length ? { vars: opts.vars } : {}),
      ...(opts.on_model ? { on_model: opts.on_model } : {}),
      ...(opts.time_limit_min != null ? { time_limit_min: Number(opts.time_limit_min) } : {}),
      ...(opts.usd_limit != null ? { usd_limit: Number(opts.usd_limit) } : {}),
      ...(opts.model_map && Object.keys(opts.model_map).length ? { model_map: opts.model_map } : {}),
      ...(opts.expect ? { expect: opts.expect } : {}),
      status: queued ? "queued" : "running",
      started_at: new Date().toISOString(),
      // repeat 1 of every question first, then repeat 2…: a stopped evaluation still has whole repeats
      cases: Array.from({ length: repeats }, (_, r) => cases.map((c, i) => ({ case: i, repeat: r, input: String(c.input), expected: String(c.expected ?? ""), status: "pending" as const }))).flat(),
      passed: 0,
      graded: 0,
      usd: 0,
    };
    this.store.putEval(rec);
    this.active.add(rec.id);
    if (!queued) {
      void this.execute(rec, doc, opts).finally(() => this.active.delete(rec.id));
      return rec;
    }
    this.queue = this.queue
      .then(async () => {
        if (this.stopped.has(rec.id)) return; // stopped while it waited: stop() already recorded it
        rec.status = "running";
        rec.started_at = new Date().toISOString();
        this.store.putEval(rec);
        await this.execute(rec, doc, opts);
      })
      .catch(() => {})
      .finally(() => this.active.delete(rec.id));
    return rec;
  }

  /** The models this system calls that have no key here, each with who uses it. */
  private keyless(doc: SystemDoc): string[] {
    const uses = modelUses(doc);
    return [...new Set(uses.map((u) => u.model))].flatMap((id) => {
      const m = doc.models.find((x) => x.id === id);
      if (!m || !m.api?.key_env || !["anthropic", "openai", "google"].includes(m.provider) || this.secrets.get(m.api.key_env)) return [];
      return [`Model "${id}" needs ${m.api.key_env} (used by ${[...new Set(uses.filter((u) => u.model === id).map((u) => u.where))].join(", ")})`];
    });
  }

  /** Evaluations cut off by a restart are marked stopped, with what they finished. */
  recover() {
    for (const rec of this.store.listEvals()) {
      if (rec.status !== "running" && rec.status !== "queued") continue;
      rec.status = "stopped";
      rec.finished_at = new Date().toISOString();
      for (const c of rec.cases) if (c.status === "pending" || c.status === "running") Object.assign(c, { status: "error", why: "the server restarted" });
      this.store.putEval(rec);
    }
  }

  /** Grades the stored outputs again, by a rule (the given one, or the evaluation's own); no run is repeated. */
  async regrade(id: string, grader?: Exclude<Grader, "llm">, check?: string): Promise<EvalRecord> {
    const rec = this.store.getEval(id);
    if (!rec) throw new Error("No such evaluation");
    if (this.active.has(id)) throw new Error("The evaluation is still running");
    const g = grader ?? rec.grader;
    if (g === "llm") throw new Error("Regrading with the LLM judge would call a model; start a new evaluation for that");
    if (g === "none" || rec.grader === "none") throw new Error("An evaluation that grades nothing is compared pairwise, not regraded");
    if (g === "check") {
      // the stored outputs checked again (no model is called): after a fix to the check, given here, or with the one kept
      const code = check?.trim() || (rec.grader === "check" ? rec.check : undefined);
      if (!code) throw new Error("The grader check needs its JS: give check");
      if (rec.grader === "llm") throw new Error("This evaluation was graded by the LLM judge; regrading by a rule would replace those verdicts. Start a new evaluation to grade it another way");
      for (const c of rec.cases) if (c.status === "done" && c.output) Object.assign(c, await gradeCheck(code, c.output, c.expected, c.input));
      rec.grader = "check";
      rec.check = code;
      rec.graded = rec.cases.filter((c) => c.pass !== undefined).length;
      rec.passed = rec.cases.filter((c) => c.pass).length;
      this.store.putEval(rec);
      return rec;
    }
    if (g === "code" || rec.grader === "code") {
      if (g !== rec.grader) throw new Error("Code is graded by running it against its tests; an evaluation graded another way cannot switch to it, nor away from it");
      // the stored answers run against their tests again (no model is called): after a fix to the grader
      this.active.add(id);
      try {
        const todo = rec.cases.filter((c) => c.status === "done" && c.output);
        let next = 0;
        const worker = async () => {
          while (next < todo.length) {
            const c = todo[next++];
            Object.assign(c, await gradeCode(c.expected, c.output!, this.docker));
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
      } finally {
        this.active.delete(id);
      }
      rec.graded = rec.cases.filter((c) => c.pass !== undefined).length;
      rec.passed = rec.cases.filter((c) => c.pass).length;
      this.store.putEval(rec);
      return rec;
    }
    // the judge's verdicts were paid for and cannot be had back by regrading: keep them
    if (rec.grader === "llm") throw new Error("This evaluation was graded by the LLM judge; regrading by a rule would replace those verdicts. Start a new evaluation to grade it another way");
    for (const c of rec.cases) {
      if (c.status !== "done" || !c.output) continue;
      Object.assign(c, gradeByRule(g as RuleGrader, c.output, c.expected, c.input));
      // who had the answer on a miss, from the run's log as it was kept (evaluations from before this was recorded too)
      delete c.reached;
      const sys = c.pass === false && c.run_id ? this.store.getRunSystem(c.run_id) : null;
      if (sys) c.reached = reachedBy(memberMessages(this.store.events(c.run_id!) as RunEvent[]), memberName(sys), g, c.expected, c.input);
    }
    rec.grader = g;
    rec.graded = rec.cases.filter((c) => c.pass !== undefined).length;
    rec.passed = rec.cases.filter((c) => c.pass).length;
    this.store.putEval(rec);
    return rec;
  }

  /**
   * A second opinion on the misses of an evaluation graded by rule: the LLM judge reads each wrong answer that
   * gave an output and says whether it agrees with the expected one. The grades stand; the misses the judge calls
   * right are what to check the grader against (an interval written as an inequality, a sum in another order).
   * One call per miss, one after another.
   */
  async audit(id: string, judgeModel?: string): Promise<EvalRecord> {
    const rec = this.store.getEval(id);
    if (!rec) throw new Error("No such evaluation");
    if (this.active.has(id)) throw new Error("The evaluation is still running");
    if (rec.grader === "llm") throw new Error("This evaluation was graded by the judge already");
    if (rec.grader === "code") throw new Error("Code is graded by running its tests; the judge cannot second-guess them");
    if (rec.mock) throw new Error("A mock evaluation has nothing to check");
    const misses = rec.cases.filter((c) => c.status === "done" && c.pass === false && c.output);
    if (!misses.length) throw new Error("No wrong answer to check");
    const doc = this.store.getSystem(rec.system_id);
    const known = new Set((doc?.models ?? []).map((m) => m.id));
    const models = new Models([...(doc?.models ?? []), ...DEFAULT_MODELS.filter((m) => !known.has(m.id))], this.secrets, false);
    const model = judgeModel || rec.on_model || undefined;
    this.active.add(id);
    try {
      let usd = 0;
      for (const c of misses) {
        const v = await this.judge(models, model, c.input, c.expected, c.output!);
        c.audit = { pass: v.pass, why: v.why.replace(/^judge: /, "") };
        usd += v.usd;
      }
      rec.audit_usd = (rec.audit_usd ?? 0) + usd;
      this.store.putEval(rec);
      return rec;
    } finally {
      this.active.delete(id);
    }
  }

  /**
   * Two evaluations of the same questions, judged pairwise (see PairwiseResult): for open-ended tasks with no
   * expected answer, such as articles or stories, as STORM and Agents' Room are evaluated. Questions are matched by
   * their text, each system's first output for it is used, and every pair is judged in both orders. The result is
   * kept with the two evaluations.
   */
  async pairwise(aId: string, bId: string, judgeModel?: string, criterion?: string, judgeSystem?: string, pointwise = false): Promise<PairwiseResult> {
    const [a, b] = [this.store.getEval(aId), this.store.getEval(bId)];
    if (!a || !b) throw new Error("No such evaluation");
    if (this.active.has(aId) || this.active.has(bId)) throw new Error("An evaluation is still running");
    const first = (rec: EvalRecord) => {
      const m = new Map<string, string>();
      for (const c of rec.cases) if (c.output && !m.has(c.input)) m.set(c.input, c.output);
      return m;
    };
    const [oa, ob] = [first(a), first(b)];
    const shared = [...oa.keys()].filter((q) => ob.has(q));
    if (!shared.length) throw new Error("The two evaluations have no question with an output in both");
    const doc = this.store.getSystem(a.system_id);
    const known = new Set((doc?.models ?? []).map((m) => m.id));
    const models = new Models([...(doc?.models ?? []), ...DEFAULT_MODELS.filter((m) => !known.has(m.id))], this.secrets, false);
    const judge = judgeModel || a.on_model || undefined;
    // a system can judge instead of one model call (ChatEval's referee panel): it runs on the judge model, given the
    // same prompt, and its output is read for the verdict
    const panel = judgeSystem ? this.store.getSystem(judgeSystem) : null;
    if (judgeSystem && !panel) throw new Error(`No such system: ${judgeSystem}`);
    const panelDoc = panel ? (judge ? runAllOn(panel, judge, DEFAULT_MODELS) : panel) : null;
    const what = criterion?.trim() || DEFAULT_CRITERION;
    // judgements under another criterion are kept beside the default ones, never in their place
    const tag = criterionTag(what);
    // the judge sees a response whole up to a generous length; past it, it is told so, so a long answer is not
    // read as one that broke off (a 12,000-character cut made long lists "stop mid-sentence at item 86")
    const SHOW = 60_000;
    const shown = (r: string) => (r.length <= SHOW ? r : `${r.slice(0, SHOW)}\n[… the rest of this response, ${r.length - SHOW} characters, is not shown here; it is not cut off in the answer itself]`);
    const judgeText = async (prompt: string): Promise<{ text: string; spent: number }> => {
      let text: string;
      let spent: number;
      if (panelDoc) {
        const run = this.runs.start(panelDoc, { input: prompt });
        await this.settle(run.id);
        const events = this.store.events(run.id) as RunEvent[];
        text = events.filter((e): e is Extract<RunEvent, { type: "output" }> => e.type === "output").map((e) => e.text).join("\n\n");
        spent = this.runs.get(run.id)?.usd ?? 0;
      } else {
        // the judge model's own output limit: one that thinks first spends its thinking from the same allowance
        // (gemma's ran past 4,000 tokens and gave no verdict on 5 of 20)
        const { res, usage } = await models.chat(judge ?? null, { messages: [userText(prompt)] });
        text = textOf(res.content);
        spent = usage.usd;
      }
      return { text, spent };
    };
    // pointwise: each response scored on its own, never beside the other, so the order cannot sway it (a judge that
    // picks whichever story it read first in four readings of five gives mostly ties pairwise)
    const score = async (task: string, r: string): Promise<{ score: number | null; usd: number; why: string }> => {
      const prompt = `You rate a response to a task.\n\nTask:\n${task.slice(0, 4000)}\n\nResponse:\n${shown(r)}\n\n${what}\nJudge this response on its own. Give a short reason, then a last line exactly 'Score: N', where N is 1 (very poor) to 10 (excellent).`;
      const { text, spent } = await judgeText(prompt);
      const all = [...text.matchAll(/score:\s*\**\s*(\d+(?:\.\d+)?)/gi)];
      const n = all.length ? Number(all.at(-1)![1]) : null;
      return { score: n !== null && n >= 1 && n <= 10 ? n : null, usd: spent, why: text.trim().slice(-600) };
    };
    const ask = async (task: string, r1: string, r2: string): Promise<{ pick: "1" | "2" | "tie" | null; usd: number; why: string }> => {
      const prompt = `You compare two responses to the same task.\n\nTask:\n${task.slice(0, 4000)}\n\nResponse 1:\n${shown(r1)}\n\nResponse 2:\n${shown(r2)}\n\n${what}\nGive a short reason, then a last line exactly 'Better: 1', 'Better: 2' or 'Better: tie'.`;
      const { text, spent } = await judgeText(prompt);
      // the last verdict line counts; "Better: Response 1" is read as 1
      const all = [...text.matchAll(/better:\s*\**\s*(?:response\s*)?(1|2|tie)\b/gi)];
      const pick = (all.at(-1)?.[1]?.toLowerCase() as "1" | "2" | "tie" | undefined) ?? null;
      return { pick, usd: spent, why: text.trim().slice(-600) };
    };
    // judging only reads the two evaluations: several judges can work on them at once (each keeps its own file)
    const label = (panel ? `${panel.name} on ${judge ?? "its models"}` : (judge ?? "default")) + (pointwise ? " (pointwise)" : "");
    const key = `${aId}|${bId}|${label}|${tag}`;
    const progress = { a: aId, b: bId, judge: label, done: 0, total: shared.length, started: new Date().toISOString() } as { a: string; b: string; judge: string; done: number; total: number; started: string; error?: string };
    this.judging.set(key, progress);
    try {
      const per: PairwiseResult["per"] = [];
      let usd = 0;
      for (const q of shared) {
        if (pointwise) {
          const sa = await score(q, oa.get(q)!);
          const sb = await score(q, ob.get(q)!);
          usd += sa.usd + sb.usd;
          const v = sa.score === null || sb.score === null ? "unread" : sa.score > sb.score ? "a" : sb.score > sa.score ? "b" : "tie";
          per.push({ input: q, first: v, second: v, verdict: v === "unread" ? "tie" : v, why: [sa.why, sb.why], scores: [sa.score, sb.score] });
          progress.done++;
          continue;
        }
        const x = await ask(q, oa.get(q)!, ob.get(q)!); // a first
        const y = await ask(q, ob.get(q)!, oa.get(q)!); // b first
        usd += x.usd + y.usd;
        const firstPick = x.pick === "1" ? "a" : x.pick === "2" ? "b" : x.pick === "tie" ? "tie" : "unread";
        const secondPick = y.pick === "1" ? "b" : y.pick === "2" ? "a" : y.pick === "tie" ? "tie" : "unread";
        const verdict = firstPick === secondPick && firstPick !== "unread" ? firstPick : "tie";
        per.push({ input: q, first: firstPick, second: secondPick, verdict, why: [x.why, y.why] });
        progress.done++;
      }
      const result: PairwiseResult = {
        a: aId,
        b: bId,
        a_name: a.system_name,
        b_name: b.system_name,
        judge: label,
        ...(pointwise ? { mode: "pointwise" as const } : {}),
        criterion: what,
        a_wins: per.filter((p) => p.verdict === "a").length,
        b_wins: per.filter((p) => p.verdict === "b").length,
        ties: per.filter((p) => p.verdict === "tie").length,
        per,
        usd,
        at: new Date().toISOString(),
      };
      // one file per pair and judge (its full label: a panel on a model is not that model alone)
      fs.writeFileSync(path.join(this.store.stateDir("_pairwise"), `${aId}__${bId}__${result.judge.replace(/[^\w.-]/g, "_")}${tag ? `__${tag}` : ""}.json`), JSON.stringify(result, null, 1));
      this.judging.delete(key);
      return result;
    } catch (e) {
      // a failure stays listed for a while, so a page that started it in the background can say why
      progress.error = (e as Error).message;
      setTimeout(() => this.judging.get(key) === progress && this.judging.delete(key), 600_000).unref?.();
      throw e;
    }
  }

  /** Pairwise judgements in progress (or failed in the last ten minutes) that involve an evaluation. */
  judgingOf(id: string) {
    return [...this.judging.values()].filter((j) => j.a === id || j.b === id);
  }

  /** Mark an evaluation invalid (a setup bug found after it ran), or valid again with a null reason. */
  markInvalid(id: string, reason: string | null): EvalRecord {
    const rec = this.store.getEval(id);
    if (!rec) throw new Error("No such evaluation");
    if (this.active.has(id)) throw new Error("The evaluation is still running");
    rec.invalid = reason?.trim() ? { reason: reason.trim().slice(0, 500), at: new Date().toISOString() } : null;
    this.store.putEval(rec);
    return rec;
  }

  /** Per output: the links it cites and how many its run's searches returned (see sourcedLinks). */
  sources(id: string): { cited: number; found: number; searches: number; outputs: number; with_search: number; words: number; headings: number; items: number; tables: number } {
    const rec = this.store.getEval(id);
    if (!rec) throw new Error("No such evaluation");
    // links, and the outputs' shape (summed: divide by outputs for a mean; tables counts outputs with one)
    const sum = { cited: 0, found: 0, searches: 0, outputs: 0, with_search: 0, words: 0, headings: 0, items: 0, tables: 0 };
    for (const c of rec.cases) {
      if (!c.output || !c.run_id) continue;
      const tools = (this.store.events(c.run_id) as RunEvent[]).filter((e) => e.type === "tool") as unknown as { tool: string; args?: unknown; result?: unknown }[];
      const s = sourcedLinks(c.output, tools);
      sum.outputs++;
      sum.cited += s.cited;
      sum.found += s.found;
      sum.searches += s.searches;
      if (s.searches) sum.with_search++;
      const shape = outputShape(c.output);
      sum.words += shape.words;
      sum.headings += shape.headings;
      sum.items += shape.items;
      sum.tables += shape.tables;
    }
    return sum;
  }

  /** The pairwise judgements kept for an evaluation (either side). */
  pairwiseOf(id: string): PairwiseResult[] {
    const dir = this.store.stateDir("_pairwise");
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && f.replace(/\.json$/, "").split("__").slice(0, 2).includes(id))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as PairwiseResult);
  }

  get(id: string) {
    return this.store.getEval(id);
  }
  isActive(id: string) {
    return this.active.has(id);
  }
  stop(id: string) {
    if (!this.active.has(id)) return false;
    this.stopped.add(id);
    const rec = this.store.getEval(id);
    if (rec?.status === "queued") {
      // it never started: record it as stopped now, with nothing run
      Object.assign(rec, { status: "stopped", finished_at: new Date().toISOString() });
      for (const c of rec.cases) c.why = "not run (stopped before its turn)";
      this.store.putEval(rec);
      this.active.delete(id);
      return true;
    }
    // a case is "running" until it is graded, so its run may already have ended: stop only live ones, and never let one stop the rest
    for (const c of this.store.getEval(id)?.cases ?? []) {
      if (c.status !== "running" || !c.run_id || !this.runs.isActive(c.run_id)) continue;
      try {
        this.runs.stop(c.run_id);
      } catch {
        /* it ended in the meantime */
      }
    }
    return true;
  }

  /** The cases a retry runs again: errors, runs that gave no output, and cases a stop or a restart left unrun. */
  static retryable(c: EvalRecord["cases"][number]): boolean {
    return retryableCase(c);
  }

  /**
   * Run again only the cases that failed for want of an answer (an error, no output, never run), in place, with
   * the options the evaluation ran with: hours of a slow model are not redone for a few dropped connections.
   */
  retry(id: string, concurrency = 2): EvalRecord {
    const rec = this.store.getEval(id);
    if (!rec) throw new Error("No such evaluation");
    if (this.active.has(id)) throw new Error("The evaluation is still running");
    if (rec.grader === "llm") throw new Error("An evaluation graded by the LLM judge cannot be retried in place; start a new one");
    const doc = this.store.getSystem(rec.system_id);
    if (!doc) throw new Error("Its system no longer exists");
    const again = new Set(rec.cases.map((c, i) => (EvalManager.retryable(c) ? i : -1)).filter((i) => i >= 0));
    if (!again.size) throw new Error("No case to retry: every case gave an answer (wrong answers are results, not failures)");
    const opts: EvalOptions = {
      cases: [],
      grader: rec.grader,
      mock: rec.mock,
      concurrency,
      ...(rec.vars ? { vars: rec.vars } : {}),
      ...(rec.on_model ? { on_model: rec.on_model } : {}),
      ...(rec.time_limit_min != null ? { time_limit_min: rec.time_limit_min } : {}),
      ...(rec.usd_limit != null ? { usd_limit: rec.usd_limit } : {}),
      ...(rec.model_map ? { model_map: rec.model_map } : {}),
      ...(rec.expect ? { expect: rec.expect } : {}),
    };
    const prepared = this.prepare(doc, opts);
    for (const i of again) resetCase(rec.cases[i]);
    rec.status = "running";
    delete rec.finished_at;
    this.store.putEval(rec);
    this.active.add(rec.id);
    void this.execute(rec, prepared, opts, again).finally(() => this.active.delete(rec.id));
    return rec;
  }

  private async execute(rec: EvalRecord, doc: SystemDoc, opts: EvalOptions, cases?: Set<number>) {
    let only = cases;
    const judge = opts.grader === "llm" ? new Models(doc.models.length ? doc.models : DEFAULT_MODELS, this.secrets, !!opts.mock) : null;
    const save = () => {
      rec.graded = rec.cases.filter((c) => c.pass !== undefined).length;
      rec.passed = rec.cases.filter((c) => c.pass).length;
      rec.usd = rec.cases.reduce((s, c) => s + (c.usd ?? 0), 0);
      this.store.putEval(rec);
    };
    let next = 0;
    // an account problem (a dead key, no credit) fails every case the same way: stop after three in a row instead of running them all
    let fatalStreak = 0;
    const worker = async () => {
      while (next < rec.cases.length && !this.stopped.has(rec.id)) {
        const idx = next++;
        // a retry runs only the cases it reset
        if (only && !only.has(idx)) continue;
        const c = rec.cases[idx];
        const t0 = Date.now();
        c.status = "running";
        try {
          const run = this.runs.start(doc, { input: c.input, mock: opts.mock, vars: opts.vars });
          c.run_id = run.id;
          save();
          await this.settle(run.id);
          const done = this.runs.get(run.id)!;
          const events = this.store.events(run.id) as RunEvent[];
          c.output = events.filter((e): e is Extract<RunEvent, { type: "output" }> => e.type === "output").map((e) => e.text).join("\n\n");
          c.usd = done.usd;
          if (done.result_check) c.result_ok = done.result_check.ok;
          // stopped at a limit with the conversation unfinished: the answer is its last message, and the case says so
          c.cut_short = events.some((e) => e.type === "log" && (e as { text?: string }).text?.includes("did not end on its own")) || undefined;
          if (!c.output) {
            c.pass = false;
            const err = events.find((e): e is Extract<RunEvent, { type: "log" }> => e.type === "log" && e.level === "error")?.text;
            c.why = err ? `no output: ${err.slice(0, 300)}` : `no output (${done.status}${done.reason ? `: ${done.reason}` : ""})`;
            if (err && ACCOUNT_ERROR.test(err)) {
              if (++fatalStreak >= 3 && !rec.passed && !this.stopped.has(rec.id)) {
                rec.stop_reason = `Stopped: every run fails with the same account error — ${err.slice(0, 300)}`;
                this.stopped.add(rec.id);
              }
            } else fatalStreak = 0;
          } else if (judge) {
            const { usd, ...verdict } = await this.judge(judge, opts.judge, c.input, c.expected, c.output);
            Object.assign(c, verdict);
            c.usd = (c.usd ?? 0) + usd;
          } else if (opts.grader === "code") {
            Object.assign(c, await gradeCode(c.expected, c.output, this.docker));
          } else if (opts.grader === "check") {
            Object.assign(c, await gradeCheck(rec.check ?? "", c.output, c.expected, c.input));
          } else if (opts.grader === "none") {
            // an open-ended task: the output is kept, ungraded, for a pairwise comparison
            c.answer = finalAnswer(c.output);
          } else {
            Object.assign(c, gradeByRule(opts.grader as RuleGrader, c.output, c.expected, c.input));
            // a miss: did a member have the right answer on the way, and the team lose it?
            if (c.pass === false) c.reached = reachedBy(memberMessages(events), memberName(doc), opts.grader, c.expected, c.input);
          }
          if (c.output) fatalStreak = 0;
          c.status = "done";
        } catch (e) {
          c.status = "error";
          c.pass = false;
          c.why = (e as Error).message;
        }
        c.seconds = Math.round((Date.now() - t0) / 100) / 10;
        save();
      }
    };
    const workers = Number.isFinite(Number(opts.concurrency)) ? Math.max(1, Math.min(Math.floor(Number(opts.concurrency)), 8)) : 2;
    try {
      await Promise.all(Array.from({ length: workers }, worker));
      // cases a provider failed in passing (a 503, a dropped stream) run once more at the end, so a busy hour does not
      // count as wrong answers; a second failure stands
      const again = new Set(rec.cases.map((c, i) => (c.pass === false && TRANSIENT.test(c.why ?? "") && !ACCOUNT_ERROR.test(c.why ?? "") ? i : -1)).filter((i) => i >= 0));
      if (again.size && !opts.mock && !this.stopped.has(rec.id)) {
        for (const i of again) resetCase(rec.cases[i]);
        rec.auto_retried = (rec.auto_retried ?? 0) + again.size;
        save();
        only = again;
        next = 0;
        await Promise.all(Array.from({ length: workers }, worker));
      }
    } finally {
      // whatever happened above, the evaluation leaves "running"
      rec.status = this.stopped.has(rec.id) ? "stopped" : "finished";
      rec.finished_at = new Date().toISOString();
      for (const c of rec.cases) if (c.status === "pending") c.why = "not run (stopped)";
      this.stopped.delete(rec.id);
      try {
        save();
      } catch (e) {
        console.error(`evaluation ${rec.id}: could not save its result: ${(e as Error).message}`);
      }
    }
  }

  /** Waits for a run to end. A run that waits for a person cannot be graded unattended: it is stopped. */
  private async settle(runId: string) {
    while (this.runs.isActive(runId)) {
      if (this.runs.get(runId)?.status === "waiting") {
        this.runs.stop(runId);
        throw new Error("the run asked a person for input; evaluations run unattended");
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  private async judge(models: Models, model: string | undefined, input: string, expected: string, output: string) {
    const prompt = `Grade a system's answer.\n\nQuestion:\n${input}\n\nExpected answer:\n${expected}\n\nThe system's output:\n${output.slice(-4000)}\n\nDoes the output's final answer agree with the expected answer? Wording may differ; the substance must match. Reply with one line: PASS or FAIL, then a short reason.`;
    const { res, usage } = await models.chat(model ?? null, { messages: [userText(prompt)], max_tokens: 200 });
    const verdict = textOf(res.content).trim();
    return { pass: /^\W*pass\b/i.test(verdict), answer: finalAnswer(output), why: `judge: ${verdict.slice(0, 300)}`, usd: usage.usd };
  }
}

/** The messages a run's components sent to one another (not the system's output). */
function memberMessages(events: RunEvent[]): { from: string; text: string }[] {
  return events.filter((e): e is Extract<RunEvent, { type: "message" }> => e.type === "message").map((e) => ({ from: e.from, text: e.text }));
}

/** The name of a member that reasons (a model or an agent component, group members included), or null for anything else. */
function memberName(doc: SystemDoc): (id: string) => string | null {
  const names = new Map(doc.nodes.filter((n) => n.data.kind === "model" || n.data.kind === "agent").map((n) => [n.id, n.data.name || n.id]));
  return (id) => names.get(id) ?? null;
}
