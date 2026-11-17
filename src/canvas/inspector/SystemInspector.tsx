import { Trash2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { entryCandidates, entryPoints } from "@/model/entry";
import { interfaceOf, nodeName } from "@/model/ports";
import type { SystemDoc } from "@/model/types";
import type { Issue } from "@/model/validate";
import { AreaField, Chips, FIELD, NumberField, Section, SelectField, TextField } from "../fields";
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
  const auto = entryPoints({ ...doc, entry: null })[0];
  const chosen = doc.entry && doc.nodes.find((n) => n.id === doc.entry!.node);
  const entryPorts = chosen ? interfaceOf(chosen.data).inputs : [];
  return (
    <>
      <div className="border-b border-border/60 px-4 pb-3 pt-3.5">
        <p className="text-[14px] font-semibold leading-tight">System</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Select something on the canvas to edit it</p>
      </div>
      <Body>
        <TextField label="Name" value={doc.name} onChange={(name) => set({ name })} />
        <AreaField label="Description" value={doc.description} onChange={(description) => set({ description })} rows={3} />
        <Section title="Start">
          <SelectField
            label="Entry point"
            hint="Where the run's input arrives. Automatic picks a person at the edge of the system, else an on_start agent, else the component nothing feeds. The canvas marks it START."
            value={doc.entry?.node ?? ""}
            onChange={(node) => set({ entry: node ? { node } : null })}
            items={[{ value: "", label: `Automatic${auto ? ` · ${nodeName(doc.nodes.find((n) => n.id === auto.node))}` : ""}` }, ...entryCandidates(doc).map((n) => ({ value: n.id, label: nodeName(n) }))]}
          />
          {entryPorts.length > 1 && (
            <SelectField
              label="Arrives on"
              value={doc.entry?.port ?? entryPorts[0].id}
              onChange={(port) => doc.entry && set({ entry: { ...doc.entry, port } })}
              items={entryPorts.map((p) => ({ value: p.id, label: `${p.id} · ${p.type}` }))}
            />
          )}
        </Section>
        <Section title="Limits">
          <NumberField label="Budget (USD)" value={doc.budget.usd} onChange={(usd) => set({ budget: { ...doc.budget, usd } })} step={0.5} />
          <NumberField label="Max rounds" value={doc.budget.max_rounds} onChange={(max_rounds) => set({ budget: { ...doc.budget, max_rounds } })} />
          <NumberField label="Max minutes" value={doc.budget.wallclock_min} onChange={(wallclock_min) => set({ budget: { ...doc.budget, wallclock_min } })} />
          <Chips label="Stops when" hint="The run ends as soon as any of these is met" options={TERMINATION} value={doc.termination} onChange={(termination) => set({ termination })} />
        </Section>
        <Section title="Policies" aside={<AddButton label="Add policy" onClick={() => set({ policies: [...doc.policies, { id: `p${Date.now() % 100000}`, on: "usage", condition: "", action: "notify" }] })} />}>
          {doc.policies.length === 0 && <p className="text-xs text-muted-foreground">No system policies. Gates live on edges.</p>}
          {doc.policies.map((p, i) => {
            const setP = (patch: Partial<typeof p>) => set({ policies: doc.policies.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={p.id} className="group/row space-y-1 rounded-lg bg-secondary/30 p-2 ring-1 ring-border/50">
                <div className="flex items-center gap-1.5">
                  <span className="w-6 text-[11px] text-muted-foreground">on</span>
                  <input className={`${FIELD} h-7 font-mono text-[12px]`} value={p.on} onChange={(e) => setP({ on: e.target.value })} aria-label="Event" />
                  <button type="button" onClick={() => set({ policies: doc.policies.filter((_, j) => j !== i) })} aria-label="Delete policy" className="flex h-7 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover/row:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 pr-[30px]">
                  <span className="w-6 text-[11px] text-muted-foreground">if</span>
                  <input className={`${FIELD} h-7 font-mono text-[12px]`} value={p.condition} onChange={(e) => setP({ condition: e.target.value })} aria-label="Condition" placeholder="expression" />
                </div>
                <div className="flex items-center gap-1.5 pr-[30px]">
                  <span className="w-6 text-[11px] text-muted-foreground">do</span>
                  <Select variant="field" size="sm" value={p.action} onValueChange={(action) => setP({ action: action as typeof p.action })} items={["terminate", "suspend", "notify", "block", "require_approval"].map((v) => ({ value: v, label: v }))} ariaLabel="Action" className="w-full" />
                </div>
              </div>
            );
          })}
        </Section>
        <Section title={`Issues (${issues.length})`}>{issues.length === 0 ? <p className="text-xs text-success">No issues found.</p> : <IssueList issues={issues} onPick={onPick} />}</Section>
      </Body>
    </>
  );
}
