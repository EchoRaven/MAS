// A simulated run: events generated from the system's structure and played
// back. No model is called; works without a server.
import { useMemo } from "react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { tokens as fmtTokens, usd } from "@/lib/format";
import type { SystemDoc } from "@/model/types";
import { simulate, stateAt } from "@/run/simulate";
import { RunPanels, Stat } from "./RunPanels";
import { useReplay } from "./useReplay";

export function SimRun({ doc, bar }: { doc: SystemDoc; bar: (status: React.ReactNode, controls: React.ReactNode, stats: React.ReactNode) => React.ReactNode }) {
  const sim = useMemo(() => simulate(doc), [doc]);
  const { idx, playing, done, total, controls } = useReplay(sim.events);
  const st = useMemo(() => stateAt(sim.events, idx, doc), [sim.events, idx, doc]);
  return (
    <>
      {bar(
        <StatusBadge status={done ? "completed" : playing ? "running" : "paused"} label={done ? "Finished" : playing ? "Playing" : "Paused"} />,
        controls,
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
