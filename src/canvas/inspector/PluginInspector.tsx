import { Trash2 } from "lucide-react";
import { EnvTry } from "./EnvTry";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { defaultIndex, defaultMemoryPolicy, defaultRetrieval } from "@/model/pipelines";
import { PLUGIN_PRESETS, switchPreset } from "@/model/plugins";
import type { PluginData, PluginSpec, SystemDoc, ToolEffect } from "@/model/types";
import { Hint, opts, Section, SelectField, TextField, Toggle } from "../fields";
import { EndpointField } from "./EndpointField";
import { emptyFn, FunctionEditor } from "./FunctionEditor";
import { IndexEditor, MemoryPolicyEditor, RetrievalEditor } from "./PipelineEditor";
import { AddButton, Note, PanelTabs, RowList } from "./shared";

const HOOKS: [keyof PluginSpec["hooks"], string, string][] = [
  ["before_turn", "before_turn", "ctx → text added to the agent's context (or null)"],
  ["after_turn", "after_turn", "turn → records to store (or null)"],
  ["on_start", "on_start", "runs once when the system starts"],
];

/** A pipeline tab: on when the plugin has that pipeline, with a switch to add or drop it. */
function PipelineTab({ label, on, setOn, children }: { label: string; on: boolean; setOn: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <>
      <Toggle label={label} checked={on} onChange={setOn} />
      {on && children}
    </>
  );
}

