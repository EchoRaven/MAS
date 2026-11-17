// Demos: real recorded runs of the paper reproductions, replayable by anyone
// (static files under /demos, no server needed).
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { usd } from "@/lib/format";
import { TEMPLATES } from "@/model/templates";
import { DemoView } from "./DemoView";
import { loadJson, type Demo, type DemoSummary } from "./types";

export function DemosPage() {
  const { demoId } = useParams();
  const navigate = useNavigate();
  const [index, setIndex] = useState<DemoSummary[] | null>(null);
  const [demo, setDemo] = useState<Demo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadJson<DemoSummary[]>("/demos/index.json")
      .then((list) => setIndex(list.sort((a, b) => order(a.id) - order(b.id))))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!demoId) return;
    setDemo(null);
    loadJson<Demo>(`/demos/${encodeURIComponent(demoId)}.json`)
      .then(setDemo)
      .catch((e) => setError(e.message));
  }, [demoId]);

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!index) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (!demoId) return index.length ? <Navigate to={`/demos/${index[0].id}`} replace /> : <p className="p-6 text-sm text-muted-foreground">No demos recorded yet.</p>;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:flex-row md:p-4">
      <nav aria-label="Demos" className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto md:flex">
        <p className="px-2 pb-1 text-xs text-muted-foreground">Papers reproduced and run for real</p>
        {index.map((d) => {
          const paper = TEMPLATES.find((t) => t.id === d.id)?.paper;
          return (
            <Link key={d.id} to={`/demos/${d.id}`} aria-current={d.id === demoId ? "page" : undefined} className={cn("rounded-lg px-3 py-2 transition-colors hover:bg-secondary", d.id === demoId && "bg-active")}>
              <p className="text-[13px] font-medium">{d.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {paper ? `${paper.authors}, ${paper.year} · ` : ""}
                {d.calls} calls · {usd(d.usd)}
              </p>
            </Link>
          );
        })}
      </nav>
      <div className="md:hidden">
        <Select value={demoId} onValueChange={(id) => navigate(`/demos/${id}`)} items={index.map((d) => ({ value: d.id, label: d.name }))} ariaLabel="Demo" />
      </div>
      {demo ? (
        <ReactFlowProvider key={demo.id}>
          <DemoView demo={demo} />
        </ReactFlowProvider>
      ) : (
        <p className="p-6 text-sm text-muted-foreground">Loading the recording…</p>
      )}
    </div>
  );
}

// simplest first, so the list reads as a tour
const ORDER = [
  "paper-debate",
  "paper-moa",
  "paper-chateval",
  "paper-dylan",
  "paper-reflexion",
  "paper-camel",
  "paper-autogen",
  "paper-agentverse",
  "paper-agentcoder",
  "paper-mapcoder",
  "paper-voyager",
  "paper-tradingagents",
  "paper-chatdev",
  "paper-metagpt",
  "paper-magentic-one",
  "paper-generative-agents",
  "paper-werewolf",
];
const order = (id: string) => (ORDER.indexOf(id) + 1 || 99);
