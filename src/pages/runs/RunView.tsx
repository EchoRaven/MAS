import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FlaskConical, Pause, Play, RotateCcw, SkipForward, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CanvasContext } from "@/canvas/context";
import { FlowView } from "@/canvas/FlowView";
import { tokens as fmtTokens, usd } from "@/lib/format";
import type { SystemDoc } from "@/model/types";
import { simulate, stateAt } from "@/run/simulate";
import { useSystems } from "@/store/systems";
import { Breadcrumb } from "../canvas/Breadcrumb";
import { CostTable } from "./CostTable";
import { describe, TimelineItem, useNames } from "./Timeline";

export function RunView({ doc }: { doc: SystemDoc }) {
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

  const st = useMemo(() => stateAt(sim.events, idx, doc), [sim.events, idx, doc]);
  const [scope, setScope] = useState<string | undefined>();
  const shown = sim.events.slice(0, idx).filter((e) => {
    if (e.type === "usage" || e.type === "status" || e.type === "system_started") return false;
    if (filter === "all") return true;
    if (e.type === "message") return e.from === filter || e.to === filter || e.room === filter;
    if ("node" in e) return e.node === filter;
    if (e.type === "transform") return e.at === filter;
    return false;
  });
  const elapsed = sim.events[idx - 1]?.t ?? 0;
  const done = idx >= total;
  const modelLabel = (id: string) => doc.models.find((m) => m.id === id)?.model ?? id;
  const filterItems = [
    { value: "all", label: "All messages" },
    ...doc.nodes.filter((n) => n.data.kind === "env" && n.data.env_kind === "room").map((n) => ({ value: n.id, label: `# ${nameOf(n.id).name}` })),
    ...doc.nodes.filter((n) => ["agent", "human", "model", "function"].includes(n.data.kind)).map((n) => ({ value: n.id, label: nameOf(n.id).name })),
  ];

  return (
    <CanvasContext.Provider value={{ modelLabel }}>
      <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:p-4">
        <div className="glass-panel flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <EntityAvatar kind="run" id={doc.id} name={doc.name} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Select value={doc.id} onValueChange={(id) => navigate(`/runs/${id}`)} items={systems.map((s) => ({ value: s.id, label: s.name }))} ariaLabel="Select system" className="max-w-56 font-semibold" />
                <StatusBadge status={done ? "completed" : playing ? "running" : "paused"} label={done ? "Finished" : playing ? "Running" : "Paused"} />
              </div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <FlaskConical className="h-3 w-3" /> Simulated run: events are generated from the system structure; no model is called
              </p>
            </div>
          </div>
          <dl className="flex gap-6 text-xs">
            <div>
              <dt className="text-muted-foreground">Events</dt>
              <dd className="font-medium tabular-nums">
                {idx}/{total}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Simulated time</dt>
              <dd className="font-medium tabular-nums">{elapsed.toFixed(1)}s</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Token</dt>
              <dd className="font-medium tabular-nums">{fmtTokens(st.tokens)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Spend (estimated from prices)</dt>
              <dd className="font-medium tabular-nums">
                {usd(st.spent)}
                {doc.budget.usd != null && <span className="text-muted-foreground"> / ${doc.budget.usd}</span>}
              </dd>
            </div>
          </dl>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPlaying(!playing)} disabled={done} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setIdx((i) => Math.min(total, i + 1))} disabled={done} aria-label="Next event">
              <SkipForward className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { setIdx(0); setPlaying(true); }} aria-label="Restart">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Select value={speed} onValueChange={setSpeed} size="sm" ariaLabel="Speed" items={[{ value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "5", label: "5×" }, { value: "20", label: "20×" }]} />
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/canvas/${doc.id}`}>
                <Workflow className="mr-1.5 h-3.5 w-3.5" /> Edit
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <section className="glass-panel relative min-h-[320px] flex-1 overflow-hidden rounded-xl">
            <div className="absolute left-3 top-2 z-10 rounded-lg bg-card/90 backdrop-blur empty:hidden">
              <Breadcrumb doc={doc} scope={scope} onScope={setScope} />
            </div>
            <FlowView
              doc={doc}
              scope={scope}
              onOpen={(id) => doc.nodes.find((n) => n.id === id)?.data.kind === "group" && setScope(id)}
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
                  <TabsTrigger value="timeline">Messages</TabsTrigger>
                  <TabsTrigger value="cost">Cost</TabsTrigger>
                  <TabsTrigger value="events">Events</TabsTrigger>
                </TabsList>
                <Select value={filter} onValueChange={setFilter} items={filterItems} ariaLabel="Filter" size="sm" className="ml-auto max-w-40" />
              </div>
              <TabsContent value="timeline" className="mt-2 min-h-0 flex-1">
                <div ref={listRef} className="h-full overflow-y-auto pb-3">
                  {shown.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">{idx === 0 ? "Starting…" : "No messages for this filter yet"}</p>
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
                <CostTable perAgent={st.perAgent} nameOf={nameOf} />
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

