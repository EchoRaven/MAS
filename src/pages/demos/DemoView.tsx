// One recorded demo: the paper, the task, a replay of the real run on the
// canvas and in the log, the result, and how the reproduction maps.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CopyPlus, ExternalLink, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CanvasContext } from "@/canvas/context";
import { cn } from "@/lib/utils";
import { tokens as fmtTokens, usd } from "@/lib/format";
import { TEMPLATES } from "@/model/templates";
import { stateAt } from "@/run/simulate";
import { useSystems } from "@/store/systems";
import { RunPanels, Stat } from "../runs/RunPanels";
import { Clamp } from "../runs/Timeline";
import { useReplay } from "../runs/useReplay";
import type { Demo } from "./types";

type Tab = "replay" | "result" | "mapping";

function Mapping({ demo }: { demo: Demo }) {
  const t = TEMPLATES.find((x) => x.id === demo.id);
  return (
    <div className="grid gap-3 overflow-y-auto md:grid-cols-2">
      <section className="glass-panel space-y-2 rounded-xl p-4 text-[13px]">
        <h3 className="font-semibold">How the paper maps onto components</h3>
        <ul className="list-disc space-y-1.5 pl-4">{t?.notes?.mapped.map((m, i) => <li key={i}>{m}</li>)}</ul>
        <h3 className="pt-2 font-semibold">Where it differs from the paper</h3>
        <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">{t?.notes?.differs.map((m, i) => <li key={i}>{m}</li>)}</ul>
      </section>
      <section className="glass-panel space-y-2 rounded-xl p-4 text-[13px]">
        <h3 className="font-semibold">This recording</h3>
        <p className="text-muted-foreground">A real run on the MAS Studio server, recorded {new Date(demo.recorded_at).toLocaleString()}. The replay shows its events as they happened, with long waits shortened.</p>
        <table className="w-full text-xs">
          <tbody>
            {Object.entries(demo.models).map(([id, m]) => (
              <tr key={id} className="border-t border-border/70">
                <td className="py-1 font-mono text-muted-foreground">{id}</td>
                <td className="py-1 font-mono">{m}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[12px] text-muted-foreground">The template's model ids ran on these Gemini models.</p>
        {demo.changes.length > 0 && (
          <>
            <h3 className="pt-2 font-semibold">Changed for the recording</h3>
            <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">{demo.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </>
        )}
        {Object.keys(demo.vars).length > 0 && (
          <p className="text-[12px] text-muted-foreground">
            Run variables: <span className="font-mono">{JSON.stringify(demo.vars)}</span>
          </p>
        )}
      </section>
    </div>
  );
}

function Result({ demo }: { demo: Demo }) {
  const outputs = demo.events.filter((e): e is Extract<typeof e, { type: "output" }> => e.type === "output");
  const name = (id: string) => {
    const d = demo.system.nodes.find((n) => n.id === id)?.data;
    return d && "name" in d ? d.name : id;
  };
  if (!outputs.length) return <p className="p-6 text-sm text-muted-foreground">This run ended without a final output: {demo.run.reason}</p>;
  return (
    <div className="space-y-3 overflow-y-auto">
      {outputs.map((o, i) => (
        <section key={i} className="glass-panel rounded-xl p-4">
          <p className="mb-2 text-xs text-muted-foreground">
            {demo.system.nodes.find((n) => n.id === o.node)?.data.kind === "human" ? `Delivered to ${name(o.node)}` : `From ${name(o.node)}`} · t+{o.t.toFixed(0)}s
          </p>
          <Clamp text={o.text} lines={40} />
        </section>
      ))}
    </div>
  );
}

export function DemoView({ demo }: { demo: Demo }) {
  const [tab, setTab] = useState<Tab>("replay");
  const replay = useReplay(demo.events);
  const st = useMemo(() => stateAt(demo.events, replay.idx, demo.system), [demo, replay.idx]);
  const paper = TEMPLATES.find((t) => t.id === demo.id)?.paper;
  const importDoc = useSystems((s) => s.importDoc);
  const navigate = useNavigate();
  const modelLabel = (id: string) => demo.models[id] ?? demo.system.models.find((m) => m.id === id)?.model ?? id;
  const calls = demo.events.filter((e) => e.type === "usage").length;

  return (
    <CanvasContext.Provider value={{ modelLabel }}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="glass-panel space-y-2 rounded-xl px-4 py-3">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-semibold">{demo.name}</h2>
                <StatusBadge status={demo.run.status === "finished" ? "completed" : demo.run.status} label={demo.run.status === "finished" ? "Real run" : demo.run.status} title={demo.run.reason} />
              </div>
              {paper && (
                <a href={paper.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-[12px] text-info hover:underline">
                  {paper.title} — {paper.authors}, {paper.year}
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                </a>
              )}
            </div>
            <dl className="flex gap-5 text-xs">
              <Stat label="Model calls">{calls}</Stat>
              <Stat label="Tokens">{fmtTokens(demo.run.tokens)}</Stat>
              <Stat label="Cost">{usd(demo.run.usd)}</Stat>
              <Stat label="Wall time">{Math.round(demo.events[demo.events.length - 1]?.t ?? 0)}s</Stat>
            </dl>
            <Button size="sm" onClick={() => navigate(`/runs/${importDoc({ ...demo.system, name: `${demo.name} (from demo)` }).id}?input=${encodeURIComponent(demo.input)}`)} title="Copy this system and open it in Runs with the same task: run it, or change the task first">
              <PlayCircle className="mr-1.5 h-3.5 w-3.5" /> Run it yourself
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/canvas/${importDoc({ ...demo.system, name: `${demo.name} (from demo)` }).id}`)}>
              <CopyPlus className="mr-1.5 h-3.5 w-3.5" /> Open a copy on the canvas
            </Button>
          </div>
          <p className="rounded-lg bg-secondary/60 px-3 py-2 text-[13px]">
            <span className="font-medium text-muted-foreground">Task · </span>
            {demo.input}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-full bg-secondary p-0.5 text-xs" role="tablist" aria-label="Demo view">
              {(["replay", "result", "mapping"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-full px-3 py-1 transition-colors", tab === t ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {t === "replay" ? "Replay" : t === "result" ? "Result" : "How it maps"}
                </button>
              ))}
            </div>
            {tab === "replay" && (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="mr-2 text-xs tabular-nums text-muted-foreground">
                  {replay.idx}/{replay.total} events · {fmtTokens(st.tokens)} tokens
                </span>
                {replay.controls}
              </div>
            )}
          </div>
        </div>
        {tab === "replay" && <RunPanels doc={demo.system} events={demo.events} upto={replay.idx} empty="Starting…" />}
        {tab === "result" && <Result demo={demo} />}
        {tab === "mapping" && <Mapping demo={demo} />}
      </div>
    </CanvasContext.Provider>
  );
}
