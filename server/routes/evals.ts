// Evaluations: run a system over cases and grade the outputs.
import { validate } from "@/model/validate";
import { caseSetId, type EvalCase, type Grader } from "@/run/evals";
import type { SystemDoc } from "@/model/types";
import type { Router } from "../http";
import type { EvalManager } from "../runtime/evals";
import { sampleCases } from "@/run/datasets";
import { HttpError, type Store } from "../store/files";
import { findDataset } from "./datasets";
import { checkDoc } from "./systems";

const GRADERS: Grader[] = ["answer", "contains", "number", "llm", "code"];

export function evalRoutes(r: Router, store: Store, evals: EvalManager) {
  type StartBody = { system_id?: string; doc?: unknown; cases?: EvalCase[]; grader?: Grader; mock?: boolean; concurrency?: number; judge?: string; on_model?: string; repeats?: number; model_map?: Record<string, string>; vars?: Record<string, unknown>; dataset_id?: string; sample?: { n?: number; seed?: number }; force?: boolean };
  // the questions and options of an evaluation, shared by one system and a batch of them
  const prepare = (b: StartBody) => {
    let cases = b.cases;
    let grader = b.grader;
    let dataset: { id: string; name: string; version: string; n?: number; seed?: number } | undefined;
    if (b.dataset_id) {
      const d = findDataset(store, b.dataset_id);
      if (!d) throw new HttpError(404, `No dataset ${b.dataset_id}`);
      const n = Number(b.sample?.n) || undefined;
      const seed = Number(b.sample?.seed ?? 1) || 1;
      cases = sampleCases(d.cases, n, seed);
      dataset = { id: d.id, name: d.name, version: d.version, ...(n && n < d.cases.length ? { n, seed } : {}) };
      grader ??= d.grader;
    }
    if (!Array.isArray(cases) || !cases.length) throw new HttpError(400, "Give cases: [{input, expected}, …], or a dataset_id");
    grader ??= "answer";
    if (!GRADERS.includes(grader)) throw new HttpError(400, `grader must be one of ${GRADERS.join(", ")}`);
    return { dataset, cases, grader, mock: !!b.mock, concurrency: b.concurrency, judge: b.judge, on_model: b.on_model || undefined, repeats: b.repeats, model_map: b.model_map, vars: b.vars && typeof b.vars === "object" ? b.vars : undefined };
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
    const b = (await req.body()) as StartBody & { system_ids?: string[]; docs?: unknown[] };
    const given = Array.isArray(b.docs) ? b.docs.map((d) => checkDoc(d)) : null;
    const docs = given ?? (Array.isArray(b.system_ids) ? [...new Set(b.system_ids.map(String))].map((id) => store.getSystem(id) ?? (() => { throw new HttpError(404, `No system ${id}`); })()) : []);
    if (!docs.length || docs.length > 10) throw new HttpError(400, "Give system_ids or docs: one to ten systems");
    const opts = prepare(b);
    for (const d of docs) checkValid(d, b.force); // all or none: a batch that stops halfway compares less than it says
    if (given) for (const d of given) store.putSystem(d);
    try {
      return { evals: docs.map((d) => evals.start(d, opts, true)) };
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
    const b = ((await req.body()) ?? {}) as { grader?: Grader };
    if (b.grader && !GRADERS.includes(b.grader)) throw new HttpError(400, `grader must be one of ${GRADERS.join(", ")}`);
    try {
      return evals.regrade(req.params.id, b.grader as Exclude<Grader, "llm"> | undefined);
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
