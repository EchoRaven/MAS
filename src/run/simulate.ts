// A structural simulation of a run: it walks the system graph (ports,
// groups, rooms, gates, approvals, spawning, transforms) and emits the events
// a real runtime would emit. No model is called; message text is
// placeholder. Deterministic per system id so a replay looks the same.
import { runnerById } from "@/model/defaults";
import { interfaceOf, nodeName } from "@/model/ports";
import type { AgentData, EnvData, FunctionNodeData, HumanData, ModelNodeData, SysEdge, SysNode, SystemDoc } from "@/model/types";
import type { RunStatus } from "@/canvas/convert";
import { memorySummary, retrievalSummary } from "./describe";

export type SimEvent =
  | { t: number; type: "system_started" }
  | { t: number; type: "status"; node: string; status: RunStatus }
  | { t: number; type: "message"; from: string; to: string; edge?: string; room?: string; port?: string; kind: SysEdge["kind"] | "reply"; text: string }
  | { t: number; type: "tool"; node: string; tool: string; args: string; result: string }
  | { t: number; type: "access"; node: string; target: string; edge: string; op: "read" | "write" }
  | { t: number; type: "gate"; edge: string; gate: string; passed: boolean; reason: string }
  | { t: number; type: "transform"; at: string; edge?: string; label: string; detail: string }
  | { t: number; type: "approval"; node: string; from: string; resolved: boolean }
  | { t: number; type: "usage"; node: string; tokens_in: number; tokens_out: number; usd: number; estimated: boolean }
  | { t: number; type: "spawn"; node: string; template: string; count: number }
  | { t: number; type: "system_finished"; reason: string };

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const PHRASES = {
  message: ["Quick progress update", "Here are the results of this step", "Done on my side, over to you", "Found an issue, please take a look", "Some extra background"],
  call: ["Please handle this subtask", "I need your judgment", "Please confirm and reply"],
  handoff: ["Handing off, summary attached", "This phase is done; you own the rest"],
  reply: ["Handled, results below", "Done", "Confirmed"],
};

export interface SimResult {
  events: SimEvent[];
  finishedReason: string;
}

interface Job {
  node: string;
  port?: string;
  from?: string;
  via?: SysEdge;
  room?: string;
}

const STAGE_TEXT: Record<string, (schema?: string | null) => string> = {
  parse_json: (s) => `parsed as ${s ?? "JSON"}`,
  validate: (s) => `valid against ${s ?? "schema"}`,
  transform: () => "transformed",
  filter: () => "passed the filter",
  redact: () => "redacted",
  summarize: () => "summarised",
};

