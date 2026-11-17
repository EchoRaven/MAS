// A contract checklist: failures and warnings first, passes folded away.
import { useState } from "react";
import { AlertTriangle, Check, ShieldCheck, ShieldX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conformance } from "@/model/conformance";

export function ConformanceReport({ c }: { c: Conformance }) {
  const [showPassed, setShowPassed] = useState(false);
  const failed = c.rules.filter((r) => !r.ok && r.severity === "error");
  const warned = c.rules.filter((r) => !r.ok && r.severity === "warning");
  const passed = c.rules.filter((r) => r.ok);
  return (
    <div className="space-y-1.5">
      <p className={cn("flex items-center gap-1.5 text-[12px] font-medium", c.passed ? "text-success" : "text-destructive")}>
        {c.passed ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldX className="h-3.5 w-3.5" />}
        {c.passed ? `Conforms to ${c.contract}` : `Does not conform to ${c.contract}: ${failed.length} rule${failed.length > 1 ? "s" : ""} fail${failed.length > 1 ? "" : "s"}`}
        <span className="font-normal text-muted-foreground">· {passed.length}/{c.rules.length} rules pass</span>
      </p>
      <ul className="space-y-0.5 text-[12px]">
        {[...failed, ...warned].map((r) => (
          <li key={r.id} className="flex gap-1.5">
            {r.severity === "error" ? <X className="mt-0.5 h-3 w-3 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />}
            <span>
              {r.label}
              {r.detail && <span className="text-muted-foreground"> — {r.detail}</span>}
            </span>
          </li>
        ))}
        {showPassed &&
          passed.map((r) => (
            <li key={r.id} className="flex gap-1.5 text-muted-foreground">
              <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
              {r.label}
            </li>
          ))}
      </ul>
      {passed.length > 0 && (
        <button type="button" onClick={() => setShowPassed(!showPassed)} className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {showPassed ? "Hide passed rules" : `Show ${passed.length} passed rules`}
        </button>
      )}
    </div>
  );
}
