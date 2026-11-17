// Runs: start, list, replay, follow live (SSE), answer people's requests, stop.
import { validate } from "@/model/validate";
import type { RunEvent } from "@/run/events";
import type { Router } from "../http";
import type { RunManager } from "../runtime/runs";
import { HttpError, type Store } from "../store/files";
import { checkDoc } from "./systems";

export function runRoutes(r: Router, store: Store, runs: RunManager) {
  r.on("POST", "/api/runs", async (req) => {
    const body = (await req.body()) as { system_id?: string; doc?: unknown; input?: string; mock?: boolean; force?: boolean; vars?: Record<string, unknown>; save?: boolean };
    const doc = body.doc ? checkDoc(body.doc) : body.system_id ? store.getSystem(body.system_id) : null;
    if (!doc) throw new HttpError(400, "Give a system_id or a doc");
    // the browser sends the system as it is and it is stored; a script can say save: false (the run keeps its own copy either way)
    if (body.doc && body.save !== false) store.putSystem(doc);
    const errors = validate(doc).filter((i) => i.severity === "error");
    if (errors.length && !body.force) throw new HttpError(422, `The system has ${errors.length} error${errors.length > 1 ? "s" : ""}: ${errors.slice(0, 3).map((e) => e.message).join("; ")}`);
    return runs.start(doc, { input: String(body.input ?? ""), mock: !!body.mock, vars: body.vars });
  });

  r.on("GET", "/api/runs", (req) => ({ runs: store.listRuns(req.query.get("system") ?? undefined).slice(0, Number(req.query.get("limit") ?? 100)) }));

  r.on("GET", "/api/runs/:id", (req) => {
    const rec = runs.get(req.params.id);
    if (!rec) throw new HttpError(404, "No such run");
    return { run: rec, events: store.events(req.params.id), system: store.getRunSystem(req.params.id), active: runs.isActive(req.params.id) };
  });

  // Server-sent events: everything so far, then live events until the run ends.
  r.on("GET", "/api/runs/:id/events", (req, res) => {
    const id = req.params.id;
    if (!runs.get(id)) throw new HttpError(404, "No such run");
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    const write = (e: RunEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    // replay and subscribe in the same tick: no event can fall between them
    for (const e of store.events(id)) write(e);
    if (!runs.isActive(id)) {
      res.write("event: end\ndata: {}\n\n");
      res.end();
      return;
    }
    const unsubscribe = runs.subscribe(id, (e) => {
      if (e.type === "system_finished" && e.reason === "__end__") {
        res.write("event: end\ndata: {}\n\n");
        res.end();
        return;
      }
      write(e);
    });
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  r.on("POST", "/api/runs/:id/answer", async (req) => {
    const b = (await req.body()) as { request: string; approved?: boolean; text?: string };
    runs.answer(req.params.id, String(b.request), { approved: b.approved, text: b.text });
    return { ok: true };
  });

  r.on("POST", "/api/runs/:id/stop", (req) => {
    runs.stop(req.params.id);
    return { ok: true };
  });

  r.on("DELETE", "/api/runs/:id", (req) => {
    if (runs.isActive(req.params.id)) throw new HttpError(409, "Stop the run first");
    store.deleteRun(req.params.id);
    return { ok: true };
  });
}
