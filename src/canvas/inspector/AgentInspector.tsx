import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentData, SystemDoc, Trigger } from "@/model/types";
import { Chips, NumberField, opts, SelectField, TextField } from "../fields";
import { HarnessTab } from "./AgentHarness";
import { ContextTab, ToolsTab } from "./AgentResources";
import { PortsEditor } from "./PortsEditor";
import { Note, type Update } from "./shared";
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
    <div className="space-y-4">
      <TextField label="Name" value={a.name} onChange={(name) => set({ name })} />
      <TextField label="Role" value={a.role} onChange={(role) => set({ role })} placeholder="One line on what it is responsible for" />
      {usesModel ? (
        <SelectField
          label="Base model"
          value={a.model}
          onChange={(model) => set({ model })}
          items={doc.models.map((m) => ({ value: m.id, label: m.model, hint: m.price_in || m.price_out ? `$${m.price_in}/$${m.price_out}` : m.provider }))}
          hint="API, key and price per model are under Library"
        />
      ) : (
        <Note>{a.harness.tier === "process" ? "A process harness picks and calls its own model; set the model in its own config." : "A remote agent's model is chosen by the remote side."}</Note>
      )}
      <NumberField label="Agent budget (USD)" value={a.budget_usd} onChange={(budget_usd) => set({ budget_usd })} step={0.5} />
      <Chips
        label="Accepted input modalities"
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
        label="On unsupported modality"
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
      <TabsList className="mx-4 mt-3 grid grid-cols-6">
        <TabsTrigger value="basic" className="px-1 text-[11px]">Basics</TabsTrigger>
        <TabsTrigger value="io" className="px-1 text-[11px]">I/O</TabsTrigger>
        <TabsTrigger value="harness" className="px-1 text-[11px]">Harness</TabsTrigger>
        <TabsTrigger value="tools" className="px-1 text-[11px]">Tools</TabsTrigger>
        <TabsTrigger value="context" className="px-1 text-[11px]">Context</TabsTrigger>
        <TabsTrigger value="schedule" className="px-1 text-[11px]">Schedule</TabsTrigger>
      </TabsList>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <TabsContent value="basic" className="mt-0">
          <BasicsTab a={a} doc={doc} set={set} />
        </TabsContent>
        <TabsContent value="io" className="mt-0 space-y-5">
          <PortsEditor nodeId={id} ifc={a.interface} doc={doc} update={update} />
          <StagesEditor pipeline={a.pipeline} onChange={(pipeline) => set({ pipeline })} doc={doc} focus={stageFocus} />
        </TabsContent>
        <TabsContent value="harness" className="mt-0">
          <HarnessTab a={a} set={set} />
        </TabsContent>
        <TabsContent value="tools" className="mt-0">
          <ToolsTab id={id} a={a} doc={doc} set={set} />
        </TabsContent>
        <TabsContent value="context" className="mt-0">
          <ContextTab id={id} a={a} doc={doc} set={set} onSelectEdge={onSelectEdge} />
        </TabsContent>
        <TabsContent value="schedule" className="mt-0 space-y-4">
          <Chips label="Triggers" options={TRIGGERS} value={a.triggers} onChange={(triggers) => set({ triggers })} hint="Wakes on any of these" />
          <SelectField
            label="New message while busy"
            value={a.concurrency}
            onChange={(concurrency) => set({ concurrency })}
            items={opts([
              ["coalesce", "Coalesce: wake once after this turn"],
              ["queue", "Queue"],
              ["parallel", "Parallel: start a new instance"],
              ["interrupt", "Interrupt the current turn"],
            ])}
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}
