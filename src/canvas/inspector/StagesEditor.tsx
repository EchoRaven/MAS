import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Pipeline, Processor, ProcessorOp, SystemDoc } from "@/model/types";
import { NumberField, opts, Section, SelectField } from "../fields";
import { emptyFn, FunctionEditor } from "./FunctionEditor";
import { AddButton } from "./shared";

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
export function StagesEditor({ pipeline, onChange, doc, focus }: { pipeline: Pipeline; onChange: (p: Pipeline) => void; doc: SystemDoc; focus?: string }) {
  const list = (which: "pre" | "post") => {
    const stages = pipeline[which];
    const set = (next: Processor[]) => onChange({ ...pipeline, [which]: next });
    const setAt = (i: number, patch: Partial<Processor>) => set(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    const move = (i: number, d: -1 | 1) => {
      const next = [...stages];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      set(next);
    };
    return (
      <Section title={which === "pre" ? "Input stages" : "Output stages"} aside={<AddButton onClick={() => set([...stages, newStage(which === "pre" ? "redact" : "parse_json", stages.length)])} />}>
        {stages.length === 0 && <p className="text-xs text-muted-foreground">{which === "pre" ? "Input reaches the harness as it arrives." : "Replies leave as the harness returns them."}</p>}
        <ol className="space-y-2">
          {stages.map((s, i) => (
            <li key={s.id} id={`stage-${which}-${i}`} className={`space-y-2 rounded-lg p-2.5 shadow-[0_0_0_1px_hsl(var(--border))] ${focus === `${which}:${i}` ? "ring-2 ring-ring" : ""}`}>
              <div className="flex items-center gap-1.5">
                <span className="w-4 text-center text-[11px] text-muted-foreground">{i + 1}</span>
                <Input value={s.name} onChange={(e) => setAt(i, { name: e.target.value })} aria-label="Stage name" className="h-8 min-w-0 flex-1 text-xs" />
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label="Move down" className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => set(stages.filter((_, j) => j !== i))} aria-label="Delete stage" className="rounded p-1 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <SelectField<ProcessorOp>
                label="Does"
                value={s.op}
                onChange={(op) => setAt(i, { ...newStage(op, i), id: s.id, name: s.name === STAGE_OPS.find((o) => o[0] === s.op)![1] ? STAGE_OPS.find((o) => o[0] === op)![1] : s.name })}
                items={STAGE_OPS.map(([value, label, hint]) => ({ value, label, hint }))}
              />
              {NEEDS_SCHEMA.includes(s.op) && (
                <>
                  <SelectField label="Schema" value={s.schema ?? "__none"} onChange={(v) => setAt(i, { schema: v === "__none" ? null : v })} items={[{ value: "__none", label: "Any JSON" }, ...doc.schemas.map((x) => ({ value: x.id, label: x.id, hint: x.description }))]} />
                  <div className="grid grid-cols-2 gap-2">
                    <SelectField label="On failure" value={s.on_fail ?? "retry"} onChange={(on_fail) => setAt(i, { on_fail })} items={opts([["retry", "Ask again"], ["drop", "Drop"], ["error", "Fail the turn"], ["fallback", "Pass through"]])} />
                    <NumberField label="Retries" value={s.max_retries} onChange={(v) => setAt(i, { max_retries: v })} />
                  </div>
                </>
              )}
              {s.fn && <FunctionEditor label="Function" fn={s.fn} onChange={(fn) => setAt(i, { fn })} doc={doc} rows={3} />}
            </li>
          ))}
        </ol>
      </Section>
    );
  };
  return (
    <div className="space-y-5">
      {list("pre")}
      {list("post")}
    </div>
  );
}
