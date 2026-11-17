import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, type SelectItemSpec } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function TextField({ label, value, onChange, hint, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; placeholder?: string; mono?: boolean }) {
  return (
    <Field label={label} hint={hint}>
      <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cn("h-9 text-[13px]", mono && "font-mono text-xs")} />
    </Field>
  );
}

export function NumberField({ label, value, onChange, hint, placeholder, step }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; hint?: ReactNode; placeholder?: string; step?: number }) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        step={step}
        value={value ?? ""}
        placeholder={placeholder ?? "No limit"}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="h-9 text-[13px]"
      />
    </Field>
  );
}

export function AreaField({ label, value, onChange, hint, rows = 5, placeholder }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; rows?: number; placeholder?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Textarea value={value} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="text-[13px]" />
    </Field>
  );
}

export function SelectField<T extends string>({ label, value, onChange, items, hint }: { label: string; value: T; onChange: (v: T) => void; items: SelectItemSpec[]; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v as T)} items={items} ariaLabel={label} className="w-full" />
      {hint && <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** A row of toggleable pills (multi-select). */
export function Chips<T extends string>({ label, options, value, onChange, hint }: { label: string; options: { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground hover:bg-secondary/70",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {hint && <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <span className="block text-[13px]">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", checked ? "bg-foreground" : "bg-input")}
      >
        <span className={cn("absolute left-0 top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const opts = (pairs: [string, string, string?][]): SelectItemSpec[] => pairs.map(([value, label, hint]) => ({ value, label, hint }));
