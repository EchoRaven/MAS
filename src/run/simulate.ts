// A structural simulation of a run: it walks the system graph (triggers,
// edges, rooms, gates, approvals, spawning) and emits the events a real
// runtime would emit (Spec §10.2). No model is called; message text is
// placeholder. Deterministic per system id so a replay looks the same.
import { runnerById } from "@/model/defaults";
import type { AgentData, ChannelData, GroupData, HumanData, SysEdge, SysNode, SystemDoc } from "@/model/types";
import type { RunStatus } from "@/canvas/convert";

export type SimEvent =
  | { t: number; type: "system_started" }
  | { t: number; type: "status"; node: string; status: RunStatus }
  | { t: number; type: "message"; from: string; to: string; edge?: string; room?: string; kind: SysEdge["kind"] | "reply"; text: string }
  | { t: number; type: "tool"; node: string; tool: string; args: string; result: string }
  | { t: number; type: "access"; node: string; target: string; edge: string; op: "read" | "write" }
  | { t: number; type: "gate"; edge: string; gate: string; passed: boolean; reason: string }
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
  message: ["同步一下进展", "这一步的结果在这里", "我这边完成了，交给你继续", "发现一个问题，需要你看一下", "补充一点背景"],
  call: ["请帮我处理这个子任务", "需要你的判断", "请确认后回复"],
  handoff: ["任务移交，附上摘要", "这一阶段完成，后续由你负责"],
  reply: ["已处理，结果如下", "完成", "已确认"],
};

