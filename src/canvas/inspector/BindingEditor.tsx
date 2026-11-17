import type { AccessBinding, NodeData, SystemDoc } from "@/model/types";
import { Chips, NumberField, opts, Section, SelectField, TextField, Toggle } from "../fields";
import { emptyFn, FunctionEditor } from "./FunctionEditor";

/** Tools the resource offers: an imported env's MCP tools, or a plugin's tools. */
export function resourceTools(target: NodeData): string[] {
  if (target.kind === "plugin") return target.spec.tools.map((t) => t.name);
  if (target.kind === "env") return target.manifest?.exposes.mcp?.tools ?? [];
  return [];
}

/**
 * How one agent uses one env or plugin. The same editor for memory,
 * knowledge, workspaces, rooms and imported envs: read mode, query / filter /
 * format hooks, write-back, and which of the resource's tools it may call.
 */
export function BindingEditor({ binding, onChange, target, access, doc }: { binding: AccessBinding; onChange: (b: AccessBinding) => void; target: NodeData; access: "read" | "read_write"; doc: SystemDoc }) {
  const read = binding.read ?? {};
  const write = binding.write ?? { when: "never" as const };
  const setRead = (patch: Partial<NonNullable<AccessBinding["read"]>>) => onChange({ ...binding, read: { ...read, ...patch } });
  const setWrite = (patch: Partial<NonNullable<AccessBinding["write"]>>) => onChange({ ...binding, write: { ...write, ...patch } });
  const tools = resourceTools(target);
  const injects = binding.mode !== "tool";

  return (
    <div className="space-y-2">
      <SelectField
        label="Mode"
        hint="How it reaches the agent"
        value={binding.mode}
        onChange={(mode) => onChange({ ...binding, mode })}
        items={opts([
          ["tool", "As tools: the agent decides when", "Only the tools below; nothing is added to the context"],
          ["auto_inject", "Auto-inject before every turn", "Runs the query and adds the results to the context"],
          ["pinned", "Pinned in the context", "Always present, e.g. a room's recent messages"],
        ])}
      />
      {tools.length > 0 && (
        <Chips
          label="Allowed tools"
          hint="None selected = all of them"
          options={tools.map((t) => ({ value: t, label: t }))}
          value={binding.tools ?? []}
          onChange={(v) => onChange({ ...binding, tools: v })}
        />
      )}
      {injects && (
        <Section title="Read">
          {binding.mode === "auto_inject" && <NumberField label="Top K" value={read.top_k} onChange={(top_k) => setRead({ top_k })} />}
          <NumberField label="Token budget" value={read.budget_tokens} onChange={(budget_tokens) => setRead({ budget_tokens })} step={500} />
          {binding.mode === "auto_inject" && <TextField label="Filter" value={read.filter ?? ""} onChange={(f) => setRead({ filter: f || null })} mono placeholder='scope == "end_user" && age_days < 30' />}
          <Toggle label="Custom query" checked={!!read.query} onChange={(on) => setRead({ query: on ? emptyFn("template", "{{input.text}}") : null })} hint="Default: the incoming message's text" />
          {read.query && <FunctionEditor label="Query (ctx → query)" fn={read.query} onChange={(query) => setRead({ query })} doc={doc} rows={2} />}
          <Toggle label="Custom format" checked={!!read.format} onChange={(on) => setRead({ format: on ? emptyFn("template", "{{#each results}}- {{this.text}}\n{{/each}}") : null })} hint="Default: a bulleted list with sources" />
          {read.format && <FunctionEditor label="Format (results → context text)" fn={read.format} onChange={(format) => setRead({ format })} doc={doc} rows={3} />}
        </Section>
      )}
      {access === "read_write" && (
        <Section title="Write">
          <SelectField
            label="When"
            value={write.when}
            onChange={(when) => setWrite({ when })}
            items={opts([
              ["agent_tool", "When the agent calls a write tool"],
              ["after_turn", "After every turn, automatically"],
              ["never", "Never"],
            ])}
          />
          {write.when === "after_turn" && (
            <>
              <Toggle label="Extract before storing" checked={!!write.extract} onChange={(on) => setWrite({ extract: on ? emptyFn("llm", "List the durable facts in this turn, one per line.") : null })} hint="Default: store the turn as it is" />
              {write.extract && <FunctionEditor label="Extract (turn → records)" fn={write.extract} onChange={(extract) => setWrite({ extract })} doc={doc} rows={3} />}
            </>
          )}
        </Section>
      )}
    </div>
  );
}
