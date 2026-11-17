// The property-panel kit every inspector is built from: compact label/control
// rows, filled fields, hints behind an info icon, collapsible sections.
import { useId, useState, type ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Select, type SelectItemSpec } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const FIELD = "prop-field h-8 w-full min-w-0 px-2.5 text-[13px] placeholder:text-muted-foreground/70";

export function Hint({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" tabIndex={-1} className="inline-flex shrink-0 text-muted-foreground/60 hover:text-foreground" aria-label="More info">
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-64 text-xs leading-snug">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function Label({ label, hint, htmlFor }: { label: string; hint?: ReactNode; htmlFor?: string }) {
  if (!label) return null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <label htmlFor={htmlFor} className="text-[12px] leading-tight text-muted-foreground">
        {label}
      </label>
      {hint && <Hint>{hint}</Hint>}
    </span>
  );
}

/** Label on the left, control on the right. `stacked` puts the label above (long controls). */
export function Field({ label, hint, children, stacked, className, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; stacked?: boolean; className?: string; htmlFor?: string }) {
  if (stacked || !label) {
    return (
      <div className={cn("space-y-1.5", className)}>
        <Label label={label} hint={hint} htmlFor={htmlFor} />
        {children}
      </div>
    );
  }
  return (
    <div className={cn("grid min-h-8 grid-cols-[104px_minmax(0,1fr)] items-center gap-x-3", className)}>
      <Label label={label} hint={hint} htmlFor={htmlFor} />
      {children}
    </div>
  );
}

export function TextField({ label, value, onChange, hint, placeholder, mono, stacked }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; placeholder?: string; mono?: boolean; stacked?: boolean }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} stacked={stacked} htmlFor={id}>
      <input id={id} value={value} placeholder={placeholder} spellCheck={!mono} onChange={(e) => onChange(e.target.value)} className={cn(FIELD, mono && "font-mono text-xs")} />
    </Field>
  );
}

export function NumberField({ label, value, onChange, hint, placeholder, step }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; hint?: ReactNode; placeholder?: string; step?: number }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        type="number"
        step={step}
        value={value ?? ""}
        placeholder={placeholder ?? "No limit"}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={cn(FIELD, "tabular-nums")}
      />
    </Field>
  );
}

export function AreaField({ label, value, onChange, hint, rows = 5, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; rows?: number; placeholder?: string; mono?: boolean }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} stacked htmlFor={id}>
      <textarea
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        spellCheck={!mono}
        onChange={(e) => onChange(e.target.value)}
        className={cn("prop-field block w-full resize-y px-2.5 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/70", mono && "font-mono text-xs")}
      />
    </Field>
  );
}

export function SelectField<T extends string>({ label, value, onChange, items, hint, stacked }: { label: string; value: T; onChange: (v: T) => void; items: SelectItemSpec[]; hint?: ReactNode; stacked?: boolean }) {
  return (
    <Field label={label} hint={hint} stacked={stacked}>
      <Select variant="field" value={value} onValueChange={(v) => onChange(v as T)} items={items} ariaLabel={label || "Choose"} className="w-full" />
    </Field>
  );
}

/** Multi-select pills. */
export function Chips<T extends string>({ label, options, value, onChange, hint }: { label: string; options: { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint} stacked>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className={cn(
                "h-6 rounded-md px-2 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-foreground text-background" : "bg-secondary/65 text-secondary-foreground hover:bg-secondary",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-[18px] w-8 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", checked ? "bg-foreground" : "bg-input")}
    >
      <span className={cn("absolute left-0 top-[2px] h-3.5 w-3.5 rounded-full bg-background shadow-sm transition-transform", checked ? "translate-x-[16px]" : "translate-x-[2px]")} />
    </button>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1">
        <span className="text-[13px] leading-tight">{label}</span>
        {hint && <Hint>{hint}</Hint>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** A titled group, separated by a hairline, collapsible. */
export function Section({ title, children, aside, defaultOpen = true }: { title: string; children: ReactNode; aside?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="-mx-4 border-t border-border/60 px-4 pb-3 pt-1 first:border-t-0">
      <div className="flex h-9 items-center justify-between">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1 text-[12px] font-semibold text-foreground">
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")} />
          {title}
        </button>
        {open && aside}
      </div>
      {open && <div className="space-y-2">{children}</div>}
    </section>
  );
}

export const opts = (pairs: [string, string, string?][]): SelectItemSpec[] => pairs.map(([value, label, hint]) => ({ value, label, hint }));
