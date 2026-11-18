// Runs a system over a set of cases and grades each output: the evaluation a
// paper reports. Cases run a few at a time as ordinary runs, so each one can
// be replayed like any other.
import { randomUUID } from "node:crypto";
import { DEFAULT_MODELS } from "@/model/defaults";
import { remapModels, runAllOn } from "@/model/modelUse";
import type { SystemDoc } from "@/model/types";
import { type EvalCase, type EvalRecord, type Grader, finalAnswer, gradeByRule } from "@/run/evals";
import type { RunEvent } from "@/run/events";
import type { Store } from "../store/files";
import type { Secrets } from "../store/secrets";
import { gradeCode } from "./grading/code";
import { Models, textOf, userText } from "./models";
import type { RunManager } from "./runs";

export interface EvalOptions {
  cases: EvalCase[];
  /** the dataset the cases came from, kept on the record */
  dataset?: EvalRecord["dataset"];
  grader: Grader;
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
  /** serve chosen models with others, after on_model: { sonnet: "gemini", gpt: "gemini_lite" } */
  model_map?: Record<string, string>;
}

const MAX_CASES = 200;
/** errors no retry fixes: a rejected or disabled key, no credit, a used-up quota, a model that is gone */
const ACCOUNT_ERROR = /\b(401|403)\b|api key|service account|credit|billing|quota|permission denied|no longer available|model .*not found|does not exist/i;

export class EvalManager {
  private stopped = new Set<string>();
  private active = new Set<string>();
  constructor(
    private store: Store,
    private runs: RunManager,
    private secrets: Secrets,
    /** the Docker binary, for grading code by running it */
    private docker = "docker",
  ) {}

  start(original: SystemDoc, opts: EvalOptions): EvalRecord {
    let doc = opts.on_model ? runAllOn(original, opts.on_model, DEFAULT_MODELS) : original;
    if (opts.model_map && Object.keys(opts.model_map).length) doc = remapModels(doc, opts.model_map, DEFAULT_MODELS);
    const repeats = Number.isFinite(Number(opts.repeats ?? 1)) ? Math.max(1, Math.min(Math.floor(Number(opts.repeats ?? 1)), 5)) : 1;
    const cases = opts.cases.filter((c) => String(c.input ?? "").trim()).slice(0, Math.floor(MAX_CASES / repeats));
    if (!cases.length) throw new Error("No cases: each needs an input");
    const rec: EvalRecord = {
      id: `eval_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`,
      system_id: doc.id,
      system_name: doc.name,
      grader: opts.grader,
      mock: !!opts.mock,
      repeats,
      ...(opts.dataset ? { dataset: opts.dataset } : {}),
      ...(opts.vars && Object.keys(opts.vars).length ? { vars: opts.vars } : {}),
      ...(opts.on_model ? { on_model: opts.on_model } : {}),
      ...(opts.model_map && Object.keys(opts.model_map).length ? { model_map: opts.model_map } : {}),
      status: "running",
      started_at: new Date().toISOString(),
      // repeat 1 of every question first, then repeat 2…: a stopped evaluation still has whole repeats
      cases: Array.from({ length: repeats }, (_, r) => cases.map((c, i) => ({ case: i, repeat: r, input: String(c.input), expected: String(c.expected ?? ""), status: "pending" as const }))).flat(),
      passed: 0,
      graded: 0,
      usd: 0,
    };
    this.store.putEval(rec);
    this.active.add(rec.id);
    void this.execute(rec, doc, opts).finally(() => this.active.delete(rec.id));
    return rec;
  }

  /** Evaluations cut off by a restart are marked stopped, with what they finished. */
  recover() {
    for (const rec of this.store.listEvals()) {
      if (rec.status !== "running") continue;
      rec.status = "stopped";
      rec.finished_at = new Date().toISOString();
      for (const c of rec.cases) if (c.status === "pending" || c.status === "running") Object.assign(c, { status: "error", why: "the server restarted" });
      this.store.putEval(rec);
    }
  }

  /** Grades the stored outputs again, by a rule (the given one, or the evaluation's own); no run is repeated. */
  regrade(id: string, grader?: Exclude<Grader, "llm">): EvalRecord {
    const rec = this.store.getEval(id);
    if (!rec) throw new Error("No such evaluation");
    if (this.active.has(id)) throw new Error("The evaluation is still running");
    const g = grader ?? rec.grader;
    if (g === "llm") throw new Error("Regrading with the LLM judge would call a model; start a new evaluation for that");
    if (g === "code" || rec.grader === "code") throw new Error("Code is graded by running it; start a new evaluation to grade it again");
    // the judge's verdicts were paid for and cannot be had back by regrading: keep them
    if (rec.grader === "llm") throw new Error("This evaluation was graded by the LLM judge; regrading by a rule would replace those verdicts. Start a new evaluation to grade it another way");
    for (const c of rec.cases) if (c.status === "done" && c.output) Object.assign(c, gradeByRule(g as Exclude<Grader, "llm" | "code">, c.output, c.expected, c.input));
    rec.grader = g;
    rec.graded = rec.cases.filter((c) => c.pass !== undefined).length;
    rec.passed = rec.cases.filter((c) => c.pass).length;
    this.store.putEval(rec);
    return rec;
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

  private async execute(rec: EvalRecord, doc: SystemDoc, opts: EvalOptions) {
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
        const c = rec.cases[next++];
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
          } else {
            Object.assign(c, gradeByRule(opts.grader as Exclude<Grader, "llm" | "code">, c.output, c.expected, c.input));
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
