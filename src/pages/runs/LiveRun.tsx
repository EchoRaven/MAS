// A real run on the server: give the input, start (or dry-run on the test
// model), watch it live, answer what it asks, stop it; earlier runs replay.
import { useMemo, useState } from "react";
import { FlaskConical, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { timeAgo, tokens as fmtTokens, usd } from "@/lib/format";
import type { SystemDoc } from "@/model/types";
import { stateAt } from "@/run/simulate";
import { HumanRequests } from "./HumanRequests";
import { RunPanels, Stat } from "./RunPanels";
import { useNames } from "./Timeline";
import { ModelWarnings } from "@/components/shared/ModelWarnings";
import { Input } from "@/components/ui/input";
import { parseVars, readVars } from "@/run/vars";
import { useLiveRun } from "./useLiveRun";

const STATUS_LABEL: Record<string, string> = { running: "Running", waiting: "Waiting for you", finished: "Finished", failed: "Failed", stopped: "Stopped" };

export function LiveRun({ doc, bar }: { doc: SystemDoc; bar: (status: React.ReactNode, controls: React.ReactNode, stats: React.ReactNode) => React.ReactNode }) {
  const live = useLiveRun(doc);
  // a demo's "Run it yourself" arrives with its task in ?input=
  const [input, setInput] = useState(() => new URLSearchParams(window.location.search).get("input") ?? "");
  const [dry, setDry] = useState(false);
  const [varsText, setVarsText] = useState("");
  const wanted = useMemo(() => readVars(doc), [doc]);
  const vars = parseVars(varsText);
  const shownDoc = live.system ?? doc;
  const nameOf = useNames(shownDoc);
  const st = useMemo(() => stateAt(live.events, live.events.length, shownDoc), [live.events, shownDoc]);
  const status = live.active ? (live.pending.length ? "waiting" : "running") : (live.record?.status ?? "");
  const wantsForce = /has \d+ error/.test(live.error);

  const composer = (
    <form
      className="space-y-2 border-b border-border/70 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void live.start(input, dry, false, vars.vars);
      }}
    >
      <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} placeholder="The task or message the run starts with" aria-label="Run input" className="text-[13px]" onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), void live.start(input, dry, false, vars.vars))} />
      <ModelWarnings doc={doc} skip={dry} hint="change the model in the system's catalog, or tick Dry run" />
      {(wanted.length > 0 || varsText) && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground" title="Values the run starts with; the system's code reads them as ctx.vars">
          Variables
          <Input value={varsText} onChange={(e) => setVarsText(e.target.value)} placeholder={wanted.map((w) => `${w}=…`).join(", ")} aria-label="Run variables" className="h-7 text-xs" />
          {vars.bad.length > 0 && <span className="shrink-0 text-destructive">not name=value: {vars.bad[0]}</span>}
        </label>
      )}
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="Every model is replaced by the built-in test model: edges, tools, gates and loops run for real, with canned text and no cost">
          <input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} />
          <FlaskConical className="h-3.5 w-3.5" /> Dry run (test model)
        </label>
        <Button size="sm" type="submit" className="ml-auto h-8" disabled={live.active}>
          <Play className="mr-1.5 h-3.5 w-3.5" /> Run
        </Button>
      </div>
      {live.error && (
        <p className="text-[12px] text-destructive">
          {live.error}
          {wantsForce && (
            <button type="button" className="ml-2 underline underline-offset-2" onClick={() => void live.start(input, dry, true, vars.vars)}>
              Run anyway
            </button>
          )}
        </p>
      )}
    </form>
  );

  return (
    <>
      {bar(
        status ? <StatusBadge status={status === "finished" ? "completed" : status === "waiting" ? "paused" : status} label={STATUS_LABEL[status] ?? status} title={live.record?.reason} /> : <StatusBadge status="pending" label="No runs yet" />,
        <>
          {live.runs.length > 0 && (
            <Select
              value={live.selected ?? ""}
              onValueChange={live.select}
              size="sm"
              ariaLabel="Run"
              className="max-w-60"
              items={live.runs.map((r) => ({ value: r.id, label: `${timeAgo(r.started_at)} · ${r.input.slice(0, 28) || "(no input)"}` }))}
            />
          )}
          {live.active ? (
            <Button variant="outline" size="sm" className="h-8" onClick={() => void live.stop()}>
              <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            live.selected && (
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Delete this run" onClick={() => void live.remove(live.selected!)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )
          )}
        </>,
        <>
          <Stat label="Events">{live.events.length}</Stat>
          <Stat label="Time">{(live.events[live.events.length - 1]?.t ?? 0).toFixed(1)}s</Stat>
          <Stat label="Tokens">{fmtTokens(st.tokens)}</Stat>
          <Stat label="Spend">
            {usd(st.spent)}
            {doc.budget.usd != null && <span className="text-muted-foreground"> / ${doc.budget.usd}</span>}
          </Stat>
        </>,
      )}
      <RunPanels
        doc={shownDoc}
        events={live.events}
        top={
          <>
            {composer}
            <HumanRequests pending={live.pending} nameOf={(id) => nameOf(id).name} onAnswer={(id, a) => void live.answer(id, a)} />
          </>
        }
        empty={live.selected ? (live.active ? "Starting…" : "Nothing to show for this filter") : "Give the run an input and press Run"}
      />
    </>
  );
}
