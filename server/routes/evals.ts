// Evaluations: run a system over cases and grade the outputs.
import { RESULT_TYPES } from "@/run/result";
import type { ResultSpec } from "@/model/types";
import { validate } from "@/model/validate";
import { caseSetId, type EvalCase, type Grader } from "@/run/evals";
import type { SystemDoc } from "@/model/types";
import type { Router } from "../http";
import type { EvalManager } from "../runtime/evals";
import { sampleCases } from "@/run/datasets";
import { HttpError, type Store } from "../store/files";
import { findDataset } from "./datasets";
import { checkDoc } from "./systems";

const GRADERS: Grader[] = ["answer", "contains", "number", "math", "llm", "code", "check", "none"];

export function evalRoutes(r: Router, store: Store, evals: EvalManager) {
  type StartBody = { system_id?: string; doc?: unknown; cases?: EvalCase[]; grader?: Grader; mock?: boolean; concurrency?: number; judge?: string; on_model?: string; time_limit_min?: number; usd_limit?: number; max_usd?: number; repeats?: number; model_map?: Record<string, string>; vars?: Record<string, unknown>; dataset_id?: string; sample?: { n?: number; seed?: number }; force?: boolean; expect?: ResultSpec | null; check?: string };
  // the questions and options of an evaluation, shared by one system and a batch of them
  /** What every answer must be (an evaluation's own result check): a known type, optionally marked. */
  const checkExpect = (x: unknown): ResultSpec | undefined => {
    if (x == null) return undefined;
    const e = x as ResultSpec;
    if (typeof e !== "object" || !RESULT_TYPES.some((t) => t.value === e.type)) throw new HttpError(400, `expect.type must be one of ${RESULT_TYPES.map((t) => t.value).join(", ")}`);
    return { type: e.type, ...(e.marked ? { marked: true } : {}), ...(Array.isArray(e.choices) ? { choices: e.choices.map(String) } : {}) };
  };
  const prepare = (b: StartBody) => {
    let cases = b.cases;
    let grader = b.grader;
    let check = b.check?.trim() || undefined;
    let dataset: { id: string; name: string; version: string; n?: number; seed?: number } | undefined;
    if (b.dataset_id) {
      const d = findDataset(store, b.dataset_id);
      if (!d) throw new HttpError(404, `No dataset ${b.dataset_id}`);
      const n = Number(b.sample?.n) || undefined;
      const seed = Number(b.sample?.seed ?? 1) || 1;
      cases = sampleCases(d.cases, n, seed);
      dataset = { id: d.id, name: d.name, version: d.version, ...(n && n < d.cases.length ? { n, seed } : {}) };
      grader ??= d.grader;
      check = b.check?.trim() || d.check;
    }
    if (!Array.isArray(cases) || !cases.length) throw new HttpError(400, "Give cases: [{input, expected}, …], or a dataset_id");
    grader ??= "answer";
    if (!GRADERS.includes(grader)) throw new HttpError(400, `grader must be one of ${GRADERS.join(", ")}`);
    return { dataset, cases, grader, ...(grader === "check" ? { check } : {}), mock: !!b.mock, concurrency: b.concurrency, judge: b.judge, on_model: b.on_model || undefined, time_limit_min: b.time_limit_min ?? undefined, usd_limit: b.usd_limit ?? undefined, max_usd: b.max_usd ?? undefined, repeats: b.repeats, model_map: b.model_map, vars: b.vars && typeof b.vars === "object" ? b.vars : undefined, expect: checkExpect(b.expect) };
  };
  const checkValid = (doc: SystemDoc, force?: boolean) => {
    const errors = validate(doc).filter((i) => i.severity === "error");
    if (errors.length && !force) throw new HttpError(422, `${doc.name} has ${errors.length} error${errors.length > 1 ? "s" : ""}: ${errors.slice(0, 3).map((e) => e.message).join("; ")}`);
  };

  r.on("POST", "/api/evals", async (req) => {
    const b = (await req.body()) as StartBody;
    // like runs: the browser sends the system as it is now, which also stores it
    const doc = b.doc ? checkDoc(b.doc) : b.system_id ? store.getSystem(b.system_id) : null;
    if (!doc) throw new HttpError(400, "Give a system_id or a doc");
    if (b.doc) store.putSystem(doc);
    const opts = prepare(b);
    checkValid(doc, b.force);
    try {
      return evals.start(doc, opts);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });

  // several systems on the same questions, one after another (never at once, to keep the request rate low)
  r.on("POST", "/api/evals/batch", async (req) => {
    // the systems by id, or as the browser has them now (which also stores them, as a single evaluation does)
    const b = (await req.body()) as StartBody & { system_ids?: string[]; docs?: unknown[]; sweep?: { name?: string; values?: unknown[] } };
    const given = Array.isArray(b.docs) ? b.docs.map((d) => checkDoc(d)) : null;
    const docs = given ?? (Array.isArray(b.system_ids) ? [...new Set(b.system_ids.map(String))].map((id) => store.getSystem(id) ?? (() => { throw new HttpError(404, `No system ${id}`); })()) : []);
    if (!docs.length || docs.length > 10) throw new HttpError(400, "Give system_ids or docs: one to ten systems");
    const opts = prepare(b);
    // a sweep: each system once per value of one run variable (n = 2, 4, 8), one after another, to compare on Compare
    const sweep = b.sweep;
    const values = Array.isArray(sweep?.values) ? sweep.values : null;
    if (sweep && (!sweep.name || !/^[A-Za-z_]\w*$/.test(String(sweep.name)) || !values?.length || values.length > 10)) throw new HttpError(400, "sweep needs a variable name and one to ten values");
    if (values && docs.length * values.length > 20) throw new HttpError(400, `A sweep of ${values.length} values over ${docs.length} systems is ${docs.length * values.length} evaluations; at most 20 at once`);
    const variants = values ? values.map((v) => ({ ...opts, vars: { ...(opts.vars ?? {}), [String(sweep!.name)]: v } })) : [opts];
    for (const d of docs) checkValid(d, b.force); // all or none: a batch that stops halfway compares less than it says
    if (given) for (const d of given) store.putSystem(d);
    try {
      for (const d of docs) evals.prepare(d, opts); // a model with no key in any of them refuses the whole batch
      return { evals: variants.flatMap((o) => docs.map((d) => evals.start(d, o, true))) };
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
  r.on("GET", "/api/evals", (req) =>
    ({
      evals: store.listEvals(req.query.get("system") ?? undefined).map(({ cases, ...rest }) => ({
        ...rest,
        total: cases.length,
        // evaluations of the same questions group together, however they were given (a dataset, a file, typed)
        set: caseSetId(cases),
        questions: new Set(cases.map((c) => c.input)).size,
        first_question: cases[0]?.input.slice(0, 120) ?? "",
        // a name for the set, when it came from a dataset
        ...(rest.dataset ? { set_name: `${rest.dataset.name}${rest.dataset.n ? ` (sample of ${rest.dataset.n}, seed ${rest.dataset.seed})` : ""}` } : {}),
      })),
    })),
  r.on("GET", "/api/evals/:id", (req) => {
    const rec = evals.get(req.params.id);
    if (!rec) throw new HttpError(404, "No such evaluation");
    return { eval: rec, active: evals.isActive(rec.id) };
  });
  r.on("POST", "/api/evals/:id/regrade", async (req) => {
    const b = ((await req.body()) ?? {}) as { grader?: Grader; check?: string };
    if (b.grader && !GRADERS.includes(b.grader)) throw new HttpError(400, `grader must be one of ${GRADERS.join(", ")}`);
    try {
      return await evals.regrade(req.params.id, b.grader as Exclude<Grader, "llm"> | undefined, typeof b.check === "string" ? b.check : undefined);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
  r.on("POST", "/api/evals/pairwise", async (req) => {
    const b = ((await req.body()) ?? {}) as { a?: string; b?: string; judge?: string; criterion?: string; judge_system?: string; wait?: boolean; pointwise?: boolean };
    if (!b.a || !b.b || b.a === b.b) throw new HttpError(400, "Give two different evaluations, a and b");
    const job = evals.pairwise(String(b.a), String(b.b), b.judge ? String(b.judge) : undefined, b.criterion ? String(b.criterion) : undefined, b.judge_system ? String(b.judge_system) : undefined, b.pointwise === true);
    if (b.wait === false) {
      // in the background: GET /api/evals/:id/pairwise lists it while it runs (or why it failed), then its result
      // its checks (the evaluations, a shared question, the judging system) run before its first await, so a request
      // that cannot start has already failed here and says why
      try {
        await Promise.race([job, Promise.resolve(null)]);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      job.catch(() => undefined);
      return { started: true };
    }
    try {
      return { pairwise: await job };
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
  r.on("GET", "/api/evals/:id/pairwise", (req) => ({ pairwise: evals.pairwiseOf(req.params.id), judging: evals.judgingOf(req.params.id) }));
  r.on("PUT", "/api/evals/:id/invalid", async (req) => {
    const b = ((await req.body()) ?? {}) as { reason?: string | null };
    try {
      return { eval: evals.markInvalid(req.params.id, b.reason == null ? null : String(b.reason)) };
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
  r.on("GET", "/api/evals/:id/trail", async (req) => {
    try {
      return { trail: await evals.trail(req.params.id) };
    } catch (e) {
      throw new HttpError(404, (e as Error).message);
    }
  });
  r.on("GET", "/api/evals/:id/sources", (req) => {
    try {
      return { sources: evals.sources(req.params.id) };
    } catch (e) {
      throw new HttpError(404, (e as Error).message);
    }
  });
  r.on("POST", "/api/evals/:id/audit", async (req) => {
    const b = ((await req.body()) ?? {}) as { judge?: string };
    try {
      return { eval: await evals.audit(req.params.id, b.judge ? String(b.judge) : undefined) };
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
  r.on("POST", "/api/evals/:id/retry", async (req) => {
    const b = ((await req.body()) ?? {}) as { concurrency?: number };
    try {
      return { eval: evals.retry(req.params.id, Number(b.concurrency) || 2) };
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
  r.on("POST", "/api/evals/:id/stop", (req) => ({ stopped: evals.stop(req.params.id) }));
  r.on("DELETE", "/api/evals/:id", (req) => {
    if (evals.isActive(req.params.id)) throw new HttpError(409, "Stop the evaluation first");
    store.deleteEval(req.params.id);
    return { ok: true };
  });
}
