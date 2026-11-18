// The scheduler: runs a system graph for real. Values travel along edges
// (filter -> transform -> gate -> coercion to the target port), components
// run when input arrives (agents coalesce or queue per their concurrency),
// call edges are synchronous tools, groups forward through their ports and
// repeat in rounds, rooms wake members by policy, and people answer through
// requests the run waits on.
import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentData, FunctionNodeData, GroupData, HumanData, ModelNodeData, SysEdge, SysNode } from "@/model/types";
import { ENTRY_REASON, entryPoints } from "@/model/entry";
import { interfaceOf } from "@/model/ports";
import { schemaById } from "./agent/jsonschema";
import { AgentState, runAgentTurn, type TurnServices } from "./agent/turn";
import { BudgetError, nameOf, StopError, type RunCtx } from "./context";
import { llmCall, runFn } from "./functions";
import { evalExpr, testExpr } from "./functions/sandbox";
import { conditionHolds, policiesAt } from "@/model/policies";
import { renderTemplate } from "./functions/template";
import { textOf, userText } from "./models";
import { Hub } from "./resources/hub";
import type { RtTool } from "./resources/types";
import { asText, clip, coerce, exprValue, syncMsg, type Msg } from "./values";
import { parseReplicas, replicaCount, roundLimit } from "@/model/replicas";
export { replicaCount };

type Item = { value: unknown; via?: SysEdge };

export class Engine implements TurnServices {
  readonly hub: Hub;
  readonly state = new AgentState();
  private outstanding = 0;
  private idleResolve?: () => void;
  private slots: number;
  private slotWaiters: (() => void)[] = [];
  private queues = new Map<string, Item[]>();
  private draining = new Set<string>();
  private locks = new Map<string, Promise<unknown>>();
  /** the running turn of each agent set to interrupt, so a new message can cut it short */
  private turns = new Map<string, AbortController>();
  private chain = new AsyncLocalStorage<string[]>();
  private joinBuf = new Map<string, Record<string, unknown>>();
  /** each running group's round, the input it started with, and with iterate.over the items it tries one by one */
  private groups = new Map<string, { round: number; input: unknown; items?: unknown[] }>();
  private groupWaiters = new Map<string, ((v: unknown) => void)[]>();
  private starters = new Set<string>();
  errors = 0;
  outputs = 0;

  constructor(
    readonly rc: RunCtx,
    private opts: { expose?: (node: string, tools: RtTool[]) => { url: string; token: string; tools: string[] } } = {},
  ) {
    this.hub = new Hub(rc);
    this.slots = Math.max(1, rc.config.parallelism);
  }

