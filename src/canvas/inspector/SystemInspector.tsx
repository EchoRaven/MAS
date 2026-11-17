import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SystemDoc } from "@/model/types";
import type { Issue } from "@/model/validate";
import { AreaField, Chips, NumberField, opts, Section, SelectField, TextField } from "../fields";
import { AddButton, Body, IssueList, type Update } from "./shared";

const TERMINATION = [
  { value: "any_agent_calls_finish", label: "An agent calls finish" },
  { value: "all_idle", label: "All idle" },
  { value: "budget_exceeded", label: "Budget exceeded" },
  { value: "max_rounds", label: "Max rounds reached" },
  { value: "judge_outputs_verdict", label: "Judge returns a verdict" },
];

export function SystemInspector({ doc, update, issues, onPick }: { doc: SystemDoc; update: Update; issues: Issue[]; onPick: (i: Issue) => void }) {
  const set = (patch: Partial<SystemDoc>) => update((d) => ({ ...d, ...patch }));
  return (
    <>
      <div className="border-b border-border/70 px-4 py-3">
        <p className="text-sm font-semibold">System settings</p>
        <p className="text-xs text-muted-foreground">Select something on the canvas to edit it</p>
      </div>
      <Body>
        <TextField label="Name" value={doc.name} onChange={(name) => set({ name })} />
        <AreaField label="Description" value={doc.description} onChange={(description) => set({ description })} rows={3} />
        <Section title="Budget">
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="USD" value={doc.budget.usd} onChange={(usd) => set({ budget: { ...doc.budget, usd } })} step={0.5} />
            <NumberField label="Rounds" value={doc.budget.max_rounds} onChange={(max_rounds) => set({ budget: { ...doc.budget, max_rounds } })} />
            <NumberField label="Minutes" value={doc.budget.wallclock_min} onChange={(wallclock_min) => set({ budget: { ...doc.budget, wallclock_min } })} />
          </div>
        </Section>
        <Chips label="Termination (stops when any is met)" options={TERMINATION} value={doc.termination} onChange={(termination) => set({ termination })} />
        <Section title="System policies" aside={<AddButton onClick={() => set({ policies: [...doc.policies, { id: `p${Date.now() % 100000}`, on: "usage", condition: "", action: "notify" }] })} />}>
          {doc.policies.length === 0 && <p className="text-xs text-muted-foreground">No system policies. Gates live on edges.</p>}
          {doc.policies.map((p, i) => {
            const setP = (patch: Partial<typeof p>) => set({ policies: doc.policies.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={p.id} className="space-y-2 rounded-lg p-3 shadow-[0_0_0_1px_hsl(var(--border))]">
                <div className="flex items-center gap-2">
                  <span className="w-5 text-xs text-muted-foreground">on</span>
                  <input className="glass-input h-8 min-w-0 flex-1 px-2 font-mono text-xs" value={p.on} onChange={(e) => setP({ on: e.target.value })} aria-label="Event" />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => set({ policies: doc.policies.filter((_, j) => j !== i) })} aria-label="Delete policy">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 text-xs text-muted-foreground">if</span>
                  <input className="glass-input h-8 min-w-0 flex-1 px-2 font-mono text-xs" value={p.condition} onChange={(e) => setP({ condition: e.target.value })} aria-label="Condition" />
                </div>
                <SelectField label="do" value={p.action} onChange={(action) => setP({ action })} items={opts([["terminate", "terminate"], ["suspend", "suspend"], ["notify", "notify"], ["block", "block"], ["require_approval", "require_approval"]])} />
              </div>
            );
          })}
        </Section>
        <Section title={`Issues (${issues.length})`}>{issues.length === 0 ? <p className="text-xs text-success">No issues found.</p> : <IssueList issues={issues} onPick={onPick} />}</Section>
      </Body>
    </>
  );
}
