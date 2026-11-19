// The body shared by simulated and live runs: the canvas with live status on
// the left, the message log / cost / raw events on the right.
import { envLiveAt, groupRoundsAt } from "@/run/envLive";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FlowView } from "@/canvas/FlowView";
import type { SystemDoc } from "@/model/types";
import type { RunEvent } from "@/run/events";
import { roundsOf } from "@/run/rounds";
import { stateAt } from "@/run/simulate";
import { Breadcrumb } from "../canvas/Breadcrumb";
import { CostTable } from "./CostTable";
import { RoundsTable } from "./RoundsTable";
import { describe, TimelineItem, useNames } from "./Timeline";

export function RunPanels({ doc, events, upto = events.length, top, empty, estimatedNote }: { doc: SystemDoc; events: RunEvent[]; upto?: number; top?: ReactNode; empty: string; estimatedNote?: string }) {
  const [filter, setFilter] = useState("all");
  const [scope, setScope] = useState<string | undefined>();
  const nameOf = useNames(doc);
  const listRef = useRef<HTMLDivElement>(null);
  const st = useMemo(() => stateAt(events, upto, doc), [events, upto, doc]);
  const envLive = useMemo(() => envLiveAt(events, upto, doc), [events, upto, doc]);
  const groupRounds = useMemo(() => groupRoundsAt(events, upto, doc), [events, upto, doc]);
  // groups that repeat: their rounds, as far as the replay has got
  const rounds = useMemo(() => roundsOf(events.slice(0, upto), doc), [events, upto, doc]);
  const shown = events.slice(0, upto).filter((e) => {
    if (e.type === "usage" || e.type === "status" || e.type === "system_started") return false;
    if (filter === "all") return true;
    if (e.type === "message") return e.from === filter || e.to === filter || e.room === filter;
    if (e.type === "human_request") return e.request.node === filter || e.request.from === filter;
    if ("node" in e) return e.node === filter;
    if (e.type === "transform") return e.at === filter;
    return false;
  });
  const lastLen = useRef(0);
  useEffect(() => {
    const el = listRef.current;
    // follow the end while near it, and after a jump (skip to end)
    const jumped = shown.length - lastLen.current > 5;
    lastLen.current = shown.length;
    if (el && (jumped || el.scrollHeight - el.scrollTop - el.clientHeight < 240)) el.scrollTo({ top: el.scrollHeight, behavior: jumped ? "auto" : "smooth" });
  }, [shown.length]);
  const filterItems = [
    { value: "all", label: "All messages" },
    ...doc.nodes.filter((n) => n.data.kind === "env" && n.data.env_kind === "room").map((n) => ({ value: n.id, label: `# ${nameOf(n.id).name}` })),
    ...doc.nodes.filter((n) => ["agent", "human", "model", "function"].includes(n.data.kind)).map((n) => ({ value: n.id, label: nameOf(n.id).name })),
  ];
  return (
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
          live={envLive}
          rounds={groupRounds}
          activeEdges={st.activeEdges}
          blockedEdges={st.blockedEdges}
          onSelect={(s) => setFilter(s.nodeId ?? "all")}
        />
      </section>
      <section className="glass-panel flex min-h-[320px] w-full flex-col overflow-hidden rounded-xl lg:w-[440px]">
        {top}
        <Tabs defaultValue="timeline" className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 px-3 pt-3">
            <TabsList>
              <TabsTrigger value="timeline">Messages</TabsTrigger>
              {rounds.length > 0 && <TabsTrigger value="rounds">Rounds</TabsTrigger>}
              <TabsTrigger value="cost">Cost</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
            </TabsList>
            <Select value={filter} onValueChange={setFilter} items={filterItems} ariaLabel="Filter" size="sm" className="ml-auto max-w-40" />
          </div>
          <TabsContent value="timeline" className="mt-2 min-h-0 flex-1">
            <div ref={listRef} className="h-full overflow-y-auto pb-3">
              {shown.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">{empty}</p>
              ) : (
                <ul>
                  {shown.map((e, i) => (
                    <TimelineItem key={i} e={e} nameOf={nameOf} />
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>
          {rounds.length > 0 && (
            <TabsContent value="rounds" className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <RoundsTable groups={rounds} nameOf={(id) => nameOf(id).name} />
            </TabsContent>
          )}
          <TabsContent value="cost" className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <CostTable perAgent={st.perAgent} nameOf={nameOf} note={estimatedNote} />
          </TabsContent>
          <TabsContent value="events" className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <ol className="space-y-0.5 font-mono text-[11px]">
              {events.slice(0, upto).map((e, i) => (
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
  );
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}