  // bookkeeping ----------------------------------------------------------------
  private track(p: Promise<unknown>) {
    this.outstanding++;
    p.catch((e) => this.onError(e)).finally(() => {
      if (--this.outstanding === 0) this.idleResolve?.();
    });
  }
  private onError(e: unknown, node?: string) {
    if (e instanceof StopError || this.rc.signal.aborted) return;
    // an agent over its own budget stops while the run goes on: say so, or it just seems to vanish
    if (e instanceof BudgetError) {
      this.rc.emit({ type: "log", node, level: "warn", text: `${(e as Error).message}: it stops here, the rest of the run goes on` });
      if (node) this.rc.emit({ type: "status", node, status: "blocked" });
      return;
    }
    this.errors++;
    this.rc.emit({ type: "log", node, level: "error", text: (e as Error).message ?? String(e) });
    if (node) this.rc.emit({ type: "status", node, status: "blocked" });
  }
  private async slot() {
    if (this.slots > 0) {
      this.slots--;
      return;
    }
    await new Promise<void>((r) => this.slotWaiters.push(r));
  }
  private release() {
    const next = this.slotWaiters.shift();
    if (next) next();
    else this.slots++;
  }
  private async lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    let done!: () => void;
    const mine = new Promise<void>((r) => (done = r));
    this.locks.set(id, prev.then(() => mine));
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      done();
    }
  }
  private node(id: string): SysNode {
    const n = this.rc.byId.get(id);
    if (!n) throw new Error(`No component ${id}`);
    return n;
  }
  private status(node: string, status: "working" | "waiting" | "done" | "idle" | "blocked") {
    this.rc.emit({ type: "status", node, status });
  }

  // start / finish ------------------------------------------------------------
  /** Deliver the run input to the entry points and wait until nothing is left to do. */
  async run(input: string): Promise<void> {
    const rc = this.rc;
    const idle = new Promise<void>((r) => (this.idleResolve = r));
    const entryValue: Msg = { role: "user", text: input, content: input, from: "input" };
    rc.vars.input ??= input;
    rc.vars.query ??= input;
    this.outstanding++; // hold the run open while entry points are wired
    try {
      const entries = entryPoints(rc.doc);
      if (!entries.length) throw new Error("Nothing to run: add an agent, model, function or group");
      for (const entry of entries) {
        const n = this.node(entry.node);
        rc.emit({ type: "log", level: "info", node: n.id, text: `${ENTRY_REASON[entry.why]}${entry.port ? ` → ${entry.port}` : ""}` });
        if (n.data.kind === "human") {
          // a person at the edge passes the input on, and takes the run's result back
          this.starters.add(n.id);
          const outs = this.outEdges(n.id);
          const rooms = rc.doc.edges.filter((e) => e.kind === "access" && e.source === n.id && this.isRoom(e.target));
          if (!outs.length && !rooms.length) rc.emit({ type: "log", level: "warn", node: n.id, text: `${nameOf(rc, n.id)} starts the run but has nothing to send to` });
          for (const e of outs) this.track(this.deliver(e, { ...entryValue, from: n.id }, n.id));
          for (const e of rooms) this.track(this.post(e.target, n.id, input));
        } else if (n.data.kind === "group") {
          const p = entry.port ?? interfaceOf(n.data).inputs[0]?.id;
          if (p) this.track(this.groupEnter(n.id, p, entryValue));
        } else this.schedule(n.id, n.data.kind === "function" && entry.port ? { [entry.port]: entryValue } : entryValue, undefined, n.data.kind === "function");
      }
    } finally {
      if (--this.outstanding === 0) this.idleResolve?.();
    }
    await idle;
  }

  // edges ---------------------------------------------------------------------
  private isRoom(id: string) {
    const d = this.rc.byId.get(id)?.data;
    return d?.kind === "env" && d.env_kind === "room";
  }
  private outEdges(id: string, port?: string) {
    const n = this.rc.byId.get(id);
    const outs = n ? interfaceOf(n.data).outputs.map((p) => p.id) : [];
    const isAgent = n?.data.kind === "agent";
    return this.rc.doc.edges.filter((e) => e.source === id && e.kind !== "access" && !(isAgent && e.kind === "call") && outs.includes(e.source_port) && (!port || e.source_port === port));
  }
  private targetPortType(e: SysEdge) {
    const t = this.rc.byId.get(e.target);
    if (!t) return undefined;
    const i = interfaceOf(t.data);
    return [...i.inputs, ...i.outputs].find((p) => p.id === e.target_port)?.type;
  }

  /** filter -> transform -> gate -> coercion, then arrival. */
  async deliver(e: SysEdge, value: unknown, from: string): Promise<void> {
    const rc = this.rc;
    // a run that is stopping (finish, a policy, a limit) sends nothing more
    if (rc.signal.aborted) return;
    let v = value;
    if (e.filter) {
      const scope = { ...(v && typeof v === "object" && !Array.isArray(v) ? (v as object) : {}), input: exprValue(v), value: exprValue(v), text: asText(v) };
      const r = testExpr(e.filter, scope);
      rc.emit({ type: "transform", at: from, edge: e.id, label: "filter", detail: r.error ? `error: ${r.error}` : r.ok ? `${e.filter} — passed` : `${e.filter} — dropped` });
      if (!r.ok) return;
    }
    if (e.transform) {
      const out = syncMsg(v, await runFn(e.transform, v, rc, { node: from, edge: e.id }));
      rc.emit({ type: "transform", at: from, edge: e.id, label: `${e.transform.lang} transform`, detail: clip(asText(out), 200) });
      if (out == null) return;
      v = out;
    }
    if (e.gate && !(await this.gate(e, v, from))) return;
    v = coerce(v, this.targetPortType(e), from);
    rc.emit({ type: "message", from, to: e.target, edge: e.id, port: e.target_port, kind: e.kind, text: clip(asText(v), 6000) });
    await this.arrive(e, v, from);
  }

  private async gate(e: SysEdge, v: unknown, from: string): Promise<boolean> {
    const rc = this.rc;
    const g = e.gate!;
    const cond = g.condition.trim();
    let passed = true;
    let reason = "";
    if (/^expr:/i.test(cond)) {
      const r = testExpr(cond.slice(5).trim(), { input: exprValue(v), text: asText(v), ...(v && typeof v === "object" ? (v as object) : {}) });
      passed = r.ok;
      reason = r.error ?? cond;
    } else if (/^judge:/i.test(cond)) {
      const judge = cond.slice(6).trim();
      const verdict = await this.call({ ...e, id: `${e.id}:judge`, source: from, target: judge, kind: "call", transform: null, gate: null }, `Does this pass "${g.name}"? Reply PASS or FAIL with a reason.\n\n${asText(v)}`);
      passed = /\bPASS\b/i.test(verdict) && !/\bFAIL\b/i.test(verdict);
      reason = verdict.slice(0, 200);
    } else if (/^check:/i.test(cond)) {
      const sandbox = rc.doc.nodes.find((n) => n.data.kind === "env" && n.data.env_kind === "sandbox");
      if (!sandbox) throw new Error(`gate ${g.name}: a check needs a sandbox env`);
      const r = await (this.hub.get(sandbox.id) as unknown as { sh(c: string): Promise<string> }).sh(cond.slice(6).trim());
      passed = r.startsWith("exit 0");
      reason = r.split("\n").slice(-3).join(" ").slice(0, 200);
    } else if (cond) {
      const verdict = await llmCall(rc, from, `Condition: ${cond}\n\nDoes the following meet the condition? Reply PASS or FAIL with a one-line reason.\n\n${asText(v)}`);
      passed = /\bPASS\b/i.test(verdict) && !/\bFAIL\b/i.test(verdict);
      reason = verdict.slice(0, 200);
    }
    if (!passed && g.on_fail === "require_approval") {
      const approver = rc.doc.nodes.find((n) => n.data.kind === "human" && (n.data as HumanData).approves);
      const a = await rc.ask({ node: approver?.id ?? "", from, kind: "approval", text: `Gate "${g.name}" failed (${reason}). Let it through anyway?\n\n${clip(asText(v), 1500)}` });
      passed = !!a.approved;
      reason = passed ? "approved by a person" : `rejected: ${a.text ?? ""}`;
    }
    rc.emit({ type: "gate", edge: e.id, gate: g.name, passed, reason });
    // the failure count is per draft: once one passes, the next starts from zero
    if (passed) delete rc.vars[`gate:${e.id}`];
    if (!passed && g.on_fail === "route_back") {
      const back = rc.doc.edges.find((x) => x.source === e.target && x.target === from && x.kind !== "access");
      const tries = (rc.vars[`gate:${e.id}`] as number | undefined) ?? 0;
      rc.vars[`gate:${e.id}`] = tries + 1;
      if (tries + 1 >= Math.max(1, g.escalate_after || 3)) {
        const a = await rc.ask({ node: "", from, kind: "approval", text: `Gate "${g.name}" failed ${tries + 1} times (${reason}). Let it through?` });
        if (a.approved) return true;
      } else {
        const text = `Your output did not pass "${g.name}": ${reason}\nPlease revise.`;
        // shown in the run like any message, so the revision that follows has a visible reason
        rc.emit({ type: "message", from: e.target, to: from, edge: back?.id, kind: "message", text });
        this.schedule(from, { role: "user", text, from: e.target } satisfies Msg, back);
      }
    }
    if (!passed) this.status(from, "blocked");
    return passed;
  }

  private async arrive(e: SysEdge, v: unknown, from: string): Promise<void> {
    const t = this.node(e.target);
    switch (t.data.kind) {
      case "group":
        if (interfaceOf(t.data).inputs.some((p) => p.id === e.target_port)) return this.groupEnter(t.id, e.target_port, v);
        return this.groupExit(t.id, e.target_port, v);
      case "human":
        return this.humanReceive(t as SysNode<HumanData>, v, from, e);
      case "function": {
        const f = t.data as FunctionNodeData;
        if (f.join === "all") {
          const buf = this.joinBuf.get(t.id) ?? {};
          buf[e.target_port] = v;
          const need = f.interface.inputs.filter((p) => p.required).map((p) => p.id);
          if (need.some((p) => !(p in buf))) {
            this.joinBuf.set(t.id, buf);
            return;
          }
          this.joinBuf.delete(t.id);
          return this.schedule(t.id, buf, e, true);
        }
        return this.schedule(t.id, { [e.target_port]: v }, e, true);
      }
      default:
        return this.schedule(t.id, v, e);
    }
  }

  // activations -----------------------------------------------------------------
  /** Queue input for a component; agents coalesce or queue per their concurrency. */
  schedule(id: string, value: unknown, via?: SysEdge, keyed = false) {
    const n = this.node(id);
    const item: Item = { value: keyed ? value : value, via };
    const mode = n.data.kind === "agent" ? (n.data as AgentData).concurrency : "queue";
    if (mode === "parallel") {
      // a new instance per message: no waiting for the component's earlier turns
      this.track(this.activate(n, item, false));
      return;
    }
    const q = this.queues.get(id) ?? [];
    q.push(item);
    this.queues.set(id, q);
    // interrupt: the turn under way stops, and the next one takes its message and this one together
    if (mode === "interrupt") this.turns.get(id)?.abort(new Error("interrupted by a new message"));
    if (!this.draining.has(id)) this.track(this.drain(n, mode === "coalesce" || mode === "interrupt"));
  }

  private async drain(n: SysNode, coalesce: boolean) {
    this.draining.add(n.id);
    try {
      for (let q = this.queues.get(n.id); q?.length; q = this.queues.get(n.id)) {
        const items = coalesce ? q.splice(0) : q.splice(0, 1);
        const item = items.length === 1 ? items[0] : { value: { role: "user", text: items.map((i) => `From ${nameOf(this.rc, String((i.value as Msg)?.from ?? i.via?.source ?? ""))}:\n${asText(i.value)}`).join("\n\n---\n\n"), from: "several" } as Msg, via: items[items.length - 1].via };
        await this.activate(n, item);
      }
    } finally {
      this.draining.delete(n.id);
    }
  }

  private async activate(n: SysNode, item: Item, oneAtATime = true) {
    await this.slot();
    try {
      const turn = () => this.chain.run([n.id], () => this.runComponent(n, item, false));
      await (oneAtATime ? this.lock(n.id, turn) : turn());
    } catch (e) {
      this.onError(e, n.id);
    } finally {
      this.release();
    }
  }

  /** Run one component on one input. direct: a call edge is waiting for the reply, so outputs go back, not on. */
  private async runComponent(n: SysNode, item: Item, direct: boolean): Promise<string> {
    const rc = this.rc;
    rc.tick();
    this.status(n.id, "working");
    let reply = "";
    switch (n.data.kind) {
      case "agent": {
        const interruptible = !direct && (n.data as AgentData).concurrency === "interrupt";
        const ctrl = interruptible ? new AbortController() : null;
        // an interruptible turn sees a signal that also fires when a new message arrives
        const svc: Engine = ctrl ? (Object.create(this, { rc: { value: { ...this.rc, signal: AbortSignal.any([this.rc.signal, ctrl.signal]) } } }) as Engine) : this;
        if (ctrl) this.turns.set(n.id, ctrl);
        let r: Awaited<ReturnType<typeof runAgentTurn>>;
        try {
          r = await runAgentTurn(svc, this.state, n as SysNode<AgentData>, item.value, item.via);
        } catch (e) {
          if (ctrl?.signal.aborted && !rc.signal.aborted) {
            // put its message back first in line: the next turn reads it with the new one
            this.queues.set(n.id, [item, ...(this.queues.get(n.id) ?? [])]);
            rc.emit({ type: "log", node: n.id, level: "info", text: `${nameOf(rc, n.id)} was interrupted by a new message and starts over with both` });
            this.status(n.id, "idle");
            return "";
          }
          throw e;
        } finally {
          if (ctrl && this.turns.get(n.id) === ctrl) this.turns.delete(n.id);
        }
        reply = r.text;
        if (!direct && !r.dropped) await this.afterAgent(n as SysNode<AgentData>, r, item.via);
        break;
      }
      case "model": {
        const m = n.data as ModelNodeData;
        const prompt = await renderTemplate(m.prompt || "{{input}}", { input: item.value, vars: rc.vars });
        const outSpec = m.interface.outputs[0];
        // with replicas the output port carries the list of replies: it says nothing about what each reply looks like
        const ensemble = parseReplicas(m.replicas).kind !== "one";
        const asJson = outSpec?.type === "json" && !ensemble;
        const schema = asJson ? schemaById(rc.doc, outSpec.schema) : null;
        const system = [m.system_prompt, asJson ? `Reply with only a JSON value${schema ? ` matching this JSON Schema:\n${JSON.stringify(schema)}` : "."}` : ""].filter(Boolean).join("\n\n");
        const call = async () => {
          const { res, usage } = await rc.models.chat(m.model, { system: system || undefined, messages: [userText(prompt)], temperature: m.temperature, max_tokens: m.max_tokens, signal: rc.signal });
          rc.usage(n.id, usage);
          return textOf(res.content);
        };
        const k = ensemble ? (replicaCount(m.replicas, rc.vars) ?? 1) : null;
        if (k === null) {
          reply = await call();
          if (!direct) await this.emitOutputs(n.id, { [m.interface.outputs[0]?.id ?? "out"]: reply });
          break;
        }
        // an ensemble: k samples at once (each one still goes through the server's rate limit), then the list of them
        const replies = await Promise.all(Array.from({ length: k }, call));
        rc.emit({ type: "transform", at: n.id, label: `${k} samples`, detail: replies.map((r) => clip(r.split("\n").filter(Boolean).pop() ?? "", 40)).join(" · ") });
        reply = JSON.stringify(replies);
        if (!direct) await this.emitOutputs(n.id, { [m.interface.outputs[0]?.id ?? "out"]: replies });
        break;
      }
      case "function": {
        const f = n.data as FunctionNodeData;
        const ports = f.interface.inputs;
        const raw = item.value as Record<string, unknown>;
        // one input port: the value itself; several: { port: value }
        const input = ports.length <= 1 && raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 1 && ports[0]?.id in raw ? raw[ports[0].id] : raw;
        const out = syncMsg(input, await runFn(f.fn, input, rc, { node: n.id }));
        const outs = f.interface.outputs.map((p) => p.id);
        let routed: Record<string, unknown> = {};
        if (out == null) routed = {};
        else if (outs.length > 1 && typeof out === "object" && !Array.isArray(out) && Object.keys(out).length > 0 && Object.keys(out).every((k) => outs.includes(k))) routed = out as Record<string, unknown>;
        else if (outs.length > 1 && typeof out === "string" && outs.includes(out)) routed = { [out]: input };
        else routed = Object.fromEntries(outs.slice(0, outs.length > 1 ? outs.length : 1).map((p) => [p, out]));
        rc.emit({ type: "transform", at: n.id, label: `${f.fn.lang} function`, detail: out == null ? "returned null — dropped" : `→ ${Object.keys(routed).join(", ") || "nothing"}: ${clip(asText(out), 160)}` });
        reply = asText(out);
        if (!direct) await this.emitOutputs(n.id, routed);
        break;
      }
      default:
        break;
    }
    this.status(n.id, "done");
    return reply;
  }

  private async afterAgent(n: SysNode<AgentData>, r: { output: unknown; text: string; port?: string; transfers: string[]; conversation?: import("./models").ChatMessage[] }, via?: SysEdge) {
    const ports = r.port ? [r.port] : n.data.interface.outputs.map((p) => p.id);
    if (this.rc.signal.aborted) return;
    if (!(await this.outputPolicies(n.id, ports[0] ?? "out", r.output))) return;
    const edges = ports.flatMap((p) => this.outEdges(n.id, p));
    const handoffs = edges.filter((e) => e.kind === "handoff");
    const chosen = handoffs.length > 1 ? handoffs.filter((e) => r.transfers.includes(e.id)) : handoffs;
    const send = [...edges.filter((e) => e.kind !== "handoff"), ...(chosen.length || handoffs.length < 2 ? chosen : handoffs.slice(0, 1))];
    for (const e of send) {
      let v: unknown = r.output;
      if (e.kind === "handoff" && e.carry === "full") v = { role: "user", text: asText(r.output), from: n.id, meta: { history: r.conversation ?? this.state.history.get(n.id) ?? [] } } satisfies Msg;
      this.track(this.deliver(e, v, n.id));
    }
    // rooms: post when the turn came from the room, or when there is nowhere else to send
    const roomEdges = this.rc.doc.edges.filter((e) => e.kind === "access" && e.source === n.id && this.isRoom(e.target) && e.binding?.write?.when !== "never");
    const fromRoom = via && via.kind === "access" && this.isRoom(via.target) ? via.target : null;
    for (const e of roomEdges) if (e.target === fromRoom || !send.length) this.track(this.post(e.target, n.id, asText(r.output)));
    if (!send.length && !roomEdges.length) {
      this.outputs++;
      this.rc.emit({ type: "output", node: n.id, port: ports[0] ?? "out", text: clip(asText(r.output), 20_000) });
    }
  }

  private async emitOutputs(id: string, outputs: Record<string, unknown>) {
    for (const [port, v] of Object.entries(outputs)) {
      if (!(await this.outputPolicies(id, port, v))) continue;
      const edges = this.outEdges(id, port);
      if (!edges.length) {
        this.outputs++;
        this.rc.emit({ type: "output", node: id, port, text: clip(asText(v), 20_000) });
      }
      for (const e of edges) this.track(this.deliver(e, v, id));
    }
  }

  /**
   * Output policies on a value a component sends on: notify, block it, ask a
   * person first, or end the run with it as the result. False = do not send it.
   */
  private async outputPolicies(id: string, port: string, v: unknown): Promise<boolean> {
    const rc = this.rc;
    for (const p of policiesAt(rc.doc, "output", id, port)) {
      const scope = { output: exprValue(v), text: asText(v), node: id, port, ...(v && typeof v === "object" && !Array.isArray(v) ? (v as object) : {}) };
      if (!conditionHolds(p, (x) => testExpr(x, scope).ok)) continue;
      const what = `Policy ${p.id} (${p.condition || "always"}) on ${nameOf(rc, id)}.${port}`;
      if (p.action === "notify") rc.emit({ type: "log", node: id, level: "warn", text: what });
      else if (p.action === "block") {
        rc.emit({ type: "log", node: id, level: "warn", text: `${what}: blocked` });
        return false;
      } else if (p.action === "require_approval") {
        const approver = rc.doc.nodes.find((n) => n.data.kind === "human" && (n.data as HumanData).approves);
        const a = await rc.ask({ node: approver?.id ?? "", from: id, kind: "approval", text: `${what}. Let this through?\n\n${clip(asText(v), 1500)}` });
        if (!a.approved) {
          rc.emit({ type: "log", node: id, level: "warn", text: `${what}: held back by a person` });
          return false;
        }
      } else if (p.action === "terminate") {
        // the value that met the condition is the run's answer
        this.outputs++;
        rc.emit({ type: "output", node: id, port, text: clip(asText(v), 20_000) });
        rc.emit({ type: "log", node: id, level: "info", text: `${what}: ended the run` });
        rc.stop(`Policy ${p.id}`);
        return false;
      }
    }
    return true;
  }

  // call edges -------------------------------------------------------------------
  /** Synchronous request/response along a call edge (agents get these as tools). */
  async call(e: SysEdge, text: string): Promise<string> {
    const rc = this.rc;
    const stack = this.chain.getStore() ?? [];
    if (stack.includes(e.target)) throw new Error(`call cycle: ${[...stack, e.target].map((x) => nameOf(rc, x)).join(" → ")}`);
    let v: unknown = { role: "user", text, content: text, from: e.source } satisfies Msg;
    if (e.transform) v = syncMsg(v, await runFn(e.transform, v, rc, { node: e.source, edge: e.id }));
    v = coerce(v, this.targetPortType(e), e.source);
    rc.emit({ type: "message", from: e.source, to: e.target, edge: e.id, port: e.target_port, kind: "call", text: clip(asText(v), 6000) });
    this.status(e.source, "waiting");
    const t = this.node(e.target);
    let reply: string;
    try {
      if (t.data.kind === "group") {
        const p = new Promise<unknown>((resolve) => this.groupWaiters.set(t.id, [...(this.groupWaiters.get(t.id) ?? []), resolve]));
        this.track(this.groupEnter(t.id, e.target_port, v));
        reply = asText(await p);
      } else if (t.data.kind === "human") {
        const h = t.data as HumanData;
        const a = await rc.ask({ node: t.id, from: e.source, kind: h.approves ? "approval" : "input", text: asText(v) });
        reply = h.approves ? (a.approved ? `Approved.${a.text ? ` ${a.text}` : ""}` : `Rejected.${a.text ? ` ${a.text}` : ""}`) : (a.text ?? "");
      } else if (t.data.kind === "agent" || t.data.kind === "model" || t.data.kind === "function") {
        const item = { value: t.data.kind === "function" ? { [e.target_port]: v } : v, via: e };
        reply = await this.chain.run([...stack, t.id], () => (t.data.kind === "agent" && (t.data as AgentData).concurrency === "parallel" ? this.runComponent(t, item, true) : this.lock(t.id, () => this.runComponent(t, item, true))));
      } else throw new Error(`${nameOf(rc, t.id)} cannot be called`);
    } catch (err) {
      this.status(t.id, "blocked");
      throw err;
    } finally {
      this.status(e.source, "working");
    }
    rc.emit({ type: "message", from: e.target, to: e.source, edge: e.id, kind: "reply", text: clip(reply, 6000) });
    return reply;
  }

  async spawn(template: string, task: string, i: number): Promise<string> {
    const n = this.node(template) as SysNode<AgentData>;
    this.rc.emit({ type: "message", from: "spawn", to: template, kind: "call", text: `#${i}: ${clip(task, 500)}` });
    const r = await runAgentTurn(this, new AgentState(), n, { role: "user", text: task, content: task } satisfies Msg);
    this.rc.emit({ type: "message", from: template, to: "spawn", kind: "reply", text: `#${i}: ${clip(r.text, 2000)}` });
    return r.text;
  }

  /** An agent called finish: its answer is the run's result, and the run ends. */
  finish(node: string, answer: string) {
    const rc = this.rc;
    this.outputs++;
    rc.emit({ type: "output", node, port: "finish", text: clip(answer, 20_000) });
    rc.emit({ type: "log", node, level: "info", text: `${nameOf(rc, node)} called finish: the run ends` });
    rc.stop(`${nameOf(rc, node)} called finish`);
  }

  exposeTools(node: string, tools: RtTool[]) {
    return this.opts.expose?.(node, tools);
  }

  // groups --------------------------------------------------------------------------
  private async groupEnter(g: string, port: string, v: unknown) {
    if (!this.groups.has(g)) {
      const st: { round: number; input: unknown; items?: unknown[] } = { round: 1, input: v };
      const over = (this.node(g).data as GroupData).iterate?.over;
      if (over) {
        // try the items of a list one by one (MapCoder's plans, best first): round n receives item n
        st.items = this.itemsOf(g, over, v);
        v = st.items[0];
        this.rc.emit({ type: "transform", at: g, label: `round 1 of ≤${Math.min(st.items.length, roundLimit((this.node(g).data as GroupData).iterate!.max_rounds, this.rc.vars))}`, detail: `item 1 of ${st.items.length} (${over})` });
      }
      this.groups.set(g, st);
    }
    const inner = this.rc.doc.edges.filter((x) => x.source === g && x.source_port === port && x.kind !== "access");
    if (!inner.length) this.rc.emit({ type: "log", node: g, level: "warn", text: `input ${port} is not wired to anything inside ${nameOf(this.rc, g)}` });
    for (const x of inner) this.track(this.deliver(x, v, g));
  }

  /** The list iterate.over picks from a group's input; anything else is one item, said in the run. */
  private itemsOf(g: string, over: string, v: unknown): unknown[] {
    let list: unknown;
    try {
      list = evalExpr(over, { input: exprValue(v), vars: this.rc.vars });
    } catch (e) {
      this.rc.emit({ type: "log", node: g, level: "warn", text: `iterate.over ${over} failed (${(e as Error).message}): the whole input is the only item` });
      return [v];
    }
    if (Array.isArray(list) && list.length) return list;
    this.rc.emit({ type: "log", node: g, level: "warn", text: `iterate.over ${over} gave ${Array.isArray(list) ? "an empty list" : `no list (${typeof list})`}: the whole input is the only item` });
    return [v];
  }

  private async groupExit(g: string, port: string, v: unknown) {
    const rc = this.rc;
    const gd = this.node(g).data as GroupData;
    const st = this.groups.get(g) ?? { round: 1, input: undefined };
    const it = gd.iterate;
    if (it) {
      const until = it.until ? testExpr(it.until, { output: exprValue(v), text: asText(v), round: st.round, input: exprValue(st.input) }) : { ok: false as boolean, error: undefined as string | undefined };
      const limit = st.items ? Math.min(st.items.length, roundLimit(it.max_rounds, rc.vars)) : roundLimit(it.max_rounds, rc.vars);
      if (!until.ok && st.round < limit) {
        st.round++;
        this.groups.set(g, st);
        const why = until.error ? `until failed: ${until.error}` : it.until ? `until ${it.until} — not yet` : "next round";
        rc.emit({ type: "transform", at: g, label: `round ${st.round} of ≤${limit}`, detail: st.items ? `${why}; item ${st.round} of ${st.items.length}` : why });
        const feed = st.items ? st.items[st.round - 1] : it.feed === "input_and_output" ? ({ role: "user", text: `${asText(st.input)}\n\nAnswers from the previous round:\n${asText(v)}`, from: g } satisfies Msg) : v;
        for (const p of gd.interface.inputs) for (const x of rc.doc.edges.filter((y) => y.source === g && y.source_port === p.id && y.kind !== "access")) this.track(this.deliver(x, feed, g));
        return;
      }
      rc.emit({ type: "transform", at: g, label: "rounds done", detail: until.ok ? `${it.until} holds (round ${st.round})` : `${st.round} round${st.round > 1 ? "s" : ""}` });
    }
    this.groups.delete(g);
    const waiter = this.groupWaiters.get(g)?.shift();
    if (waiter) return waiter(v);
    await this.emitOutputs(g, { [port]: v });
  }

  // people and rooms ---------------------------------------------------------------
  private async humanReceive(h: SysNode<HumanData>, v: unknown, from: string, e: SysEdge) {
    const rc = this.rc;
    const outs = this.outEdges(h.id);
    if (this.starters.has(h.id) || !outs.length) {
      this.outputs++;
      rc.emit({ type: "output", node: h.id, port: e.target_port, text: clip(asText(v), 20_000) });
      this.status(h.id, "done");
      return;
    }
    this.status(h.id, "waiting");
    const a = await rc.ask({ node: h.id, from, kind: h.data.approves ? "approval" : "input", text: asText(v) });
    this.status(h.id, "done");
    if (h.data.approves && !a.approved) {
      const back = rc.doc.edges.find((x) => x.source === h.id && x.target === from && x.kind !== "access");
      if (back) this.track(this.deliver(back, { role: "user", text: `Rejected by ${h.data.name}: ${a.text ?? ""}`, from: h.id } satisfies Msg, h.id));
      return;
    }
    const value = h.data.approves ? (a.text ? { role: "user", text: `${asText(v)}\n\n${h.data.name}: ${a.text}`, from: h.id } : v) : ({ role: "user", text: a.text ?? "", from: h.id } satisfies Msg);
    for (const x of outs) if (x.target !== from || !h.data.approves) this.track(this.deliver(x, value, h.id));
  }

  /** Post to a room and wake the next speaker(s) by its policy. */
  private async post(roomId: string, from: string, text: string) {
    const rc = this.rc;
    const room = this.hub.room(roomId);
    if (!room || rc.signal.aborted) return;
    const edge = rc.doc.edges.find((e) => e.kind === "access" && e.source === from && e.target === roomId);
    const tag = edge?.binding?.write?.tag ?? undefined;
    room.post(from, text, tag);
    const posted = room.posts[room.posts.length - 1];
    rc.emit({ type: "message", from, to: roomId, room: roomId, edge: edge?.id, port: tag, kind: "message", text: clip(text, 6000) });
    // posts: how many messages this run has put in the room, so a conversation can end after a set length ("posts >= 12")
    const posts = room.posts.filter((p) => p.run === rc.runId).length;
    if (/\bTERMINATE\b/.test(text) || rc.doc.termination.some((t) => testExpr(t, { text, last: text, from, room: roomId, posts }).ok)) {
      rc.emit({ type: "transform", at: roomId, label: "conversation ended", detail: "termination condition" });
      // a conversation that ends in a room is the run's answer, so it is not lost
      this.outputs++;
      rc.emit({ type: "output", node: from, port: roomId, text: clip(text, 20_000) });
      return;
    }
    // members only hear what their subscription accepts (binding.read.filter over msg)
    const members = room.members().filter((m) => m !== from && room.accepts(m, posted));
    let next: string[] = [];
    switch (room.policy) {
      case "round_robin":
      case "bid": {
        const n = room.nextRoundRobin(from);
        next = n ? [n] : [];
        break;
      }
      case "mention":
        next = room.mentioned(text).filter((m) => m !== from);
        break;
      case "selector": {
        const selector = room.node.data.room?.selector;
        // the selector (a group chat manager) picks among the other agents: a person in the room speaks when @named, not when a model says so
        const candidates = members.filter((m) => m !== selector && rc.byId.get(m)?.data.kind === "agent");
        const names = candidates.map((m) => `${m}: ${nameOf(rc, m)}${"role" in (rc.byId.get(m)?.data ?? {}) ? ` (${(rc.byId.get(m)!.data as { role: string }).role})` : ""}`).join("\n");
        const sel = selector && rc.byId.get(selector)?.data.kind === "agent" ? (rc.byId.get(selector)!.data as AgentData).model : null;
        const pick = await llmCall(rc, selector ?? roomId, `Conversation:\n${room.transcript(12_000)}\n\nWho should speak next? Reply with one id from:\n${names}`, sel);
        // the id (or else the name) as a whole word, longest first: "rewriter" is not "writer"
        const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const whole = (needle: string) => new RegExp(`(^|[^A-Za-z0-9_-])${esc(needle)}($|[^A-Za-z0-9_-])`, "i").test(pick);
        const longest = [...candidates].sort((a, b) => b.length - a.length);
        const found =
          longest.find((m) => whole(m)) ??
          [...candidates].sort((a, b) => nameOf(rc, b).length - nameOf(rc, a).length).find((m) => whole(nameOf(rc, m))) ??
          longest.find((m) => pick.toLowerCase().includes(m.toLowerCase()));
        next = found ? [found] : [];
        break;
      }
      default:
        next = members.filter((m) => rc.byId.get(m)?.data.kind === "agent");
    }
    // a person opening the conversation without naming anyone reaches the first agent
    if (!next.length && this.starters.has(from)) {
      const first = members.find((m) => rc.byId.get(m)?.data.kind === "agent" && m !== room.node.data.room?.selector);
      if (first) next = [first];
    }
    if (!next.length && rc.byId.get(from)?.data.kind === "agent") {
      // nobody is next (the manager named no one, nobody was @named): the conversation is over, and its last word is the answer, as with TERMINATE
      rc.emit({ type: "transform", at: roomId, label: "conversation ended", detail: room.policy === "selector" ? "the manager picked no one" : "nobody is next" });
      this.outputs++;
      rc.emit({ type: "output", node: from, port: roomId, text: clip(text, 20_000) });
      return;
    }
    for (const m of next) {
      const via = rc.doc.edges.find((e) => e.kind === "access" && e.source === m && e.target === roomId);
      const member = rc.byId.get(m);
      if (member?.data.kind === "human") {
        this.track(
          (async () => {
            const a = await rc.ask({ node: m, from, kind: "input", text: `Your turn in ${nameOf(rc, roomId)}:\n${clip(text, 2000)}` });
            if (a.text) await this.post(roomId, m, a.text);
          })(),
        );
      } else if (member?.data.kind === "agent") this.schedule(m, { role: "user", text: `${nameOf(rc, from)} in ${nameOf(rc, roomId)}: ${text}`, from } satisfies Msg, via);
    }
  }
}
