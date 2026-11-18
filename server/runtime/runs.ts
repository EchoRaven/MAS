// Active runs: event persistence and fan-out to subscribers, budgets, people's
// answers, stopping.
import crypto from "node:crypto";
import type { SystemDoc } from "@/model/types";
import { migrateDoc } from "@/model/migrate";
import { modelUses } from "@/model/modelUse";
import { conditionHolds, policiesAt } from "@/model/policies";
import type { HumanRequest, RunEvent, RunEventBody, RunRecord } from "@/run/events";
import type { Config } from "../config";
import { HttpError, type Store } from "../store/files";
import type { Secrets } from "../store/secrets";
import { BudgetError, StopError, type HumanAnswer, type RunCtx } from "./context";
import { Engine } from "./engine";
import { testExpr } from "./functions/sandbox";
import { expose, revokeRun } from "./mcpProxy";
import { Models } from "./models";

type Listener = (e: RunEvent) => void;

interface Active {
  rec: RunRecord;
  ctrl: AbortController;
  listeners: Set<Listener>;
  answers: Map<string, (a: HumanAnswer) => void>;
  stopReason?: string;
}

export interface StartOptions {
  input: string;
  /** dry run: every model is the built-in test model */
  mock?: boolean;
  vars?: Record<string, unknown>;
}

export class RunManager {
  private active = new Map<string, Active>();
  constructor(
    private store: Store,
    private secrets: Secrets,
    private config: Config,
  ) {}

  /** Start a run in the background; returns its record at once. */
  start(raw: SystemDoc, opts: StartOptions): RunRecord {
    const doc = migrateDoc(raw);
    const id = `run_${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}_${crypto.randomBytes(3).toString("hex")}`;
    const rec: RunRecord = { id, system_id: doc.id, system_name: doc.name, input: opts.input, status: "running", started_at: new Date().toISOString(), usd: 0, tokens: 0, events: 0, pending: [] };
    const act: Active = { rec, ctrl: new AbortController(), listeners: new Set(), answers: new Map() };
    this.active.set(id, act);
    this.store.putRun(rec, doc);
    void this.execute(act, doc, opts);
    return rec;
  }