export interface SimResult {
  events: SimEvent[];
  finishedReason: string;
}

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
  const out = (id: string) => doc.edges.filter((e) => e.source === id);
  const roomMembers = (room: string) => doc.edges.filter((e) => e.target === room || e.source === room).map((e) => (e.source === room ? e.target : e.source));
  const resolve = (id: string): string => {
    const n = byId.get(id);
    if (n?.data.kind === "group") {
      const g = n.data as GroupData;
      const members = doc.nodes.filter((m) => m.parent === id);
      return g.entry && byId.has(g.entry) ? g.entry : (members.find((m) => m.data.kind === "agent")?.id ?? id);
    }
    return id;
  };

  const budgetUsd = doc.budget.usd ?? Infinity;
  const maxRounds = Math.min(doc.budget.max_rounds ?? maxActivations, maxActivations);
  let spent = 0;
  let rounds = 0;
  const gateTries = new Map<string, number>();
  const rrIndex = new Map<string, number>();
  const spawned = new Set<string>();
  const queue: { node: string; from?: string; via?: SysEdge; room?: string }[] = [];

  emit({ type: "system_started" }, 0);

  // entry points: humans that start something, on_start agents, else the first agent
  const starters = doc.nodes.filter((n) => n.data.kind === "human" && out(n.id).some((e) => e.kind !== "access"));
  for (const h of starters) {
    for (const e of out(h.id).filter((x) => x.kind !== "access")) {
      const isRoom = byId.get(e.target)?.data.kind === "channel";
      emit({ type: "message", from: h.id, to: e.target, edge: e.id, room: isRoom ? e.target : undefined, kind: e.kind, text: "这是任务说明，请开始。" });
      if (isRoom) {
        // the room's first agent member picks it up
        const first = roomMembers(e.target).find((m) => byId.get(m)?.data.kind === "agent");
        if (first) queue.push({ node: first, from: h.id, room: e.target });
      } else {
        queue.push({ node: resolve(e.target), from: h.id, via: e });
      }
    }
  }
  for (const n of doc.nodes.filter((x) => x.data.kind === "agent" && (x.data as AgentData).triggers.includes("on_start"))) queue.push({ node: n.id });
  if (!queue.length) {
    const first = doc.nodes.find((n) => n.data.kind === "agent" && !n.parent) ?? doc.nodes.find((n) => n.data.kind === "agent");
    if (first) queue.push({ node: first.id });
  }

  const usage = (n: SysNode<AgentData>, scale = 1) => {
    const a = n.data;
    const m = doc.models.find((x) => x.id === a.model);
    const tin = Math.round((2000 + rand() * Math.min(a.context.budget_total, 60000) * 0.25) * scale);
    const tout = Math.round((200 + rand() * 1200) * scale);
    const usd = m ? (tin * m.price_in + tout * m.price_out) / 1e6 : 0;
    spent += usd;
    const estimated = !runnerById(a.harness.runner)?.caps.cost_reporting;
    emit({ type: "usage", node: n.id, tokens_in: tin, tokens_out: tout, usd, estimated }, 0.1);
  };

  let finished = "";
  while (queue.length) {
    if (rounds >= maxRounds) {
      finished = "达到轮数上限";
      break;
    }
    if (spent >= budgetUsd) {
      finished = "超出预算";
      break;
    }
    const job = queue.shift()!;
    const node = byId.get(job.node);
    if (!node) continue;

    if (node.data.kind === "human") {
      const h = node.data as HumanData;
      emit({ type: "status", node: node.id, status: "waiting" });
      emit({ type: "approval", node: node.id, from: job.from ?? "", resolved: false });
      emit({ type: "approval", node: node.id, from: job.from ?? "", resolved: true }, 2 + rand() * 2);
      emit({ type: "status", node: node.id, status: "idle" }, 0.1);
      if (job.from && job.via?.kind === "call") {
        emit({ type: "message", from: node.id, to: job.from, kind: "reply", text: h.approves ? "批准。" : "收到。" });
      }
      continue;
    }
    if (node.data.kind !== "agent") continue;
    rounds++;
    const a = node.data as AgentData;
    emit({ type: "status", node: node.id, status: "working" });

    // spawn
    if (a.spawn && !spawned.has(node.id) && byId.has(a.spawn.template)) {
      spawned.add(node.id);
      const count = Math.max(1, Math.min(a.spawn.max_instances, 2 + Math.floor(rand() * 3)));
      emit({ type: "spawn", node: node.id, template: a.spawn.template, count });
      const tpl = byId.get(a.spawn.template) as SysNode<AgentData>;
      emit({ type: "status", node: tpl.id, status: "working" });
      for (let i = 1; i <= count; i++) {
        emit({ type: "message", from: node.id, to: tpl.id, kind: "call", text: `子问题 ${i}：请检索并附上来源` }, 0.2);
        for (const tool of tpl.data.tools.slice(0, 1)) emit({ type: "tool", node: tpl.id, tool, args: `{"query": "子问题 ${i}"}`, result: "3 条结果" }, 0.3);
        usage(tpl, 0.5);
        emit({ type: "message", from: tpl.id, to: node.id, kind: "reply", text: `子问题 ${i} 的结论与来源` }, 0.3);
      }
      emit({ type: "status", node: tpl.id, status: "done" });
    }

    // reads, tools, writes
    const access = out(node.id).filter((e) => e.kind === "access");
    for (const e of access.slice(0, 2)) emit({ type: "access", node: node.id, target: e.target, edge: e.id, op: "read" }, 0.3);
    for (const tool of a.tools.slice(0, 2)) {
      if (rand() < 0.7) emit({ type: "tool", node: node.id, tool, args: "{…}", result: tool === "run_tests" ? "12 passed" : "ok" });
    }
    usage(node as SysNode<AgentData>);
    for (const e of access.filter((x) => x.access !== "read").slice(0, 1)) emit({ type: "access", node: node.id, target: e.target, edge: e.id, op: "write" }, 0.3);

    // reply to a synchronous caller
    if (job.via?.kind === "call" && job.from) {
      emit({ type: "message", from: node.id, to: job.from, edge: job.via.id, kind: "reply", text: pick(PHRASES.reply) });
      emit({ type: "status", node: node.id, status: "done" }, 0.1);
      continue;
    }

    // outgoing interactions
    const outs = out(node.id).filter((e) => e.kind !== "access" && e.target !== job.from);
    let handedOff = false;
    for (const e of outs) {
      const target = byId.get(e.target);
      if (!target) continue;
      if (e.gate) {
        const tries = (gateTries.get(e.id) ?? 0) + 1;
        gateTries.set(e.id, tries);
        const passed = tries >= 2;
        emit({ type: "gate", edge: e.id, gate: e.gate.name, passed, reason: passed ? `${e.gate.condition || "条件"} 通过` : `${e.gate.condition || "条件"} 未通过：2 个失败` });
        if (!passed) {
          emit({ type: "status", node: node.id, status: "blocked" }, 0.2);
          queue.push({ node: node.id, from: job.from, via: job.via });
          handedOff = true;
          break;
        }
      }
      if (target.data.kind === "channel") {
        const c = target.data as ChannelData;
        emit({ type: "message", from: node.id, to: target.id, room: target.id, edge: e.id, kind: "message", text: pick(PHRASES.message) });
        const members = roomMembers(target.id).filter((m) => m !== node.id && byId.get(m)?.data.kind === "agent");
        if (!members.length) continue;
        let next: string[] = [];
        if (c.policy === "round_robin" || c.policy === "selector" || c.policy === "bid") {
          const i = (rrIndex.get(target.id) ?? 0) % members.length;
          rrIndex.set(target.id, i + 1);
          next = [members[i]];
        } else if (c.policy === "mention") {
          next = [pick(members)];
        } else {
          next = members.filter(() => rand() < 0.5).slice(0, 2);
        }
        for (const m of next) if (!queue.some((q) => q.node === m)) queue.push({ node: m, from: node.id, room: target.id });
        continue;
      }
      const to = resolve(e.target);
      const text = e.kind === "call" ? `${e.label ? e.label + "：" : ""}${pick(PHRASES.call)}` : e.kind === "handoff" ? `${pick(PHRASES.handoff)}（携带 ${e.carry ?? "summary"}）` : pick(PHRASES.message);
      emit({ type: "message", from: node.id, to: e.target, edge: e.id, kind: e.kind, text });
      if (e.kind === "call") {
        emit({ type: "status", node: node.id, status: "waiting" }, 0.1);
        queue.unshift({ node: to, from: node.id, via: e });
        queue.push({ node: node.id });
        handedOff = true;
        break;
      }
      if (!queue.some((q) => q.node === to)) queue.push({ node: to, from: node.id, via: e });
      if (e.kind === "handoff") {
        handedOff = true;
        break;
      }
    }
    // blocked by a gate or waiting on a call: that status stands; otherwise this turn is done
    const last = [...events].reverse().find((x) => x.type === "status" && x.node === node.id);
    if (!handedOff || (last?.type === "status" && last.status === "working")) emit({ type: "status", node: node.id, status: "done" }, 0.2);
  }
  if (!finished) finished = queue.length ? "停止" : "全部空闲";
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

/** Fold events [0, upto) into the state the canvas and panels show. */
export function stateAt(events: SimEvent[], upto: number): SimState {
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
  }
  return s;
}
