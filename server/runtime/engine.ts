// The scheduler: runs a system graph for real. Values travel along edges
// (filter -> transform -> gate -> coercion to the target port), components
// run when input arrives (agents coalesce or queue per their concurrency),
// call edges are synchronous tools, groups forward through their ports and
// repeat in rounds, rooms wake members by policy, and people answer through
// requests the run waits on.
import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentData, FunctionNodeData, GroupData, HumanData, ModelNodeData, SysEdge, SysNode } from "@/model/types";
import { interfaceOf } from "@/model/ports";
import { schemaById } from "./agent/jsonschema";
import { AgentState, runAgentTurn, type TurnServices } from "./agent/turn";
import { BudgetError, nameOf, StopError, type RunCtx } from "./context";
import { llmCall, runFn } from "./functions";
import { testExpr } from "./functions/sandbox";
import { renderTemplate } from "./functions/template";
import { textOf, userText } from "./models";
import { Hub } from "./resources/hub";
import type { RtTool } from "./resources/types";
import { asText, clip, coerce, syncMsg, type Msg } from "./values";

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
  private chain = new AsyncLocalStorage<string[]>();
  private joinBuf = new Map<string, Record<string, unknown>>();
  private groups = new Map<string, { round: number; input: unknown }>();
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
    if (e instanceof StopError || e instanceof BudgetError || this.rc.signal.aborted) return;
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
      const humans = rc.doc.nodes.filter((n) => n.data.kind === "human" && !n.parent);
      for (const h of humans) {
        const outs = this.outEdges(h.id);
        const rooms = rc.doc.edges.filter((e) => e.kind === "access" && e.source === h.id && this.isRoom(e.target));
        if (!outs.length && !rooms.length) continue;
        this.starters.add(h.id);
        for (const e of outs) this.track(this.deliver(e, { ...entryValue, from: h.id }, h.id));
        for (const e of rooms) this.track(this.post(e.target, h.id, input));
      }
      if (!this.starters.size) {
        const onStart = rc.doc.nodes.filter((n) => n.data.kind === "agent" && (n.data as AgentData).triggers.includes("on_start"));
        const incoming = new Set(rc.doc.edges.filter((e) => e.kind !== "access").map((e) => e.target));
        const first =
          rc.doc.nodes.find((n) => !n.parent && ["agent", "model", "function", "group"].includes(n.data.kind) && !incoming.has(n.id)) ??
          rc.doc.nodes.find((n) => !n.parent && ["agent", "model", "function", "group"].includes(n.data.kind));
        const entries = onStart.length ? onStart : first ? [first] : [];
        if (!entries.length) throw new Error("Nothing to run: add an agent, model, function or group");
        for (const n of entries) {
          if (n.data.kind === "group") {
            const p = interfaceOf(n.data).inputs[0];
            if (p) this.track(this.groupEnter(n.id, p.id, entryValue));
          } else this.schedule(n.id, entryValue);
        }
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
    let v = value;
    if (e.filter) {
      const scope = { input: v, value: v, text: asText(v), ...(v && typeof v === "object" && !Array.isArray(v) ? (v as object) : {}) };
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
      const r = testExpr(cond.slice(5).trim(), { input: v, text: asText(v), ...(v && typeof v === "object" ? (v as object) : {}) });
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
    if (!passed && g.on_fail === "route_back") {
      const back = rc.doc.edges.find((x) => x.source === e.target && x.target === from && x.kind !== "access");
      const tries = (rc.vars[`gate:${e.id}`] as number | undefined) ?? 0;
      rc.vars[`gate:${e.id}`] = tries + 1;
      if (tries + 1 >= Math.max(1, g.escalate_after || 3)) {
        const a = await rc.ask({ node: "", from, kind: "approval", text: `Gate "${g.name}" failed ${tries + 1} times (${reason}). Let it through?` });
        if (a.approved) return true;
      } else this.schedule(from, { role: "user", text: `Your output did not pass "${g.name}": ${reason}\nPlease revise.`, from: e.target } satisfies Msg, back);
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
      this.track(this.activate(n, item));
      return;
    }
    const q = this.queues.get(id) ?? [];
    q.push(item);
    this.queues.set(id, q);
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

  private async activate(n: SysNode, item: Item) {
    await this.slot();
    try {
      await this.lock(n.id, () => this.chain.run([n.id], () => this.runComponent(n, item, false)));
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
        const r = await runAgentTurn(this, this.state, n as SysNode<AgentData>, item.value, item.via);
        reply = r.text;
        if (!direct && !r.dropped) await this.afterAgent(n as SysNode<AgentData>, r, item.via);
        break;
      }
      case "model": {
        const m = n.data as ModelNodeData;
        const prompt = await renderTemplate(m.prompt || "{{input}}", { input: item.value, vars: rc.vars });
        const outSpec = m.interface.outputs[0];
        const schema = outSpec?.type === "json" ? schemaById(rc.doc, outSpec.schema) : null;
        const system = [m.system_prompt, outSpec?.type === "json" ? `Reply with only a JSON value${schema ? ` matching this JSON Schema:\n${JSON.stringify(schema)}` : "."}` : ""].filter(Boolean).join("\n\n");
        const { res, usage } = await rc.models.chat(m.model, { system: system || undefined, messages: [userText(prompt)], temperature: m.temperature, max_tokens: m.max_tokens, signal: rc.signal });
        rc.usage(n.id, usage);
        reply = textOf(res.content);
        if (!direct) await this.emitOutputs(n.id, { [m.interface.outputs[0]?.id ?? "out"]: reply });
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

  private async afterAgent(n: SysNode<AgentData>, r: { output: unknown; text: string; port?: string; transfers: string[] }, via?: SysEdge) {
    const ports = r.port ? [r.port] : n.data.interface.outputs.map((p) => p.id);
    const edges = ports.flatMap((p) => this.outEdges(n.id, p));
    const handoffs = edges.filter((e) => e.kind === "handoff");
    const chosen = handoffs.length > 1 ? handoffs.filter((e) => r.transfers.includes(e.id)) : handoffs;
    const send = [...edges.filter((e) => e.kind !== "handoff"), ...(chosen.length || handoffs.length < 2 ? chosen : handoffs.slice(0, 1))];
    for (const e of send) {
      let v: unknown = r.output;
      if (e.kind === "handoff" && e.carry === "full") v = { role: "user", text: asText(r.output), from: n.id, meta: { history: this.state.history.get(n.id) ?? [] } } satisfies Msg;
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
      const edges = this.outEdges(id, port);
      if (!edges.length) {
        this.outputs++;
        this.rc.emit({ type: "output", node: id, port, text: clip(asText(v), 20_000) });
      }
      for (const e of edges) this.track(this.deliver(e, v, id));
    }
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

  exposeTools(node: string, tools: RtTool[]) {
    return this.opts.expose?.(node, tools);
  }

  // groups --------------------------------------------------------------------------
  private async groupEnter(g: string, port: string, v: unknown) {
    if (!this.groups.has(g)) this.groups.set(g, { round: 1, input: v });
    const inner = this.rc.doc.edges.filter((x) => x.source === g && x.source_port === port && x.kind !== "access");
    if (!inner.length) this.rc.emit({ type: "log", node: g, level: "warn", text: `input ${port} is not wired to anything inside ${nameOf(this.rc, g)}` });
    for (const x of inner) this.track(this.deliver(x, v, g));
  }

  private async groupExit(g: string, port: string, v: unknown) {
    const rc = this.rc;
    const gd = this.node(g).data as GroupData;
    const st = this.groups.get(g) ?? { round: 1, input: undefined };
    const it = gd.iterate;
    if (it) {
      const until = it.until ? testExpr(it.until, { output: v, text: asText(v), round: st.round, input: st.input }) : { ok: false as boolean, error: undefined as string | undefined };
      if (!until.ok && st.round < it.max_rounds) {
        st.round++;
        this.groups.set(g, st);
        rc.emit({ type: "transform", at: g, label: `round ${st.round} of ≤${it.max_rounds}`, detail: until.error ? `until failed: ${until.error}` : it.until ? `until ${it.until} — not yet` : "next round" });
        const feed = it.feed === "input_and_output" ? ({ role: "user", text: `${asText(st.input)}\n\nAnswers from the previous round:\n${asText(v)}`, from: g } satisfies Msg) : v;
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
    if (!room) return;
    const edge = rc.doc.edges.find((e) => e.kind === "access" && e.source === from && e.target === roomId);
    const tag = edge?.binding?.write?.tag ?? undefined;
    room.post(from, text, tag);
    const posted = room.posts[room.posts.length - 1];
    rc.emit({ type: "message", from, to: roomId, room: roomId, edge: edge?.id, port: tag, kind: "message", text: clip(text, 6000) });
    if (/\bTERMINATE\b/.test(text) || rc.doc.termination.some((t) => testExpr(t, { text, last: text, from, room: roomId }).ok)) {
      rc.emit({ type: "transform", at: roomId, label: "conversation ended", detail: "termination condition" });
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
        const names = members.map((m) => `${m}: ${nameOf(rc, m)}`).join("\n");
        const sel = selector && rc.byId.get(selector)?.data.kind === "agent" ? (rc.byId.get(selector)!.data as AgentData).model : null;
        const pick = await llmCall(rc, selector ?? roomId, `Conversation:\n${room.transcript(12_000)}\n\nWho should speak next? Reply with one id from:\n${names}`, sel);
        const found = members.find((m) => pick.includes(m)) ?? members.find((m) => pick.toLowerCase().includes(nameOf(rc, m).toLowerCase()));
        next = found ? [found] : [];
        break;
      }
      default:
        next = members.filter((m) => rc.byId.get(m)?.data.kind === "agent");
    }
    // a person opening the conversation without naming anyone reaches the first agent
    if (!next.length && this.starters.has(from)) {
      const first = members.find((m) => rc.byId.get(m)?.data.kind === "agent");
      if (first) next = [first];
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
