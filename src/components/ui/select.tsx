// A designed select (Radix Select: keyboard, type-ahead, screen-reader listbox) in the
// affectUI style -- a pill trigger with a hairline ring, a ringed popover, and options that
// can carry a leading mark (status dot, icon) and a muted hint. Replaces native <select>.
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectItemSpec {
  value: string;
  label: string;
  /** muted text after the label (status, age, …) */
  hint?: string;
  leading?: React.ReactNode;
}

// Radix reserves "" for "no value"; callers keep using "" and never see this.
const EMPTY = "__select_empty__";
const enc = (v: string) => (v === "" ? EMPTY : v);
const dec = (v: string) => (v === EMPTY ? "" : v);

export function Select({
  value,
  onValueChange,
  items,
  ariaLabel,
  placeholder = "Select…",
  size = "md",
  variant = "control",
  className,
  contentClassName,
  disabled,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: SelectItemSpec[];
  ariaLabel: string;
  placeholder?: string;
  size?: "sm" | "md";
  /** control: pill with a hairline ring · field: filled property-panel field */
  variant?: "control" | "field";
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
}) {
  const current = items.find((i) => i.value === value);
  return (
    <SelectPrimitive.Root value={enc(value)} onValueChange={(v) => onValueChange(dec(v))} disabled={disabled || items.length === 0}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          variant === "field" ? "prop-field inline-flex min-w-0 items-center gap-2 text-left font-normal outline-none" : "glass-control inline-flex min-w-0 items-center gap-2 text-left font-medium outline-none",
          "focus-visible:shadow-[0_0_0_1px_hsl(var(--ring)),0_0_0_4px_hsl(var(--ring)/0.18)] disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=open]:bg-secondary",
          variant === "field" ? (size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-2.5 text-[13px]") : size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-[13px]",
          className,
        )}
      >
        {current?.leading && <span className="flex shrink-0 items-center">{current.leading}</span>}
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value placeholder={placeholder}>{current ? current.label : <span className="font-normal text-muted-foreground">{placeholder}</span>}</SelectPrimitive.Value>
        </span>
        {current?.hint && size === "md" && current.hint.length <= 18 && <span className="shrink-0 font-normal text-muted-foreground">{current.hint}</span>}
        <SelectPrimitive.Icon asChild>
          <ChevronsUpDown aria-hidden="true" className={cn("shrink-0 text-muted-foreground", size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "glass-overlay z-50 max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl p-1 text-popover-foreground",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport className="p-0.5">
            {items.map((it) => (
              <SelectPrimitive.Item
                key={it.value}
                value={enc(it.value)}
                className={cn(
                  "relative flex cursor-default select-none items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-8 outline-none",
                  size === "sm" ? "text-xs" : "text-[13px]",
                  "data-[highlighted]:bg-secondary data-[state=checked]:font-medium",
                )}
              >
                {it.leading && <span className="flex shrink-0 items-center">{it.leading}</span>}
                {it.hint && it.hint.length > 18 ? (
                  <span className="flex min-w-0 flex-col">
                    <SelectPrimitive.ItemText>{it.label}</SelectPrimitive.ItemText>
                    <span className="max-w-[22rem] text-[11px] font-normal text-muted-foreground">{it.hint}</span>
                  </span>
                ) : (
                  <>
                    <SelectPrimitive.ItemText>{it.label}</SelectPrimitive.ItemText>
                    {it.hint && <span className="ml-auto pl-3 text-muted-foreground">{it.hint}</span>}
                  </>
                )}
                <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex items-center">
                  <Check aria-hidden="true" className="h-3.5 w-3.5" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