export function simulate(doc: SystemDoc, maxActivations = 60): SimResult {
  const rand = rng(doc.id);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const events: SimEvent[] = [];
  let t = 0;
  const emit = (e: DistOmit<SimEvent, "t">, dt = 0.4 + rand() * 0.8) => {
    t += dt;
    events.push({ ...e, t: Math.round(t * 10) / 10 } as SimEvent);
  };
  const isRoom = (id: string) => (byId.get(id)?.data as EnvData | undefined)?.env_kind === "room" && byId.get(id)?.data.kind === "env";
  /** edges leaving a component's output ports (a group's outputs leave from the group itself) */
  const outEdges = (id: string, port?: string) => {
    const n = byId.get(id);
    const outs = n ? interfaceOf(n.data).outputs.map((p) => p.id) : [];
    return doc.edges.filter((e) => e.source === id && e.kind !== "access" && outs.includes(e.source_port) && (!port || e.source_port === port));
  };
  const accessOf = (id: string) => doc.edges.filter((e) => e.kind === "access" && e.source === id);
  const roomMembers = (room: string) => doc.edges.filter((e) => e.kind === "access" && e.target === room).map((e) => e.source);

  const budgetUsd = doc.budget.usd ?? Infinity;
  const maxRounds = Math.min(doc.budget.max_rounds ?? maxActivations, maxActivations);
  let spent = 0;
  let rounds = 0;
  const gateTries = new Map<string, number>();
  // per-edge send caps keep the walk finite
  const sent = new Map<string, number>();
  const CAP: Record<SysEdge["kind"], number> = { call: 1, message: 2, handoff: 2, access: 3 };
  const canSend = (e: SysEdge) => (sent.get(e.id) ?? 0) < CAP[e.kind];
  const markSent = (e: SysEdge) => sent.set(e.id, (sent.get(e.id) ?? 0) + 1);
  const rrIndex = new Map<string, number>();
  const spawned = new Set<string>();
  const groupCaller = new Map<string, { from: string; edge: SysEdge }>();
  const groupRound = new Map<string, number>();
  const queue: Job[] = [];
  // a function that joins "all" runs once every required input has arrived
  const arrived = new Map<string, Set<string>>();
  const enqueue = (j: Job) => {
    const n = byId.get(j.node);
    if (n?.data.kind === "function" && n.data.join === "all" && j.port) {
      const got = arrived.get(j.node) ?? new Set<string>();
      got.add(j.port);
      arrived.set(j.node, got);
      const need = n.data.interface.inputs.filter((p) => p.required).map((p) => p.id);
      if (need.some((p) => !got.has(p))) return;
      arrived.delete(j.node);
      queue.push(j);
      return;
    }
    if (!queue.some((q) => q.node === j.node)) queue.push(j);
  };

  /** Deliver along an edge: transform, then follow group ports until a component that runs. */
  const deliver = (e: SysEdge, from: string, text: string, depth = 0): Job[] => {
    if (depth > 8) return [];
    if (e.transform) emit({ type: "transform", at: e.source, edge: e.id, label: `${e.transform.lang} transform`, detail: e.transform.code.split("\n")[0].slice(0, 80) }, 0.15);
    const target = byId.get(e.target);
    if (!target) return [];
    if (target.data.kind === "group") {
      const g = target;
      const inner = interfaceOf(g.data).inputs.some((p) => p.id === e.target_port);
      if (inner) {
        if (e.kind === "call") groupCaller.set(g.id, { from, edge: e });
        const next = doc.edges.filter((x) => x.source === g.id && x.source_port === e.target_port);
        return next.flatMap((x) => {
          emit({ type: "message", from: g.id, to: x.target, edge: x.id, port: x.target_port, kind: x.kind, text }, 0.15);
          return deliver(x, g.id, text, depth + 1).map((j) => ({ ...j, via: e.kind === "call" ? x : j.via }));
        });
      }
      // a member wrote the group's output: another round, or out
      const it = g.data.kind === "group" ? g.data.iterate : null;
      if (it) {
        const round = (groupRound.get(g.id) ?? 1) + 1;
        // with no condition it runs every round; with one, the simulation lets it hold after a seeded number of rounds
        const stopAt = it.until ? Math.min(it.max_rounds, 1 + Math.floor(rand() * 3)) : it.max_rounds;
        if (round <= stopAt) {
          groupRound.set(g.id, round);
          emit({ type: "transform", at: g.id, label: `round ${round} of ≤${it.max_rounds}`, detail: it.until ? `until ${it.until} — not yet` : "next round" }, 0.15);
          const inputs = interfaceOf(g.data).inputs.map((p) => p.id);
          const back = doc.edges.filter((x) => x.source === g.id && inputs.includes(x.source_port));
          return back.flatMap((x) => {
            emit({ type: "message", from: g.id, to: x.target, edge: x.id, port: x.target_port, kind: x.kind, text: it.feed === "input_and_output" ? "Question and everyone's answers" : text }, 0.1);
            return deliver(x, g.id, text, depth + 1);
          });
        }
        emit({ type: "transform", at: g.id, label: "rounds done", detail: it.until ? `${it.until} holds` : `${it.max_rounds} rounds` }, 0.1);
        groupRound.delete(g.id);
      }
      const next = doc.edges.filter((x) => x.source === g.id && x.source_port === e.target_port);
      const caller = groupCaller.get(g.id);
      if (!next.length && caller) {
        emit({ type: "message", from: g.id, to: caller.from, edge: caller.edge.id, kind: "reply", text: "Report attached" });
        groupCaller.delete(g.id);
        return [];
      }
      return next.flatMap((x) => {
        if (!canSend(x)) return [];
        markSent(x);
        emit({ type: "message", from: g.id, to: x.target, edge: x.id, port: x.target_port, kind: x.kind, text });
        return deliver(x, g.id, text, depth + 1);
      });
    }
    return [{ node: target.id, port: e.target_port, from, via: e }];
  };

  /** Send on a component's outputs (all ports, or the routed one). Returns true if control moved on. */
  const sendOutputs = (node: SysNode, port: string | undefined, job: Job): boolean => {
    const outs = outEdges(node.id, port).filter((e) => e.target !== job.from && canSend(e));
    for (const e of outs) {
      const target = byId.get(e.target);
      if (!target) continue;
      if (e.gate) {
        const tries = (gateTries.get(e.id) ?? 0) + 1;
        gateTries.set(e.id, tries);
        const passed = tries >= 2;
        emit({ type: "gate", edge: e.id, gate: e.gate.name, passed, reason: passed ? `${e.gate.condition || "condition"} passed` : `${e.gate.condition || "condition"} failed: 2 failures` });
        if (!passed) {
          emit({ type: "status", node: node.id, status: "blocked" }, 0.2);
          queue.push(job);
          return true;
        }
      }
      if (e.filter) emit({ type: "transform", at: node.id, edge: e.id, label: "filter", detail: e.filter }, 0.1);
      markSent(e);
      const text = e.kind === "call" ? `${e.label ? e.label + ": " : ""}${pick(PHRASES.call)}` : e.kind === "handoff" ? `${pick(PHRASES.handoff)} (carrying ${e.carry ?? "summary"})` : e.label || pick(PHRASES.message);
      emit({ type: "message", from: node.id, to: e.target, edge: e.id, port: e.target_port, kind: e.kind, text });
      const jobs = deliver(e, node.id, text);
      if (e.kind === "call") {
        emit({ type: "status", node: node.id, status: "waiting" }, 0.1);
        for (const j of jobs.reverse()) queue.unshift(j);
        queue.push({ node: node.id });
        return true;
      }
      for (const j of jobs) enqueue(j);
      if (e.kind === "handoff") return true;
    }
    return false;
  };

  const usage = (id: string, modelId: string, ctxBudget: number, runner: string | undefined, scale = 1) => {
    const m = doc.models.find((x) => x.id === modelId);
    const tin = Math.round((2000 + rand() * Math.min(ctxBudget, 60000) * 0.25) * scale);
    const tout = Math.round((200 + rand() * 1200) * scale);
    const usd = m ? (tin * m.price_in + tout * m.price_out) / 1e6 : 0;
    spent += usd;
    const estimated = runner ? !runnerById(runner)?.caps.cost_reporting : false;
    emit({ type: "usage", node: id, tokens_in: tin, tokens_out: tout, usd, estimated }, 0.1);
  };

  emit({ type: "system_started" }, 0);

  // entry points: humans with something to send, on_start agents, else the first runnable top-level component
  for (const h of doc.nodes.filter((n) => n.data.kind === "human" && !n.parent)) {
    const outs = outEdges(h.id);
    const rooms = accessOf(h.id).filter((e) => isRoom(e.target));
    if (!outs.length && !rooms.length) continue;
    if (doc.edges.some((e) => e.target === h.id && e.kind !== "access") && !outs.length) continue;
    // a starting human sends on each of their outputs (a broadcast reaches every target)
    for (const e of outs.slice(0, 6)) {
      markSent(e);
      emit({ type: "message", from: h.id, to: e.target, edge: e.id, port: e.target_port, kind: e.kind, text: "Here is the task brief. Please begin." });
      for (const j of deliver(e, h.id, "brief")) enqueue(j);
    }
    for (const e of rooms.slice(0, 1)) {
      emit({ type: "message", from: h.id, to: e.target, edge: e.id, room: e.target, kind: "message", text: "Here is the task brief. Please begin." });
      const first = roomMembers(e.target).find((m) => byId.get(m)?.data.kind === "agent");
      if (first) enqueue({ node: first, from: h.id, room: e.target });
    }
    if (queue.length) break;
  }
  for (const n of doc.nodes.filter((x) => x.data.kind === "agent" && (x.data as AgentData).triggers.includes("on_start"))) enqueue({ node: n.id });
  if (!queue.length) {
    const first = doc.nodes.find((n) => !n.parent && (n.data.kind === "agent" || n.data.kind === "model")) ?? doc.nodes.find((n) => n.data.kind === "agent");
    if (first) queue.push({ node: first.id });
  }

  let finished = "";
  while (queue.length) {
    if (rounds >= maxRounds) {
      finished = "Round limit reached";
      break;
    }
    if (spent >= budgetUsd) {
      finished = "Over budget";
      break;
    }
    const job = queue.shift()!;
    const node = byId.get(job.node);
    if (!node) continue;
    const d = node.data;

    if (d.kind === "human") {
      const h = d as HumanData;
      // only a call to someone who approves is an approval; anything else is just received
      if (job.via?.kind === "call" && h.approves) {
        emit({ type: "status", node: node.id, status: "waiting" });
        emit({ type: "approval", node: node.id, from: job.from ?? "", resolved: false });
        emit({ type: "approval", node: node.id, from: job.from ?? "", resolved: true }, 2 + rand() * 2);
      } else emit({ type: "status", node: node.id, status: "done" }, 0.2);
      emit({ type: "status", node: node.id, status: "idle" }, 0.1);
      if (job.from && job.via?.kind === "call") emit({ type: "message", from: node.id, to: job.from, edge: job.via.id, kind: "reply", text: h.approves ? "Approved." : "Noted." });
      continue;
    }

    if (d.kind === "function") {
      const f = d as FunctionNodeData;
      rounds++;
      emit({ type: "status", node: node.id, status: "working" }, 0.2);
      const outs = f.interface.outputs;
      const routed = outs.length > 1 ? pick(outs).id : undefined;
      emit({ type: "transform", at: node.id, label: `${f.fn.lang} function`, detail: routed ? `returned { ${routed}: … }` : "returned a value" }, 0.2);
      sendOutputs(node, routed, job);
      emit({ type: "status", node: node.id, status: "done" }, 0.1);
      continue;
    }

    if (d.kind === "model") {
      const m = d as ModelNodeData;
      rounds++;
      emit({ type: "status", node: node.id, status: "working" });
      usage(node.id, m.model, 8000, undefined, 0.4);
      const port0 = m.interface.outputs[0];
      if (port0?.type === "json") emit({ type: "transform", at: node.id, label: "structured output", detail: `parsed as ${port0.schema ?? "JSON"}` }, 0.1);
      if (job.via?.kind === "call" && job.from) emit({ type: "message", from: node.id, to: job.from, edge: job.via.id, kind: "reply", text: "Completion" });
      else sendOutputs(node, undefined, job);
      emit({ type: "status", node: node.id, status: "done" }, 0.1);
      continue;
    }

    if (d.kind !== "agent") continue;
    rounds++;
    const a = d as AgentData;
    emit({ type: "status", node: node.id, status: "working" });
    for (const p of a.pipeline.pre) emit({ type: "transform", at: node.id, label: `in · ${p.name}`, detail: STAGE_TEXT[p.op]?.(p.schema) ?? p.op }, 0.1);

    if (a.spawn && !spawned.has(node.id) && byId.has(a.spawn.template)) {
      spawned.add(node.id);
      const count = Math.max(1, Math.min(a.spawn.max_instances, 2 + Math.floor(rand() * 3)));
      emit({ type: "spawn", node: node.id, template: a.spawn.template, count });
      const tpl = byId.get(a.spawn.template) as SysNode<AgentData>;
      emit({ type: "status", node: tpl.id, status: "working" });
      for (let i = 1; i <= count; i++) {
        emit({ type: "message", from: node.id, to: tpl.id, kind: "call", text: `Sub-question ${i}: search and cite sources` }, 0.2);
        for (const tool of tpl.data.tools.slice(0, 1)) emit({ type: "tool", node: tpl.id, tool, args: `{"query": "sub-question ${i}"}`, result: "3 results" }, 0.3);
        usage(tpl.id, tpl.data.model, tpl.data.context.budget_total, tpl.data.harness.runner, 0.5);
        emit({ type: "message", from: tpl.id, to: node.id, kind: "reply", text: `Findings and sources for sub-question ${i}` }, 0.3);
      }
      emit({ type: "status", node: tpl.id, status: "done" });
    }

    const access = accessOf(node.id);
    const resources = access.filter((e) => !isRoom(e.target));
    for (const e of resources.slice(0, 2)) emit({ type: "access", node: node.id, target: e.target, edge: e.id, op: "read" }, 0.3);
    for (const e of resources.filter((x) => x.binding?.mode === "auto_inject" || x.binding?.mode === "pinned")) {
      const t = byId.get(e.target)?.data;
      const retrieval = t?.kind === "plugin" ? t.spec.retrieval : null;
      const detail = e.binding!.mode === "pinned" ? "pinned in the context" : retrieval ? retrievalSummary(retrieval, e.binding!.read?.retrieval, e.binding!.read?.top_k) : `top ${e.binding!.read?.top_k ?? 5} injected`;
      emit({ type: "transform", at: node.id, edge: e.id, label: `retrieve · ${nodeName(byId.get(e.target))}`, detail }, 0.1);
    }
    const envTools = resources.flatMap((e) => {
      const d = byId.get(e.target)?.data;
      const dbTools = d?.kind === "env" && d.db ? (d.db.mode === "templates" ? d.db.templates.map((t) => t.name) : d.db.mode === "text_to_sql" ? ["ask_database"] : []) : [];
      const all = d?.kind === "env" ? [...(d.manifest?.exposes.mcp?.tools ?? []), ...dbTools] : d?.kind === "plugin" ? d.spec.tools.map((t) => t.name) : [];
      const allowed = e.binding?.tools?.length ? all.filter((t) => e.binding!.tools!.includes(t)) : all;
      return allowed.slice(0, 1);
    });
    for (const tool of [...a.tools.slice(0, 2), ...envTools]) {
      if (rand() < 0.7) emit({ type: "tool", node: node.id, tool, args: "{…}", result: tool === "run_tests" ? "12 passed" : "ok" });
    }
    for (const h of (["before_model", "after_model"] as const).filter((k) => a.hooks?.[k])) emit({ type: "transform", at: node.id, label: `hook · ${h}`, detail: a.hooks![h]!.lang }, 0.05);
    usage(node.id, a.model, a.context.budget_total, a.harness.runner);
    if (a.harness.tier === "native" && (a.harness.loop === "reflexion" || a.harness.loop === "tree_search")) {
      const n = Number(a.harness.loop_params?.[a.harness.loop === "reflexion" ? "max_trials" : "branches"] ?? 2);
      for (let i = 1; i < Math.min(n, 3); i++) {
        emit({ type: "transform", at: node.id, label: a.harness.loop === "reflexion" ? `critique ${i}` : `branch ${i + 1}`, detail: a.harness.loop === "reflexion" ? "self-critique, then retry with it" : "candidate scored by the evaluator" }, 0.2);
        usage(node.id, a.model, a.context.budget_total, a.harness.runner, 0.4);
      }
    } else if (a.harness.tier === "native" && a.harness.loop === "custom") emit({ type: "transform", at: node.id, label: "custom loop", detail: a.harness.loop_fn?.lang ?? "code" }, 0.1);
    for (const e of resources.filter((x) => x.access !== "read").slice(0, 1)) emit({ type: "access", node: node.id, target: e.target, edge: e.id, op: "write" }, 0.3);
    for (const e of resources.filter((x) => x.binding?.write?.when === "after_turn")) {
      const t = byId.get(e.target)?.data;
      const policy = t?.kind === "plugin" ? t.spec.memory : null;
      emit({ type: "transform", at: node.id, edge: e.id, label: `remember · ${nodeName(byId.get(e.target))}`, detail: policy ? memorySummary(policy) : e.binding!.write!.extract ? `${e.binding!.write!.extract.lang} extract → stored` : "turn stored" }, 0.1);
    }

    // output wrapper
    let routed: string | undefined;
    for (const p of a.pipeline.post) {
      if (p.op === "route") {
        routed = a.interface.outputs.length > 1 ? pick(a.interface.outputs).id : undefined;
        emit({ type: "transform", at: node.id, label: `out · ${p.name}`, detail: routed ? `routed to ${routed}` : "single output" }, 0.1);
      } else emit({ type: "transform", at: node.id, label: `out · ${p.name}`, detail: STAGE_TEXT[p.op]?.(p.schema) ?? p.op }, 0.1);
    }

    if (job.via?.kind === "call" && job.from) {
      emit({ type: "message", from: node.id, to: job.from, edge: job.via.id, kind: "reply", text: pick(PHRASES.reply) });
      emit({ type: "status", node: node.id, status: "done" }, 0.1);
      continue;
    }

    let movedOn = sendOutputs(node, routed, job);

    // rooms: post, and wake members by the room's speaking policy
    if (!movedOn) {
      for (const e of access.filter((x) => isRoom(x.target) && canSend(x))) {
        markSent(e);
        const room = byId.get(e.target)!.data as EnvData;
        emit({ type: "message", from: node.id, to: e.target, room: e.target, edge: e.id, kind: "message", text: pick(PHRASES.message) });
        const members = roomMembers(e.target).filter((m) => m !== node.id && byId.get(m)?.data.kind === "agent");
        if (!members.length) continue;
        const policy = room.room?.policy ?? "free";
        let next: string[];
        if (policy === "round_robin" || policy === "selector" || policy === "bid") {
          const i = (rrIndex.get(e.target) ?? 0) % members.length;
          rrIndex.set(e.target, i + 1);
          next = [members[i]];
        } else if (policy === "mention") next = [pick(members)];
        else next = members.filter(() => rand() < 0.5).slice(0, 2);
        for (const m of next) enqueue({ node: m, from: node.id, room: e.target });
      }
    }
    const last = [...events].reverse().find((x) => x.type === "status" && x.node === node.id);
    if (!movedOn || (last?.type === "status" && last.status === "working")) emit({ type: "status", node: node.id, status: "done" }, 0.2);
    movedOn = false;
  }
  if (!finished) finished = queue.length ? "Stopped" : "All idle";
  emit({ type: "system_finished", reason: finished });
  return { events, finishedReason: finished };
}

