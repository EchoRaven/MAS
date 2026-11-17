import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Pipeline, Processor, ProcessorOp, SystemDoc } from "@/model/types";
import { NumberField, opts, Section, SelectField, TextField } from "../fields";
import { emptyFn, FunctionEditor } from "./FunctionEditor";
import { AddButton, RowList } from "./shared";

export const STAGE_OPS: [ProcessorOp, string, string][] = [
  ["parse_json", "Parse JSON", "Parse the reply, optionally against a schema"],
  ["validate", "Validate", "Check the value against a schema"],
  ["transform", "Transform", "Map the value with a function"],
  ["filter", "Filter", "Drop it unless the function returns true"],
  ["route", "Route", "Pick an output port: return { <port>: value }"],
  ["redact", "Redact", "Remove secrets and personal data"],
  ["summarize", "Summarize", "Shorten long input before the model sees it"],
];

const NEEDS_FN: ProcessorOp[] = ["transform", "filter", "route", "summarize"];
const NEEDS_SCHEMA: ProcessorOp[] = ["parse_json", "validate"];

function newStage(op: ProcessorOp, n: number): Processor {
  const label = STAGE_OPS.find((o) => o[0] === op)![1];
  return {
    id: `s${Date.now() % 100000}${n}`,
    op,
    name: label,
    fn: NEEDS_FN.includes(op) ? (op === "route" ? emptyFn("js", "return { out: input };") : op === "summarize" ? emptyFn("llm", "Summarise in under 200 words:\n{{input}}") : emptyFn()) : null,
    schema: null,
    on_fail: NEEDS_SCHEMA.includes(op) ? "retry" : undefined,
    max_retries: NEEDS_SCHEMA.includes(op) ? 2 : undefined,
  };
}

/**
 * The agent's wrapper. Input stages run on every incoming value before the
 * harness sees it; output stages run on every reply before it leaves a port.
 */
function StageRow({ s, i, count, doc, open, onToggle, setAt, move, remove }: { s: Processor; i: number; count: number; doc: SystemDoc; open: boolean; onToggle: () => void; setAt: (patch: Partial<Processor>) => void; move: (d: -1 | 1) => void; remove: () => void }) {
  const opLabel = (op: ProcessorOp) => STAGE_OPS.find((o) => o[0] === op)![1];
  const summary = s.schema ? s.schema : s.fn ? s.fn.lang : "";
  return (
    <li className={cn("group/row", open && "bg-card")}>
      <div className="flex h-9 items-center gap-1.5 pl-2 pr-1">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-secondary text-[10px] font-medium tabular-nums text-muted-foreground">{i + 1}</span>
          <span className="min-w-0 truncate text-[13px]">{s.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{opLabel(s.op).toLowerCase()}{summary ? ` · ${summary}` : ""}</span>
        </button>
        <div className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
          <button type="button" disabled={i === 0} onClick={() => move(-1)} aria-label="Move up" className="flex h-7 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={i === count - 1} onClick={() => move(1)} aria-label="Move down" className="flex h-7 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={remove} aria-label="Delete stage" className="flex h-7 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {open && (
        <div className="space-y-2 px-3 pb-3 pt-0.5">
          <TextField label="Name" value={s.name} onChange={(name) => setAt({ name })} />
          <SelectField<ProcessorOp>
            label="Does"
            value={s.op}
            onChange={(op) => setAt({ ...newStage(op, i), id: s.id, name: s.name === opLabel(s.op) ? opLabel(op) : s.name })}
            items={STAGE_OPS.map(([value, label, hint]) => ({ value, label, hint }))}
          />
          {NEEDS_SCHEMA.includes(s.op) && (
            <>
              <SelectField label="Schema" value={s.schema ?? "__none"} onChange={(v) => setAt({ schema: v === "__none" ? null : v })} items={[{ value: "__none", label: "Any JSON" }, ...doc.schemas.map((x) => ({ value: x.id, label: x.id }))]} />
              <SelectField label="On failure" value={s.on_fail ?? "retry"} onChange={(on_fail) => setAt({ on_fail })} items={opts([["retry", "Ask again"], ["drop", "Drop"], ["error", "Fail the turn"], ["fallback", "Pass through"]])} />
              <NumberField label="Retries" value={s.max_retries} onChange={(v) => setAt({ max_retries: v })} />
            </>
          )}
          {s.fn && <FunctionEditor label="Function" fn={s.fn} onChange={(fn) => setAt({ fn })} doc={doc} rows={3} />}
        </div>
      )}
    </li>
  );
}

/**
 * The agent's wrapper. Input stages run on every incoming value before the
 * harness sees it; output stages run on every reply before it leaves a port.
 */
export function StagesEditor({ pipeline, onChange, doc, focus }: { pipeline: Pipeline; onChange: (p: Pipeline) => void; doc: SystemDoc; focus?: string }) {
  const [open, setOpen] = useState<string | undefined>(focus);
  useEffect(() => setOpen(focus), [focus]);
  const list = (which: "pre" | "post") => {
    const stages = pipeline[which];
    const set = (next: Processor[]) => onChange({ ...pipeline, [which]: next });
    return (
      <Section
        title={which === "pre" ? "Input stages" : "Output stages"}
        aside={
          <AddButton
            label={`Add ${which === "pre" ? "input" : "output"} stage`}
            onClick={() => {
              set([...stages, newStage(which === "pre" ? "redact" : "parse_json", stages.length)]);
              setOpen(`${which}:${stages.length}`);
            }}
          />
        }
      >
        <RowList empty={which === "pre" ? "Input reaches the harness as it arrives." : "Replies leave as the harness returns them."}>
          {stages.map((s, i) => (
            <StageRow
              key={s.id}
              s={s}
              i={i}
              count={stages.length}
              doc={doc}
              open={open === `${which}:${i}`}
              onToggle={() => setOpen(open === `${which}:${i}` ? undefined : `${which}:${i}`)}
              setAt={(patch) => set(stages.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
              move={(d) => {
                const next = [...stages];
                [next[i], next[i + d]] = [next[i + d], next[i]];
                set(next);
                setOpen(`${which}:${i + d}`);
              }}
              remove={() => set(stages.filter((_, j) => j !== i))}
            />
          ))}
        </RowList>
      </Section>
    );
  };
  return (
    <>
      {list("pre")}
      {list("post")}
    </>
  );
}
