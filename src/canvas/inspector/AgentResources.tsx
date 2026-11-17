import { cn } from "@/lib/utils";
import { nodeName } from "@/model/ports";
import type { AgentData, SystemDoc } from "@/model/types";
import { Hint, NumberField, opts, Section, SelectField, Switch, Toggle } from "../fields";
import { resourceTools } from "./BindingEditor";
import { Note, RowList } from "./shared";

/** Catalog tools plus what connected envs and plugins bring. */
export function ToolsTab({ id, a, doc, set }: { id: string; a: AgentData; doc: SystemDoc; set: (patch: Partial<AgentData>) => void }) {
  const others = doc.nodes.filter((n) => n.data.kind === "agent" && n.id !== id);
  const attached = doc.edges.filter((e) => e.kind === "access" && e.source === id).map((e) => ({ e, n: doc.nodes.find((x) => x.id === e.target) })).filter((x) => x.n);
  return (
    <div className="space-y-4">
      {a.harness.capabilities.tool_injection.length === 0 && <Note tone="warning">This harness does not support tool injection.</Note>}
      <Section title={`Catalog tools · ${a.tools.length} on`}>
        <RowList>
          {doc.tools.map((t) => {
            const on = a.tools.includes(t.id);
            return (
              <li key={t.id} className="flex items-center gap-2.5 px-2.5 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[12px]">{t.id}</span>
                    {t.effect !== "read" && t.effect !== "pure" && <span className={cn("rounded px-1 text-[10px]", t.effect === "irreversible" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>{t.effect}</span>}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {t.description}
                    {t.needs_env ? ` · needs ${t.needs_env}` : ""}
                  </span>
                </span>
                <Switch checked={on} onChange={(v) => set({ tools: v ? [...a.tools, t.id] : a.tools.filter((x) => x !== t.id) })} label={`Use ${t.id}`} />
              </li>
            );
          })}
        </RowList>
      </Section>
      {attached.length > 0 && (
        <Section title="From envs and plugins" aside={<Hint>Select the access edge to narrow which of these it may call.</Hint>}>
          <RowList>
            {attached.map(({ e, n }) => {
              const all = resourceTools(n!.data);
              const allowed = e.binding?.tools?.length ? e.binding.tools : all;
              return (
                <li key={e.id} className="px-2.5 py-1.5">
                  <span className="text-[12px] font-medium">{nodeName(n)}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{allowed.length ? allowed.join(", ") : "no tools"}</span>
                </li>
              );
            })}
          </RowList>
        </Section>
      )}
      <Section title="Spawn">
        <Toggle label="Allow spawning sub-agents" checked={!!a.spawn} onChange={(on) => set({ spawn: on ? { template: others[0]?.id ?? "", max_instances: 4 } : null })} hint="New instances never exceed this agent's permissions or budget. Messaging tools come from the canvas edges automatically." />
        {a.spawn && (
          <>
            <SelectField label="Template" value={a.spawn.template} onChange={(template) => set({ spawn: { ...a.spawn!, template } })} items={others.map((n) => ({ value: n.id, label: nodeName(n) }))} />
            <NumberField label="Max instances" value={a.spawn.max_instances} onChange={(v) => set({ spawn: { ...a.spawn!, max_instances: v ?? 1 } })} />
          </>
        )}
      </Section>
    </div>
  );
}

/** The agent's own history; memory and knowledge come from plugins on access edges. */
export function ContextTab({ id, a, doc, set, onSelectEdge }: { id: string; a: AgentData; doc: SystemDoc; set: (patch: Partial<AgentData>) => void; onSelectEdge?: (edgeId: string) => void }) {
  const setContext = (patch: Partial<AgentData["context"]>) => set({ context: { ...a.context, ...patch } });
  const sources = doc.edges.filter((e) => e.kind === "access" && e.source === id && e.binding && e.binding.mode !== "tool");
  return (
    <div className="space-y-4">
      {a.harness.capabilities.context_control === "none" && <Note>This harness does not expose context control. Injected context arrives as a message prefix; window and compaction settings have no effect.</Note>}
      <NumberField label="Budget (tokens)" value={a.context.budget_total} onChange={(v) => setContext({ budget_total: v ?? 120000 })} step={1000} />
      <SelectField
        label="History"
        value={a.context.history_strategy}
        onChange={(history_strategy) => setContext({ history_strategy })}
        items={opts([
          ["window", "Sliding window"],
          ["summary", "Summarize everything"],
          ["window_then_summary", "Window + summary of older turns"],
          ["retrieve", "Retrieve by relevance"],
        ])}
      />
      <NumberField label="Window" hint="Messages kept verbatim" value={a.context.history_window} onChange={(v) => setContext({ history_window: v ?? 30 })} />
      <Toggle label="Mask old tool output" checked={a.context.mask_tool_output} onChange={(mask_tool_output) => setContext({ mask_tool_output })} hint="Replace large, older tool outputs with placeholders" />
      <Section title="Injected before each turn">
        {sources.length === 0 && <p className="text-xs text-muted-foreground">Nothing. Connect a memory, knowledge or other plugin and set it to auto-inject or pinned.</p>}
        <RowList>
          {sources.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => onSelectEdge?.(e.id)} className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[12px] hover:bg-secondary">
                <span className="font-medium">{nodeName(doc.nodes.find((n) => n.id === e.target))}</span>
                <span className="text-muted-foreground">
                  {e.binding!.mode === "pinned" ? "pinned" : `top ${e.binding!.read?.top_k ?? 5}`} · {e.binding!.read?.budget_tokens ?? "—"} tok
                </span>
              </button>
            </li>
          ))}
        </RowList>
      </Section>
    </div>
  );
}