export interface SimState {
  status: Record<string, RunStatus>;
  activeEdges: Set<string>;
  blockedEdges: Set<string>;
  spent: number;
  tokens: number;
  perAgent: Record<string, { calls: number; tokens_in: number; tokens_out: number; usd: number; estimated: boolean }>;
  finished?: string;
}

/** Fold events [0, upto) into the state the canvas and panels show. A group shows its busiest member. */
export function stateAt(events: SimEvent[], upto: number, doc?: SystemDoc): SimState {
  const s: SimState = { status: {}, activeEdges: new Set(), blockedEdges: new Set(), spent: 0, tokens: 0, perAgent: {} };
  const recent = events.slice(Math.max(0, upto - 3), upto);
  for (const e of events.slice(0, upto)) {
    if (e.type === "status") s.status[e.node] = e.status;
    if (e.type === "usage") {
      s.spent += e.usd;
      s.tokens += e.tokens_in + e.tokens_out;
      const p = (s.perAgent[e.node] ??= { calls: 0, tokens_in: 0, tokens_out: 0, usd: 0, estimated: false });
      p.calls++;
      p.tokens_in += e.tokens_in;
      p.tokens_out += e.tokens_out;
      p.usd += e.usd;
      p.estimated ||= e.estimated;
    }
    if (e.type === "gate") {
      if (e.passed) s.blockedEdges.delete(e.edge);
      else s.blockedEdges.add(e.edge);
    }
    if (e.type === "system_finished") s.finished = e.reason;
  }
  for (const e of recent) {
    if ((e.type === "message" || e.type === "access") && e.edge) s.activeEdges.add(e.edge);
    if (e.type === "transform" && e.edge) s.activeEdges.add(e.edge);
  }
  if (doc) {
    const rank: Record<RunStatus, number> = { idle: 0, done: 1, waiting: 2, blocked: 3, working: 4 };
    const groups = doc.nodes.filter((n) => n.data.kind === "group");
    // deepest groups first so nested groups roll up
    const depth = (id: string): number => { const p = doc.nodes.find((n) => n.id === id)?.parent; return p ? 1 + depth(p) : 0; };
    for (const g of [...groups].sort((a, b) => depth(b.id) - depth(a.id))) {
      const members = doc.nodes.filter((n) => n.parent === g.id).map((n) => s.status[n.id]).filter(Boolean) as RunStatus[];
      if (members.length) s.status[g.id] = members.reduce((a, b) => (rank[b] > rank[a] ? b : a));
    }
  }
  return s;
}

export const describeNode = (doc: SystemDoc, id: string) => nodeName(doc.nodes.find((n) => n.id === id));
