// Evaluations: run a system over cases and grade the outputs.
import { validate } from "@/model/validate";
import { caseSetId, type EvalCase, type Grader } from "@/run/evals";
import type { Router } from "../http";
import type { EvalManager } from "../runtime/evals";
import { HttpError, type Store } from "../store/files";
import { checkDoc } from "./systems";

const GRADERS: Grader[] = ["answer", "contains", "number", "llm"];

export function evalRoutes(r: Router, store: Store, evals: EvalManager) {
  r.on("POST", "/api/evals", async (req) => {
    const b = (await req.body()) as { system_id?: string; doc?: unknown; cases?: EvalCase[]; grader?: Grader; mock?: boolean; concurrency?: number; judge?: string; on_model?: string; repeats?: number; model_map?: Record<string, string>; force?: boolean };
    // like runs: the browser sends the system as it is now, which also stores it
    const doc = b.doc ? checkDoc(b.doc) : b.system_id ? store.getSystem(b.system_id) : null;
    if (!doc) throw new HttpError(400, "Give a system_id or a doc");
    if (b.doc) store.putSystem(doc);
    if (!Array.isArray(b.cases) || !b.cases.length) throw new HttpError(400, "Give cases: [{input, expected}, …]");
    const grader = b.grader ?? "answer";
    if (!GRADERS.includes(grader)) throw new HttpError(400, `grader must be one of ${GRADERS.join(", ")}`);
    const errors = validate(doc).filter((i) => i.severity === "error");
    if (errors.length && !b.force) throw new HttpError(422, `The system has ${errors.length} error${errors.length > 1 ? "s" : ""}: ${errors.slice(0, 3).map((e) => e.message).join("; ")}`);
    try {
      return evals.start(doc, { cases: b.cases, grader, mock: !!b.mock, concurrency: b.concurrency, judge: b.judge, on_model: b.on_model || undefined, repeats: b.repeats, model_map: b.model_map });
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
  r.on("GET", "/api/evals", (req) =>
    ({
      evals: store.listEvals(req.query.get("system") ?? undefined).map(({ cases, ...rest }) => ({
        ...rest,
        total: cases.length,
        set: caseSetId(cases),
        questions: new Set(cases.map((c) => c.input)).size,
        first_question: cases[0]?.input.slice(0, 120) ?? "",
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
