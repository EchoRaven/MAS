import { Tabs, TabsContent } from "@/components/ui/tabs";
import type { AgentData, SystemDoc, Trigger } from "@/model/types";
import { Chips, NumberField, opts, SelectField, TextField } from "../fields";
import { HarnessTab } from "./AgentHarness";
import { ContextTab, ToolsTab } from "./AgentResources";
import { PortsEditor } from "./PortsEditor";
import { Note, PanelTabs, type Update } from "./shared";
import { StagesEditor } from "./StagesEditor";

export type AgentTab = "basic" | "io" | "harness" | "tools" | "context" | "schedule";

const TRIGGERS: { value: Trigger; label: string }[] = [
  { value: "on_message", label: "Message received" },
  { value: "on_call", label: "Called" },
  { value: "on_handoff", label: "Handed off" },
  { value: "on_state", label: "State change" },
  { value: "on_schedule", label: "Schedule" },
  { value: "on_start", label: "System start" },
  { value: "on_event", label: "Platform event" },
];

function BasicsTab({ a, doc, set }: { a: AgentData; doc: SystemDoc; set: (patch: Partial<AgentData>) => void }) {
  const usesModel = a.harness.tier === "native" || a.harness.tier === "sdk";
  return (
    <div className="space-y-2">
      <TextField label="Name" value={a.name} onChange={(name) => set({ name })} />
      <TextField label="Role" value={a.role} onChange={(role) => set({ role })} placeholder="What it is responsible for" />
      {usesModel ? (
        <SelectField
          label="Base model"
          value={a.model}
          onChange={(model) => set({ model })}
          items={doc.models.filter((m) => (m.kind ?? "chat") === "chat").map((m) => ({ value: m.id, label: m.model, hint: m.price_in || m.price_out ? `$${m.price_in}/$${m.price_out}` : m.provider }))}
          hint="API endpoint, key and price per model are under Library"
        />
      ) : (
        <Note>{a.harness.tier === "process" ? "A process harness picks and calls its own model; set the model in its own config." : "A remote agent's model is chosen by the remote side."}</Note>
      )}
      <NumberField label="Budget (USD)" value={a.budget_usd} onChange={(budget_usd) => set({ budget_usd })} step={0.5} />
      <Chips
        label="Accepts"
        options={[
          { value: "text", label: "Text" },
          { value: "image", label: "Image" },
          { value: "audio", label: "Audio" },
          { value: "video", label: "Video" },
          { value: "file", label: "File" },
        ]}
        value={a.modalities_in}
        onChange={(modalities_in) => set({ modalities_in })}
      />
      <SelectField
        label="Other inputs"
        hint="What happens to an input type it does not accept"
        value={a.on_unsupported}
        onChange={(on_unsupported) => set({ on_unsupported })}
        items={opts([
          ["describe", "Convert to a text description"],
          ["extract_text", "Extract text"],
          ["as_file", "Save as a file in the env"],
          ["reject", "Reject and notify the sender"],
        ])}
      />
    </div>
  );
}

export function AgentInspector({
  id,
  a,
  doc,
  set,
  update,
  tab,
  onTab,
  stageFocus,
  onSelectEdge,
}: {
  id: string;
  a: AgentData;
  doc: SystemDoc;
  set: (patch: Partial<AgentData>) => void;
  update: Update;
  tab: AgentTab;
  onTab: (t: AgentTab) => void;
  stageFocus?: string;
  onSelectEdge?: (edgeId: string) => void;
}) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as AgentTab)} className="flex min-h-0 flex-1 flex-col">
      <PanelTabs
        tabs={[
          ["basic", "Basics"],
          ["io", "I/O"],
          ["harness", "Harness"],
          ["tools", "Tools"],
          ["context", "Context"],
          ["schedule", "Schedule"],
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        <TabsContent value="basic" className="mt-0 space-y-2">
          <BasicsTab a={a} doc={doc} set={set} />
        </TabsContent>
        <TabsContent value="io" className="mt-0">
          <PortsEditor nodeId={id} ifc={a.interface} doc={doc} update={update} />
          <StagesEditor pipeline={a.pipeline} onChange={(pipeline) => set({ pipeline })} doc={doc} focus={stageFocus} />
        </TabsContent>
        <TabsContent value="harness" className="mt-0">
          <HarnessTab a={a} doc={doc} set={set} />
        </TabsContent>
        <TabsContent value="tools" className="mt-0">
          <ToolsTab id={id} a={a} doc={doc} set={set} />
        </TabsContent>
        <TabsContent value="context" className="mt-0">
          <ContextTab id={id} a={a} doc={doc} set={set} onSelectEdge={onSelectEdge} />
        </TabsContent>
        <TabsContent value="schedule" className="mt-0 space-y-2">
          <Chips label="Triggers" options={TRIGGERS} value={a.triggers} onChange={(triggers) => set({ triggers })} hint="Wakes on any of these" />
          <SelectField
            label="While busy"
            hint="What happens to a new message while a turn is running"
            value={a.concurrency}
            onChange={(concurrency) => set({ concurrency })}
            items={opts([
              ["coalesce", "Coalesce: wake once after this turn"],
              ["queue", "Queue"],
              ["parallel", "Parallel: start a new instance"],
              // interrupting a turn is not implemented: offered only to show what an older system has
              ...(a.concurrency === "interrupt" ? ([["interrupt", "Interrupt (works like coalesce for now)"]] as [string, string][]) : []),
            ])}
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}