  private async execute(act: Active, doc: SystemDoc, opts: StartOptions) {
    const { rec, ctrl } = act;
    const t0 = Date.now();
    const perNode = new Map<string, number>();
    const noticed = new Set<string>(); // notify policies already reported in this run
    let activations = 0;
    // secret values never reach the run's log: a tool or MCP server that echoes its environment, or an error
    // that quotes a key, would otherwise store it where the Runs page shows it and evaluations export it
    const hidden = this.secrets.valuesToHide(doc.models.map((m) => m.api.key_env).filter((n): n is string => !!n));
    const scrub = (v: unknown): unknown =>
      typeof v === "string"
        ? hidden.reduce((s, [name, value]) => (s.includes(value) ? s.split(value).join(`[secret ${name}]`) : s), v)
        : Array.isArray(v)
          ? v.map(scrub)
          : v && typeof v === "object"
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]))
            : v;
    const emit = (body: RunEventBody) => {
      const e = { ...(hidden.length ? (scrub(body) as RunEventBody) : body), t: Math.round((Date.now() - t0) / 100) / 10 } as RunEvent;
      rec.events++;
      this.store.appendEvent(rec.id, e);
      for (const l of act.listeners) l(e);
    };
    const stop = (reason: string) => {
      if (!ctrl.signal.aborted) {
        act.stopReason = reason;
        ctrl.abort(new StopError(reason));
      }
    };
    const rc: RunCtx = {
      runId: rec.id,
      doc,
      byId: new Map(doc.nodes.map((n) => [n.id, n])),
      models: new Models(doc.models, this.secrets, !!opts.mock),
      store: this.store,
      secrets: this.secrets,
      config: this.config,
      signal: ctrl.signal,
      stop,
      vars: { ...(opts.vars ?? {}) },
      emit,
      usage: (node, u, estimated = false) => {
        rec.usd += u.usd;
        rec.tokens += u.tokens_in + u.tokens_out;
        perNode.set(node, (perNode.get(node) ?? 0) + u.usd);
        emit({ type: "usage", node, tokens_in: u.tokens_in, tokens_out: u.tokens_out, usd: u.usd, estimated, model: u.model });
        if (doc.budget.usd != null && rec.usd > doc.budget.usd) {
          stop("Over budget");
          throw new BudgetError("Over budget");
        }
        // usage policies: notify once, or end the run
        for (const p of policiesAt(doc, "usage")) {
          const scope = { usd: rec.usd, tokens: rec.tokens, node, node_usd: perNode.get(node) ?? 0, model: u.model };
          if (!conditionHolds(p, (x) => testExpr(x, scope).ok)) continue;
          if (p.action === "terminate") {
            emit({ type: "log", level: "warn", text: `Policy ${p.id} (${p.condition || "always"}) ended the run` });
            stop(`Policy ${p.id}`);
            throw new BudgetError(`Policy ${p.id}`);
          }
          if (p.action === "notify" && !noticed.has(p.id)) {
            noticed.add(p.id);
            emit({ type: "log", level: "warn", text: `Policy ${p.id}: ${p.condition || "always"} (usage so far ${rec.usd.toFixed(4)} USD, ${rec.tokens} tokens)` });
          }
        }
        const agent = rc.byId.get(node)?.data;
        if (agent?.kind === "agent" && agent.budget_usd != null && (perNode.get(node) ?? 0) > agent.budget_usd) throw new BudgetError(`${agent.name} is over its budget`);
      },
      tick: () => {
        if (doc.budget.max_rounds != null && ++activations > doc.budget.max_rounds) {
          stop("Round limit reached");
          throw new BudgetError("Round limit reached");
        }
      },
      ask: (req) => {
        const request: HumanRequest = { ...req, id: crypto.randomBytes(4).toString("hex") };
        rec.pending = [...(rec.pending ?? []), request];
        rec.status = "waiting";
        this.store.putRun(rec);
        emit({ type: "human_request", request });
        return new Promise<HumanAnswer>((resolve, reject) => {
          const onAbort = () => reject(new StopError(act.stopReason ?? "Stopped"));
          ctrl.signal.addEventListener("abort", onAbort, { once: true });
          act.answers.set(request.id, (a) => {
            ctrl.signal.removeEventListener("abort", onAbort);
            resolve(a);
          });
        });
      },
    };
    const wall = doc.budget.wallclock_min ? setTimeout(() => stop("Time limit reached"), doc.budget.wallclock_min * 60_000) : undefined;
    const baseUrl = `http://${this.config.host === "0.0.0.0" ? "127.0.0.1" : this.config.host}:${this.config.port}`;
    // a pause for the request limit is said in the run (once in a while, not for every waiting call)
    let lastWaitNote = 0;
    rc.models.onWait = (m, ms, rpm) => {
      if (Date.now() - lastWaitNote < 30_000) return;
      lastWaitNote = Date.now();
      emit({ type: "log", level: "info", text: `Waiting ${Math.ceil(ms / 1000)}s: at most ${rpm} requests a minute to ${m.provider} (MAS_RPM), so the provider never sees a burst` });
    };
    const engine = new Engine(rc, { expose: (node, tools) => expose(rec.id, node, tools, baseUrl) });
    emit({ type: "system_started", input: opts.input });
    // a model that has no key fails only when it is first called, deep in the run: say so now, with who needs it
    if (!opts.mock) {
      const uses = modelUses(doc);
      for (const id of [...new Set(uses.map((u) => u.model))]) {
        const spec = doc.models.find((m) => m.id === id);
        const why = spec && rc.models.missingKey(spec);
        if (why) emit({ type: "log", level: "warn", text: `Model "${id}" ${why} (Settings → API keys); it is used by ${[...new Set(uses.filter((u) => u.model === id).map((u) => u.where))].join(", ")}` });
      }
    }
    let reason: string;
    try {
      await Promise.race([
        engine.run(opts.input),
        new Promise((_, reject) => ctrl.signal.addEventListener("abort", () => reject(ctrl.signal.reason), { once: true })),
      ]);
      reason = engine.errors ? `Finished with ${engine.errors} error${engine.errors > 1 ? "s" : ""}` : engine.outputs ? "All idle" : "All idle (no output)";
      rec.status = engine.errors && !engine.outputs ? "failed" : "finished";
    } catch (e) {
      reason = act.stopReason ?? (e as Error).message;
      rec.status = act.stopReason === "Stopped" ? "stopped" : e instanceof StopError || e instanceof BudgetError ? "finished" : "failed";
      if (!(e instanceof StopError) && !(e instanceof BudgetError) && !act.stopReason) emit({ type: "log", level: "error", text: (e as Error).message });
    } finally {
      clearTimeout(wall);
      await engine.hub.closeAll();
      revokeRun(rec.id);
    }
    emit({ type: "system_finished", reason });
    rec.reason = reason;
    rec.finished_at = new Date().toISOString();
    rec.pending = [];
    this.store.putRun(rec);
    for (const l of act.listeners) l({ t: -1, type: "system_finished", reason: "__end__" });
    this.active.delete(rec.id);
  }

  get(id: string): RunRecord | null {
    return this.active.get(id)?.rec ?? this.store.getRun(id);
  }

  isActive(id: string) {
    return this.active.has(id);
  }

  subscribe(id: string, l: Listener): () => void {
    const a = this.active.get(id);
    if (!a) return () => undefined;
    a.listeners.add(l);
    return () => a.listeners.delete(l);
  }

  answer(id: string, requestId: string, answer: HumanAnswer) {
    const a = this.active.get(id);
    if (!a) throw new HttpError(404, "Run is not active");
    const resolve = a.answers.get(requestId);
    if (!resolve) throw new HttpError(404, "No such pending request");
    a.answers.delete(requestId);
    a.rec.pending = (a.rec.pending ?? []).filter((r) => r.id !== requestId);
    if (!a.rec.pending.length) a.rec.status = "running";
    this.store.appendEvent(id, { t: 0, type: "human_response", id: requestId, ...answer });
    for (const l of a.listeners) l({ t: 0, type: "human_response", id: requestId, ...answer });
    this.store.putRun(a.rec);
    resolve(answer);
  }

  stop(id: string) {
    const a = this.active.get(id);
    if (!a) throw new HttpError(404, "Run is not active");
    a.stopReason = "Stopped";
    a.ctrl.abort(new StopError("Stopped"));
  }

  /** Runs that were active when the server stopped are marked as interrupted. */
  recover() {
    for (const r of this.store.listRuns()) {
      if (r.status === "running" || r.status === "waiting") {
        r.status = "stopped";
        r.reason = "Server restarted during the run";
        r.pending = [];
        this.store.putRun(r);
      }
    }
  }
}
