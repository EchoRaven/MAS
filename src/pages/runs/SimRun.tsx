// A simulated run: events generated from the system's structure and played
// back. No model is called; works without a server.
import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { tokens as fmtTokens, usd } from "@/lib/format";
import type { SystemDoc } from "@/model/types";
import { simulate, stateAt } from "@/run/simulate";
import { RunPanels, Stat } from "./RunPanels";

export function SimRun({ doc, bar }: { doc: SystemDoc; bar: (status: React.ReactNode, controls: React.ReactNode, stats: React.ReactNode) => React.ReactNode }) {
  const sim = useMemo(() => simulate(doc), [doc]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState("2");
  const total = sim.events.length;

  useEffect(() => {
    if (!playing || idx >= total) return;
    const cur = sim.events[idx - 1]?.t ?? 0;
    const next = sim.events[idx]?.t ?? cur;
    const ms = Math.min(1500, Math.max(60, ((next - cur) * 1000) / Number(speed)));
    const h = setTimeout(() => setIdx((i) => i + 1), ms);
    return () => clearTimeout(h);
  }, [playing, idx, total, speed, sim.events]);

  const st = useMemo(() => stateAt(sim.events, idx, doc), [sim.events, idx, doc]);
  const done = idx >= total;
  return (
    <>
      {bar(
        <StatusBadge status={done ? "completed" : playing ? "running" : "paused"} label={done ? "Finished" : playing ? "Playing" : "Paused"} />,
        <>
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
        </>,
        <>
          <Stat label="Events">{idx}/{total}</Stat>
          <Stat label="Simulated time">{(sim.events[idx - 1]?.t ?? 0).toFixed(1)}s</Stat>
          <Stat label="Tokens">{fmtTokens(st.tokens)}</Stat>
          <Stat label="Spend (from prices)">{usd(st.spent)}</Stat>
        </>,
      )}
      <RunPanels doc={doc} events={sim.events} upto={idx} empty={idx === 0 ? "Starting…" : "No messages for this filter yet"} estimatedNote="Token counts in a simulation are random and only show the layout." />
    </>
  );
}
