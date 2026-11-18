import { Tabs, TabsContent } from "@/components/ui/tabs";
import type { FunctionNodeData, GroupData, HumanData, ModelNodeData, SystemDoc } from "@/model/types";
import { AreaField, NumberField, opts, Section, SelectField, TextField, Toggle } from "../fields";
import { FunctionEditor } from "./FunctionEditor";
import { PortsEditor } from "./PortsEditor";
import { Body, Note, PanelTabs, type Update } from "./shared";

type Set<D> = (patch: Partial<D>) => void;

/** Settings and Interface tabs, for every component with editable ports. */
function WithInterface({ id, ifc, doc, update, children, inputsLabel, outputsLabel }: { id: string; ifc: GroupData["interface"]; doc: SystemDoc; update: Update; children: React.ReactNode; inputsLabel?: string; outputsLabel?: string }) {
  return (
    <Tabs defaultValue="settings" className="flex min-h-0 flex-1 flex-col">
      <PanelTabs
        tabs={[
          ["settings", "Settings"],
          ["interface", "Interface"],
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        <TabsContent value="settings" className="mt-0 space-y-2">
          {children}
        </TabsContent>
        <TabsContent value="interface" className="mt-0">
          <PortsEditor nodeId={id} ifc={ifc} doc={doc} update={update} inputsLabel={inputsLabel} outputsLabel={outputsLabel} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

export function HumanInspector({ h, set }: { h: HumanData; set: Set<HumanData> }) {
  return (
    <Body>
      <TextField label="Name" value={h.name} onChange={(name) => set({ name })} />
      <TextField label="Role" value={h.role} onChange={(role) => set({ role })} />
      <Toggle label="Can approve" checked={h.approves} onChange={(approves) => set({ approves })} hint="Calls to this human show up in their inbox as approval requests" />
    </Body>
  );
}

export function ModelInspector({ id, m, doc, set, update }: { id: string; m: ModelNodeData; doc: SystemDoc; set: Set<ModelNodeData>; update: Update }) {
  const out = m.interface.outputs[0];
  return (
    <WithInterface id={id} ifc={m.interface} doc={doc} update={update}>
      <TextField label="Name" value={m.name} onChange={(name) => set({ name })} />
      <SelectField label="Model" value={m.model} onChange={(model) => set({ model })} items={doc.models.filter((x) => (x.kind ?? "chat") === "chat").map((x) => ({ value: x.id, label: x.model, hint: x.provider }))} hint="One call per input: no loop, no tools" />
      <AreaField label="System prompt" value={m.system_prompt} onChange={(system_prompt) => set({ system_prompt })} rows={3} />
      <AreaField label="Prompt" value={m.prompt} onChange={(prompt) => set({ prompt })} rows={3} mono hint="{{input}} is the incoming value; {{input.<field>}} for JSON" />
      <NumberField label="Temperature" value={m.temperature} onChange={(temperature) => set({ temperature })} step={0.1} placeholder="Default" />
      <NumberField label="Max tokens" value={m.max_tokens} onChange={(max_tokens) => set({ max_tokens })} step={256} placeholder="Default" />
      <TextField
        label="Replicas"
        value={m.replicas == null ? "" : String(m.replicas)}
        onChange={(v) => set({ replicas: v.trim() === "" ? null : /^\d+$/.test(v.trim()) ? Number(v.trim()) : v.trim() })}
        placeholder="1"
        hint="Sample the call this many times in parallel and send the list of replies (json): an ensemble in one component. {{vars.n}} sets it per run"
      />
      {out?.type === "json" && <Note tone="info">The output port is json{out.schema ? ` (${out.schema})` : ""}: the call uses structured output and the reply is parsed before it leaves.</Note>}
    </WithInterface>
  );
}

export function FunctionInspector({ id, f, doc, set, update }: { id: string; f: FunctionNodeData; doc: SystemDoc; set: Set<FunctionNodeData>; update: Update }) {
  const multiIn = f.interface.inputs.length > 1;
  const multiOut = f.interface.outputs.length > 1;
  return (
    <WithInterface id={id} ifc={f.interface} doc={doc} update={update}>
      <TextField label="Name" value={f.name} onChange={(name) => set({ name })} />
      <FunctionEditor
        label="Code"
        fn={f.fn}
        onChange={(fn) => set({ fn })}
        doc={doc}
        rows={8}
        hint={`input: ${multiIn ? "{ " + f.interface.inputs.map((p) => p.id).join(", ") + " }" : "the value on " + (f.interface.inputs[0]?.id ?? "in")} · return ${multiOut ? "{ <" + f.interface.outputs.map((p) => p.id).join(" | ") + ">: value } to pick ports" : "the value"}; null drops it`}
      />
      {multiIn && (
        <SelectField label="Runs when" value={f.join} onChange={(join) => set({ join })} items={opts([["any", "Any input arrives"], ["all", "Every required input has a value"]])} />
      )}
    </WithInterface>
  );
}

export function GroupInspector({ id, g, doc, set, update, onOpen }: { id: string; g: GroupData; doc: SystemDoc; set: Set<GroupData>; update: Update; onOpen?: () => void }) {
  const members = doc.nodes.filter((n) => n.parent === id).length;
  return (
    <WithInterface id={id} ifc={g.interface} doc={doc} update={update} inputsLabel="Inputs (sources inside)" outputsLabel="Outputs (targets inside)">
      <TextField label="Name" value={g.name} onChange={(name) => set({ name })} />
      <NumberField label="Budget (USD)" value={g.budget_usd} onChange={(budget_usd) => set({ budget_usd })} step={0.5} />
      <Section title="Repeat" defaultOpen={!!g.iterate}>
        <Toggle label="Run in rounds" checked={!!g.iterate} onChange={(on) => set({ iterate: on ? { max_rounds: 3, until: null, feed: "output" } : null })} hint="What reaches an output goes back in through the inputs: debates, multi-turn dialogues, review loops" />
        {g.iterate && (
          <>
            <NumberField label="Max rounds" value={g.iterate.max_rounds} onChange={(v) => set({ iterate: { ...g.iterate!, max_rounds: v ?? 1 } })} />
            <TextField label="Stop when" value={g.iterate.until ?? ""} onChange={(until) => set({ iterate: { ...g.iterate!, until: until || null } })} mono placeholder='output.text.includes("DONE")' hint="An expression over output and round; empty runs every round" />
            <SelectField label="Next round gets" value={g.iterate.feed ?? "output"} onChange={(feed) => set({ iterate: { ...g.iterate!, feed } })} items={opts([["output", "The last output"], ["input_and_output", "The original input and the last output"]])} />
          </>
        )}
      </Section>
      <SelectField label="On failure" value={g.on_error} onChange={(on_error) => set({ on_error })} items={opts([["retry_then_fail_up", "Retry once, then fail up"], ["fail_up", "Fail up"], ["ignore", "Ignore"]])} />
      <Note>
        {members} component{members === 1 ? "" : "s"} inside.{" "}
        {onOpen && (
          <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={onOpen}>
            Open its canvas
          </button>
        )}{" "}
        A group is a boundary for budget, permissions and errors; outside, only its ports are visible.
      </Note>
    </WithInterface>
  );
}