export function PluginInspector({ id, p, doc, set }: { id: string; p: PluginData; doc: SystemDoc; set: (next: PluginData) => void }) {
  const spec = p.spec;
  const setSpec = (patch: Partial<PluginSpec>) => set({ ...p, preset: p.preset === "custom" ? "custom" : p.preset, spec: { ...spec, ...patch } });
  const setTool = (i: number, patch: Partial<PluginSpec["tools"][number]>) => setSpec({ tools: spec.tools.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const tabs: [string, string][] = [
    ["settings", "Settings"],
    ["retrieval", "Retrieval"],
    ...(p.preset === "knowledge" || spec.index ? ([["index", "Indexing"]] as [string, string][]) : []),
    ...(p.preset === "memory" || spec.memory ? ([["memory", "Memory"]] as [string, string][]) : []),
    ["hooks", "Hooks"],
    ["try", "Try it"],
  ];
  return (
    <Tabs defaultValue="settings" className="flex min-h-0 flex-1 flex-col">
      <PanelTabs tabs={tabs} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        <TabsContent value="retrieval" className="mt-0 space-y-2">
          <PipelineTab label="Searchable" on={!!spec.retrieval} setOn={(on) => setSpec({ retrieval: on ? defaultRetrieval(p.preset === "memory" ? "memory" : p.preset === "knowledge" ? "knowledge" : "plain") : null })}>
            <RetrievalEditor value={spec.retrieval!} onChange={(retrieval) => setSpec({ retrieval })} doc={doc} />
          </PipelineTab>
        </TabsContent>
        <TabsContent value="index" className="mt-0 space-y-2">
          <PipelineTab label="Index sources" on={!!spec.index} setOn={(on) => setSpec({ index: on ? defaultIndex() : null })}>
            <IndexEditor value={spec.index!} onChange={(index) => setSpec({ index })} doc={doc} />
          </PipelineTab>
        </TabsContent>
        <TabsContent value="memory" className="mt-0 space-y-2">
          <PipelineTab label="Manage memory lifecycle" on={!!spec.memory} setOn={(on) => setSpec({ memory: on ? defaultMemoryPolicy() : null })}>
            <MemoryPolicyEditor value={spec.memory!} onChange={(memory) => setSpec({ memory })} doc={doc} />
          </PipelineTab>
        </TabsContent>
        <TabsContent value="settings" className="mt-0 space-y-2">
      <TextField label="Name" value={p.name} onChange={(name) => set({ ...p, name })} />
      <SelectField label="Preset" value={p.preset} onChange={(preset) => set(switchPreset(p, preset))} items={PLUGIN_PRESETS.map((x) => ({ value: x.id, label: x.label, hint: x.hint }))} hint="A preset fills in its defaults; Custom keeps what is here and makes everything editable" />
      <div className="space-y-2">
        <SelectField label="Scope" value={spec.scope} onChange={(scope) => setSpec({ scope })} items={opts([["agent", "Per agent"], ["group", "Shared in group"], ["end_user", "Per end user"], ["system", "Whole system"]])} />
        <SelectField label="Storage" value={spec.storage ?? "none"} onChange={(storage) => setSpec({ storage })} items={opts([["builtin", "Built-in"], ["pgvector", "pgvector"], ["qdrant", "Qdrant"], ["sqlite", "SQLite"], ["files", "Files"], ["none", "None"]])} />
      </div>
      <Section title="Backend">
        <SelectField label="Runs as" value={spec.backend.kind} onChange={(kind) => setSpec({ backend: { ...spec.backend, kind } })} items={opts([["builtin", "Built into the platform"], ["mcp", "MCP server"], ["http", "HTTP service"], ["code", "Code (runs in the platform sandbox)"]])} />
        {(spec.backend.kind === "mcp" || spec.backend.kind === "http") && (
          <EndpointField
            kind={spec.backend.kind}
            value={spec.backend.endpoint}
            onChange={(endpoint) => setSpec({ backend: { ...spec.backend, endpoint } })}
            legacy={
              <>
                <TextField label="URL" value={spec.backend.url ?? ""} onChange={(url) => setSpec({ backend: { ...spec.backend, url } })} mono placeholder="http://127.0.0.1:9100/mcp" />
                {spec.backend.kind === "mcp" && <TextField label="Command" value={spec.backend.command ?? ""} onChange={(command) => setSpec({ backend: { ...spec.backend, command } })} mono placeholder="uv run python my_plugin.py" hint="Runs on this machine: needs MAS_ALLOW_LOCAL_EXEC=1. A hosted service runs it in a container instead" />}
              </>
            }
          />
        )}
        {spec.backend.kind === "code" && <TextField label="Command" value={spec.backend.command ?? ""} onChange={(command) => setSpec({ backend: { ...spec.backend, command } })} mono placeholder="uv run python my_plugin.py" />}
      </Section>
      {(spec.sources || p.preset === "knowledge" || p.preset === "workspace") && (
        <TextField label={p.preset === "workspace" ? "Mounted directories" : "Sources"} value={(spec.sources ?? []).join(", ")} onChange={(v) => setSpec({ sources: v.split(",").map((s) => s.trim()).filter(Boolean) })} mono />
      )}
      <Section title={`Tools · ${spec.tools.length}`} aside={<AddButton label="Add tool" onClick={() => setSpec({ tools: [...spec.tools, { name: "new_tool", description: "", effect: "read" }] })} />}>
        <RowList empty="No tools.">
          {spec.tools.map((t, i) => (
            <li key={i} className="group/row px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <input value={t.name} onChange={(e) => setTool(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })} aria-label="Tool name" className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 font-mono text-[12px] outline-none hover:bg-secondary focus:bg-card focus:ring-1 focus:ring-ring/40" />
                <Select
                  variant="field"
                  size="sm"
                  value={t.effect}
                  onValueChange={(v) => setTool(i, { effect: v as ToolEffect })}
                  items={[{ value: "pure", label: "pure" }, { value: "read", label: "read" }, { value: "write", label: "write" }, { value: "irreversible", label: "irreversible" }]}
                  ariaLabel="Effect"
                  className={cn("w-[96px]", t.effect === "irreversible" && "text-destructive", t.effect === "write" && "text-warning")}
                />
                <button type="button" onClick={() => setSpec({ tools: spec.tools.filter((_, j) => j !== i) })} aria-label={`Delete tool ${t.name}`} className="flex h-7 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover/row:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <input value={t.description} onChange={(e) => setTool(i, { description: e.target.value })} placeholder="What it does" aria-label="Tool description" className="h-6 w-full rounded-md bg-transparent px-1.5 text-[12px] text-muted-foreground outline-none placeholder:text-muted-foreground/50 hover:bg-secondary focus:bg-card focus:text-foreground focus:ring-1 focus:ring-ring/40" />
            </li>
          ))}
        </RowList>
      </Section>
      <Note>Per-agent settings (which tools, top K, overrides of any retrieval step) live on the access edge to each agent.</Note>
        </TabsContent>
        <TabsContent value="try" className="mt-0 space-y-2">
          <EnvTry systemId={doc.id} envId={id} what="plugin" />
        </TabsContent>
        <TabsContent value="hooks" className="mt-0 space-y-2">
      <Section title="Hooks" aside={<Hint>Hooks run around the pipelines: before_turn can replace retrieval entirely; after_turn can replace the memory lifecycle.</Hint>}>
        {HOOKS.map(([key, label, hint]) => {
          const fn = spec.hooks[key];
          return (
            <div key={key} className="space-y-2">
              <Toggle label={label} checked={!!fn} onChange={(on) => setSpec({ hooks: { ...spec.hooks, [key]: on ? emptyFn("js", "return null;") : null } })} hint={hint} />
              {fn && <FunctionEditor label={label} fn={fn} onChange={(next) => setSpec({ hooks: { ...spec.hooks, [key]: next } })} doc={doc} rows={3} />}
            </div>
          );
        })}
      </Section>
        </TabsContent>
      </div>
    </Tabs>
  );
}
