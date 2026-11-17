// One editor for any registry step: pick a preset (or custom), fill the
// params it declares, or write the code that replaces it.
import { useState } from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CUSTOM_SIGNATURE, makeStep, optionFor, STEP_CATALOG, type ParamDef, type ParamValue, type Slot, type Step } from "@/model/steps";
import type { SystemDoc } from "@/model/types";
import { AreaField, NumberField, SelectField, TextField, Toggle } from "../fields";
import { FunctionEditor } from "./FunctionEditor";

export function ParamField({ def, value, onChange, doc }: { def: ParamDef; value: ParamValue | undefined; onChange: (v: ParamValue) => void; doc: SystemDoc }) {
  const v = value ?? def.default;
  switch (def.type) {
    case "number":
      return <NumberField label={def.label} hint={def.hint} value={typeof v === "number" ? v : null} onChange={onChange} placeholder="—" />;
    case "bool":
      return <Toggle label={def.label} hint={def.hint} checked={!!v} onChange={onChange} />;
    case "select":
      return <SelectField label={def.label} hint={def.hint} value={String(v ?? "")} onChange={onChange} items={(def.options ?? []).map((o) => ({ value: o, label: o }))} />;
    case "model": {
      const models = doc.models.filter((m) => (m.kind ?? "chat") === (def.modelKind ?? "chat"));
      return (
        <SelectField
          label={def.label}
          hint={def.hint ?? (models.length ? undefined : `Add a ${def.modelKind} model under Library`)}
          value={String(v ?? models[0]?.id ?? "")}
          onChange={onChange}
          items={models.map((m) => ({ value: m.id, label: m.id, hint: m.model }))}
        />
      );
    }
    case "prompt":
      return <AreaField label={def.label} hint={def.hint} value={String(v ?? "")} onChange={onChange} rows={3} mono />;
    case "list":
    case "text":
      return <TextField label={def.label} hint={def.hint ?? (def.type === "list" ? "Comma-separated" : undefined)} value={String(v ?? "")} onChange={onChange} mono />;
  }
}

/** A short summary of a step's settings for its collapsed row. */
function summary(slot: Slot, s: Step) {
  if (s.use === "custom") return s.fn?.lang ?? "code";
  const o = optionFor(slot, s.use);
  return (o?.params ?? [])
    .slice(0, 2)
    .map((p) => s.params?.[p.key])
    .filter((x) => x !== null && x !== undefined && x !== "")
    .join(" · ");
}

export function StepCard({ slot, step, onChange, doc, title, onRemove, defaultOpen = false }: { slot: Slot; step: Step; onChange: (s: Step) => void; doc: SystemDoc; title: string; onRemove?: () => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const opt = optionFor(slot, step.use);
  const items = [...STEP_CATALOG[slot].map((o) => ({ value: o.use, label: o.label, hint: o.hint })), { value: "custom", label: "Custom code", hint: CUSTOM_SIGNATURE[slot] }];
  return (
    <li className={cn("group/row", open && "bg-card")}>
      <div className="flex h-9 items-center gap-1.5 pl-2 pr-1">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-[74px] shrink-0 items-center gap-1 text-left text-[12px] text-muted-foreground">
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
          <span className="truncate">{title}</span>
        </button>
        <Select variant="field" size="sm" value={step.use} onValueChange={(use) => onChange(use === step.use ? step : makeStep(slot, use))} items={items} ariaLabel={`${title} method`} className="min-w-0 flex-1" />
        {!open && <span className="hidden max-w-[80px] truncate text-[11px] text-muted-foreground min-[1500px]:inline">{summary(slot, step)}</span>}
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label={`Remove ${title}`} className="flex h-7 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover/row:opacity-100">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2 px-3 pb-3 pt-0.5">
          {step.use === "custom" ? (
            <FunctionEditor label={`${title} · custom`} fn={step.fn ?? { lang: "js", code: "" }} onChange={(fn) => onChange({ ...step, fn })} doc={doc} rows={5} hint={CUSTOM_SIGNATURE[slot]} />
          ) : opt && opt.params.length ? (
            opt.params.map((p) => <ParamField key={p.key} def={p} value={step.params?.[p.key]} onChange={(v) => onChange({ ...step, params: { ...(step.params ?? {}), [p.key]: v } })} doc={doc} />)
          ) : (
            <p className="text-[12px] text-muted-foreground">{opt?.hint ?? "No settings."}</p>
          )}
        </div>
      )}
    </li>
  );
}
