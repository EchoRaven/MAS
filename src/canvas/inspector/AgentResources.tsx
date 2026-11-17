import { cn } from "@/lib/utils";
import { nodeName } from "@/model/ports";
import type { AgentData, SystemDoc } from "@/model/types";
import { NumberField, opts, Section, SelectField, Toggle } from "../fields";
import { resourceTools } from "./BindingEditor";
import { Note } from "./shared";

/** Catalog tools plus what connected envs and plugins bring. */
export function ToolsTab({ id, a, doc, set }: { id: string; a: AgentData; doc: SystemDoc; set: (patch: Partial<AgentData>) => void }) {
  const others = doc.nodes.filter((n) => n.data.kind === "agent" && n.id !== id);
  const attached = doc.edges.filter((e) => e.kind === "access" && e.source === id).map((e) => ({ e, n: doc.nodes.find((x) => x.id === e.target) })).filter((x) => x.n);
  return (
    <div className="space-y-4">
      {a.harness.capabilities.tool_injection.length === 0 && <Note tone="warning">This harness does not support tool injection.</Note>}
      <ul className="space-y-1">
        {doc.tools.map((t) => {
          const on = a.tools.includes(t.id);
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => set({ tools: on ? a.tools.filter((x) => x !== t.id) : [...a.tools, t.id] })}
                className={cn("flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-secondary", on && "bg-active")}
              >
                <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]", on ? "border-foreground bg-foreground text-background" : "border-input")}>{on ? "✓" : ""}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-mono text-xs">
                    {t.id}
                    <span className={cn("rounded-full px-1.5 font-sans text-[10px]", t.effect === "irreversible" ? "bg-destructive/10 text-destructive" : t.effect === "write" ? "bg-warning/10 text-warning" : "bg-secondary text-muted-foreground")}>{t.effect}</span>
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {t.description}
                    {t.needs_env ? ` · needs ${t.needs_env} env` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {attached.length > 0 && (
        <Section title="From connected envs and plugins">
          <ul className="space-y-1 text-xs">
            {attached.map(({ e, n }) => {
              const all = resourceTools(n!.data);
              const allowed = e.binding?.tools?.length ? e.binding.tools : all;
              return (
                <li key={e.id} className="rounded-lg bg-secondary/60 px-2.5 py-1.5">
                  <span className="font-medium">{nodeName(n)}</span>
                  <span className="text-muted-foreground"> · {allowed.length ? allowed.join(", ") : "no tools"}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted-foreground">Select the access edge to narrow which of these it may call.</p>
        </Section>
      )}
      <p className="text-[11px] text-muted-foreground">Communication tools (send_message, call_, handoff_to_) come from the edges on the canvas.</p>
      <Section title="Spawn">
        <Toggle label="Allow spawning sub-agents" checked={!!a.spawn} onChange={(on) => set({ spawn: on ? { template: others[0]?.id ?? "", max_instances: 4 } : null })} hint="New instances never exceed this agent's permissions or budget" />
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
      <NumberField label="Context budget (tokens)" value={a.context.budget_total} onChange={(v) => setContext({ budget_total: v ?? 120000 })} step={1000} />
      <SelectField
        label="History strategy"
        value={a.context.history_strategy}
        onChange={(history_strategy) => setContext({ history_strategy })}
        items={opts([
          ["window", "Sliding window"],
          ["summary", "Summarize everything"],
          ["window_then_summary", "Window + summary of older turns"],
          ["retrieve", "Retrieve by relevance"],
        ])}
      />
      <NumberField label="Window size (messages)" value={a.context.history_window} onChange={(v) => setContext({ history_window: v ?? 30 })} />
      <Toggle label="Mask old tool output" checked={a.context.mask_tool_output} onChange={(mask_tool_output) => setContext({ mask_tool_output })} hint="Replace large, older tool outputs with placeholders" />
      <Section title="Injected before each turn">
        {sources.length === 0 && <p className="text-xs text-muted-foreground">Nothing. Connect a memory, knowledge or other plugin and set it to auto-inject or pinned.</p>}
        <ul className="space-y-1">
          {sources.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => onSelectEdge?.(e.id)} className="flex w-full items-center justify-between rounded-lg bg-secondary/60 px-2.5 py-1.5 text-left text-xs hover:bg-secondary">
                <span className="font-medium">{nodeName(doc.nodes.find((n) => n.id === e.target))}</span>
                <span className="text-muted-foreground">
                  {e.binding!.mode === "pinned" ? "pinned" : `top ${e.binding!.read?.top_k ?? 5}`} · {e.binding!.read?.budget_tokens ?? "—"} tok
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
