import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { ArrowRight, CheckCircle2, FlaskConical, Hash, Pause, Play, RotateCcw, ShieldAlert, ShieldCheck, SkipForward, Sparkles, UserCheck, Workflow, Wrench, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CanvasContext } from "@/canvas/context";
import { FlowView } from "@/canvas/FlowView";
import { cn } from "@/lib/utils";
import { tokens as fmtTokens, usd } from "@/lib/format";
import type { SystemDoc } from "@/model/types";
import { simulate, stateAt, type SimEvent } from "@/run/simulate";
import { useSystems } from "@/store/systems";

function useNames(doc: SystemDoc) {
  return useMemo(() => {
    const m = new Map(doc.nodes.map((n) => [n.id, { name: "name" in n.data ? n.data.name : n.id, kind: n.data.kind }]));
    return (id: string) => m.get(id) ?? { name: id, kind: "agent" as const };
  }, [doc]);
}

function TimelineItem({ e, nameOf }: { e: SimEvent; nameOf: ReturnType<typeof useNames> }) {
  const time = <span className="text-[11px] text-muted-foreground">t+{e.t.toFixed(1)}s</span>;
  const who = (id: string) => {
    const n = nameOf(id);
    return <EntityAvatar kind={n.kind === "agent" ? "agent" : "system"} id={id} name={n.name} className="h-8 w-8 text-[11px]" />;
  };
  switch (e.type) {
    case "message": {
      const to = nameOf(e.to);
      return (
        <li className="flex gap-3 px-3 py-2">
          {who(e.from)}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-semibold">{nameOf(e.from).name}</span>
              {time}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("rounded-full px-1.5 py-0.5", e.kind === "call" ? "bg-info/10 text-info" : e.kind === "handoff" ? "bg-warning/10 text-warning" : "bg-secondary")}>{e.kind}</span>
              <ArrowRight className="h-3 w-3" />
              {to.kind === "channel" ? (
                <span className="flex items-center">
                  <Hash className="h-3 w-3" />
                  {to.name}
                </span>
              ) : (
                <span>{to.name}</span>
              )}
            </div>
            <p className="mt-1 text-[13px]">{e.text}</p>
          </div>
        </li>
      );
    }
    case "tool":
      return (
        <li className="flex gap-3 px-3 py-1.5 pl-14">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-secondary/70 px-2.5 py-1.5 font-mono text-xs">
            <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-medium">{e.tool}</span>
            <span className="truncate text-muted-foreground">{e.args}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">→ {e.result}</span>
          </div>
        </li>
      );
    case "access":
      return (
        <li className="flex items-center gap-2 px-3 py-1 pl-14 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5" /> {nameOf(e.node).name} {e.op === "read" ? "读取" : "写入"} {nameOf(e.target).name}
          <span className="ml-auto">{time}</span>
        </li>
      );
    case "gate":
      return (
        <li className={cn("mx-3 my-1 flex items-center gap-2 rounded-lg px-3 py-2 text-xs", e.passed ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
          {e.passed ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          <span className="font-medium">Gate {e.gate}</span>
          <span>{e.reason}</span>
          <span className="ml-auto">{time}</span>
        </li>
      );
    case "approval":
      return (
        <li className="mx-3 my-1 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          <UserCheck className="h-4 w-4" />
          {e.resolved ? `${nameOf(e.node).name} 已批准` : `等待 ${nameOf(e.node).name} 审批（来自 ${nameOf(e.from).name}）`}
          <span className="ml-auto">{time}</span>
        </li>
      );
    case "spawn":
      return (
        <li className="mx-3 my-1 flex items-center gap-2 rounded-lg bg-info/10 px-3 py-2 text-xs text-info">
          <Sparkles className="h-4 w-4" />
          {nameOf(e.node).name} 招募了 {e.count} 个「{nameOf(e.template).name}」实例
          <span className="ml-auto">{time}</span>
        </li>
      );
    case "system_finished":
      return (
        <li className="mx-3 my-2 flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs">
          <CheckCircle2 className="h-4 w-4 text-success" /> 系统结束：{e.reason}
          <span className="ml-auto">{time}</span>
        </li>
      );
    default:
      return null;
  }
}

function describe(e: SimEvent, n: (id: string) => string): string {
  switch (e.type) {
    case "system_started":
      return "";
    case "status":
      return `${n(e.node)} → ${e.status}`;
    case "message":
      return `${n(e.from)} → ${n(e.to)} [${e.kind}] ${e.text}`;
    case "tool":
      return `${n(e.node)} ${e.tool}(${e.args}) → ${e.result}`;
    case "access":
      return `${n(e.node)} ${e.op} ${n(e.target)}`;
    case "gate":
      return `${e.gate} ${e.passed ? "passed" : "blocked"}: ${e.reason}`;
    case "approval":
      return `${n(e.node)} ${e.resolved ? "approved" : "requested by " + n(e.from)}`;
    case "usage":
      return `${n(e.node)} in=${e.tokens_in} out=${e.tokens_out} ${usd(e.usd)}${e.estimated ? " (估算)" : ""}`;
    case "spawn":
      return `${n(e.node)} spawned ${e.count}× ${n(e.template)}`;
    case "system_finished":
      return e.reason;
  }
}

function RunView({ doc }: { doc: SystemDoc }) {
  const systems = useSystems((s) => s.systems);
  const navigate = useNavigate();
  const sim = useMemo(() => simulate(doc), [doc]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState("2");
  const [filter, setFilter] = useState("all");
  const nameOf = useNames(doc);
  const listRef = useRef<HTMLDivElement>(null);
  const total = sim.events.length;

  useEffect(() => {
    if (!playing || idx >= total) return;
    const cur = sim.events[idx - 1]?.t ?? 0;
    const next = sim.events[idx]?.t ?? cur;
    const ms = Math.min(1500, Math.max(60, ((next - cur) * 1000) / Number(speed)));
    const h = setTimeout(() => setIdx((i) => i + 1), ms);
    return () => clearTimeout(h);
  }, [playing, idx, total, speed, sim.events]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [idx, filter]);

  const st = useMemo(() => stateAt(sim.events, idx), [sim.events, idx]);
  const shown = sim.events.slice(0, idx).filter((e) => {
    if (e.type === "usage" || e.type === "status" || e.type === "system_started") return false;
    if (filter === "all") return true;
    if (e.type === "message") return e.from === filter || e.to === filter || e.room === filter;
    if ("node" in e) return e.node === filter;
    return false;
  });
  const elapsed = sim.events[idx - 1]?.t ?? 0;
  const done = idx >= total;
  const modelLabel = (id: string) => doc.models.find((m) => m.id === id)?.model ?? id;
  const filterItems = [
    { value: "all", label: "全部消息" },
    ...doc.nodes.filter((n) => n.data.kind === "channel").map((n) => ({ value: n.id, label: `# ${nameOf(n.id).name}` })),
    ...doc.nodes.filter((n) => n.data.kind === "agent" || n.data.kind === "human").map((n) => ({ value: n.id, label: nameOf(n.id).name })),
  ];

  return (
    <CanvasContext.Provider value={{ modelLabel }}>
      <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:p-4">
        <div className="glass-panel flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <EntityAvatar kind="run" id={doc.id} name={doc.name} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Select value={doc.id} onValueChange={(id) => navigate(`/runs/${id}`)} items={systems.map((s) => ({ value: s.id, label: s.name }))} ariaLabel="选择系统" className="max-w-56 font-semibold" />
                <StatusBadge status={done ? "completed" : playing ? "running" : "paused"} label={done ? "已结束" : playing ? "运行中" : "已暂停"} />
              </div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <FlaskConical className="h-3 w-3" /> 模拟运行：按系统结构生成事件，没有调用任何模型
              </p>
            </div>
          </div>
          <dl className="flex gap-6 text-xs">
            <div>
              <dt className="text-muted-foreground">事件</dt>
              <dd className="font-medium tabular-nums">
                {idx}/{total}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">模拟时长</dt>
              <dd className="font-medium tabular-nums">{elapsed.toFixed(1)}s</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Token</dt>
              <dd className="font-medium tabular-nums">{fmtTokens(st.tokens)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">花费（按单价估算）</dt>
              <dd className="font-medium tabular-nums">
                {usd(st.spent)}
                {doc.budget.usd != null && <span className="text-muted-foreground"> / ${doc.budget.usd}</span>}
              </dd>
            </div>
          </dl>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPlaying(!playing)} disabled={done} aria-label={playing ? "暂停" : "播放"}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setIdx((i) => Math.min(total, i + 1))} disabled={done} aria-label="下一个事件">
              <SkipForward className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { setIdx(0); setPlaying(true); }} aria-label="重新开始">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Select value={speed} onValueChange={setSpeed} size="sm" ariaLabel="速度" items={[{ value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "5", label: "5×" }, { value: "20", label: "20×" }]} />
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/canvas/${doc.id}`}>
                <Workflow className="mr-1.5 h-3.5 w-3.5" /> 编辑
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <section className="glass-panel relative min-h-[320px] flex-1 overflow-hidden rounded-xl">
            <FlowView
              doc={doc}
              readOnly
              status={st.status}
              activeEdges={st.activeEdges}
              blockedEdges={st.blockedEdges}
              onSelect={(s) => setFilter(s.nodeId ?? "all")}
            />
          </section>
          <section className="glass-panel flex min-h-[320px] w-full flex-col overflow-hidden rounded-xl lg:w-[420px]">
            <Tabs defaultValue="timeline" className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 px-3 pt-3">
                <TabsList>
                  <TabsTrigger value="timeline">消息</TabsTrigger>
                  <TabsTrigger value="cost">成本</TabsTrigger>
                  <TabsTrigger value="events">事件流</TabsTrigger>
                </TabsList>
                <Select value={filter} onValueChange={setFilter} items={filterItems} ariaLabel="筛选" size="sm" className="ml-auto max-w-40" />
              </div>
              <TabsContent value="timeline" className="mt-2 min-h-0 flex-1">
                <div ref={listRef} className="h-full overflow-y-auto pb-3">
                  {shown.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">{idx === 0 ? "准备开始…" : "这个筛选下还没有消息"}</p>
                  ) : (
                    <ul>
                      {shown.map((e, i) => (
                        <TimelineItem key={i} e={e} nameOf={nameOf} />
                      ))}
                    </ul>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="cost" className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1.5 font-medium">Agent</th>
                      <th className="py-1.5 text-right font-medium">调用</th>
                      <th className="py-1.5 text-right font-medium">输入</th>
                      <th className="py-1.5 text-right font-medium">输出</th>
                      <th className="py-1.5 text-right font-medium">美元</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {Object.entries(st.perAgent)
                      .sort((a, b) => b[1].usd - a[1].usd)
                      .map(([id, p]) => (
                        <tr key={id} className="border-t border-border/70">
                          <td className="py-1.5">{nameOf(id).name}</td>
                          <td className="py-1.5 text-right">{p.calls}</td>
                          <td className="py-1.5 text-right">{fmtTokens(p.tokens_in)}</td>
                          <td className="py-1.5 text-right">{fmtTokens(p.tokens_out)}</td>
                          <td className="py-1.5 text-right">
                            {usd(p.usd)}
                            {p.estimated && <span className="text-muted-foreground" title="harness 不上报成本，平台按单价估算">*</span>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <p className="mt-3 text-[11px] text-muted-foreground">* 该 harness 不上报成本，由平台按模型单价估算。模拟中的 token 数是随机生成的，只用于展示界面。</p>
              </TabsContent>
              <TabsContent value="events" className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                <ol className="space-y-0.5 font-mono text-[11px]">
                  {sim.events.slice(0, idx).map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-12 shrink-0 text-right text-muted-foreground">{e.t.toFixed(1)}</span>
                      <span className="w-24 shrink-0 text-info">{e.type}</span>
                      <span className="min-w-0 break-words">{describe(e, (id) => nameOf(id).name)}</span>
                    </li>
                  ))}
                </ol>
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </div>
    </CanvasContext.Provider>
  );
}

export function RunsPage() {
  const { systemId } = useParams();
  const systems = useSystems((s) => s.systems);
  if (!systemId) return systems.length ? <Navigate to={`/runs/${systems[0].id}`} replace /> : <Navigate to="/" replace />;
  const doc = systems.find((s) => s.id === systemId);
  if (!doc) return <Navigate to="/" replace />;
  return (
    <ReactFlowProvider key={doc.id}>
      <RunView doc={doc} />
    </ReactFlowProvider>
  );
}
