import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { checkContract, manifestToYaml } from "@/model/envspec";
import { nodeName } from "@/model/ports";
import { PLUGIN_PRESETS, switchPreset } from "@/model/plugins";
import type { EnvData, PluginData, PluginSpec, SystemDoc, ToolEffect } from "@/model/types";
import { opts, Section, SelectField, TextField, Toggle } from "../fields";
import { emptyFn, FunctionEditor } from "./FunctionEditor";
import { AddButton, Body, IssueList, Note } from "./shared";

const SOURCE: Record<string, string> = { dtap: "DT (DecodingTrust)", envgen: "env-gen", compose: "docker compose", "mas-env": "mas-env manifest" };

export function EnvInspector({ id, e, doc, set }: { id: string; e: EnvData; doc: SystemDoc; set: (patch: Partial<EnvData>) => void }) {
  const members = doc.edges.filter((x) => x.kind === "access" && x.target === id).map((x) => doc.nodes.find((n) => n.id === x.source));
  const m = e.manifest;
  return (
    <Body>
      <TextField label="Name" value={e.name} onChange={(name) => set({ name })} />
      <SelectField
        label="Type"
        value={e.env_kind}
        onChange={(env_kind) => set({ env_kind, room: env_kind === "room" ? (e.room ?? { policy: "free", history: "persistent" }) : e.room })}
        items={opts([
          ["app", "app · imported app stack"],
          ["sandbox", "sandbox · container / microVM"],
          ["browser", "browser · headless browser"],
          ["database", "database · managed database"],
          ["service", "service · managed service"],
          ["room", "room · shared conversation space"],
          ["external", "external · third-party system"],
        ])}
      />
      {e.env_kind === "room" && e.room && (
        <Section title="Room">
          <SelectField label="Speaking policy" value={e.room.policy} onChange={(policy) => set({ room: { ...e.room!, policy } })} items={opts([["free", "Free: anyone triggered may reply"], ["round_robin", "Round robin"], ["selector", "A moderator picks who speaks next"], ["mention", "Only @-mentioned members reply"], ["bid", "Bid: the most eager member speaks"]])} />
          {e.room.policy === "selector" && (
            <SelectField label="Moderator" value={e.room.selector ?? ""} onChange={(selector) => set({ room: { ...e.room!, selector } })} items={members.filter(Boolean).map((n) => ({ value: n!.id, label: nodeName(n) }))} />
          )}
          <SelectField label="History for late joiners" value={e.room.history} onChange={(history) => set({ room: { ...e.room!, history } })} items={opts([["persistent", "Full history"], ["since_join", "Only since joining"]])} />
          <p className="text-xs text-muted-foreground">Members: {members.length ? members.map(nodeName).join(", ") : "none"}. Connect an agent or human to join.</p>
        </Section>
      )}
      {e.env_kind === "sandbox" && <TextField label="Image" value={e.image} onChange={(image) => set({ image })} mono />}
      {e.env_kind !== "room" && (
        <>
          <SelectField label="Lifecycle" value={e.lifecycle} onChange={(lifecycle) => set({ lifecycle })} items={opts([["per_run", "New for each run"], ["per_session", "Per session"], ["persistent", "Persistent"]])} />
          <SelectField label="Snapshots" value={e.snapshot} onChange={(snapshot) => set({ snapshot })} items={opts([["never", "Never"], ["on_write", "On every write"], ["on_checkpoint", "At checkpoints"]])} hint={e.env_kind === "external" ? "External envs cannot be snapshotted; actions are only logged" : "Enables replay and forking"} />
          <TextField label="Allowed egress (comma-separated; all blocked by default)" value={e.egress.join(", ")} onChange={(v) => set({ egress: v.split(",").map((s) => s.trim()).filter(Boolean) })} mono />
        </>
      )}
      {m && (
        <Section title="Imported contract">
          <Note tone="info">
            {SOURCE[m.source.format] ?? m.source.format}
            {m.version ? ` · v${m.version}` : ""} · {m.exposes.mcp ? `${m.exposes.mcp.tools.length} MCP tools` : "no MCP"} · {m.lifecycle.reset ? "resettable" : "no reset"}
          </Note>
          <IssueList issues={checkContract(m)} />
          <details className="rounded-lg shadow-[0_0_0_1px_hsl(var(--border))]">
            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">Manifest (mas-env/1)</summary>
            <pre className="max-h-72 overflow-auto border-t border-border/70 px-3 py-2 font-mono text-[10px] leading-relaxed">{manifestToYaml(m)}</pre>
          </details>
        </Section>
      )}
    </Body>
  );
}

const HOOKS: [keyof PluginSpec["hooks"], string, string][] = [
  ["before_turn", "before_turn", "ctx → text added to the agent's context (or null)"],
  ["after_turn", "after_turn", "turn → records to store (or null)"],
  ["on_start", "on_start", "runs once when the system starts"],
];

export function PluginInspector({ p, doc, set }: { p: PluginData; doc: SystemDoc; set: (next: PluginData) => void }) {
  const spec = p.spec;
  const setSpec = (patch: Partial<PluginSpec>) => set({ ...p, preset: p.preset === "custom" ? "custom" : p.preset, spec: { ...spec, ...patch } });
  const setTool = (i: number, patch: Partial<PluginSpec["tools"][number]>) => setSpec({ tools: spec.tools.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  return (
    <Body>
      <TextField label="Name" value={p.name} onChange={(name) => set({ ...p, name })} />
      <SelectField label="Preset" value={p.preset} onChange={(preset) => set(switchPreset(p, preset))} items={PLUGIN_PRESETS.map((x) => ({ value: x.id, label: x.label, hint: x.hint }))} hint="Switching to a preset fills its defaults; Custom keeps what is here and makes it yours" />
      <div className="grid grid-cols-2 gap-2">
        <SelectField label="Scope" value={spec.scope} onChange={(scope) => setSpec({ scope })} items={opts([["agent", "Per agent"], ["group", "Shared in group"], ["end_user", "Per end user"], ["system", "Whole system"]])} />
        <SelectField label="Storage" value={spec.storage ?? "none"} onChange={(storage) => setSpec({ storage })} items={opts([["builtin", "Built-in"], ["pgvector", "pgvector"], ["qdrant", "Qdrant"], ["sqlite", "SQLite"], ["files", "Files"], ["none", "None"]])} />
      </div>
      <Section title="Backend">
        <SelectField label="Runs as" value={spec.backend.kind} onChange={(kind) => setSpec({ backend: { ...spec.backend, kind } })} items={opts([["builtin", "Built into the platform"], ["mcp", "MCP server"], ["http", "HTTP service"], ["code", "Code (runs in the platform sandbox)"]])} />
        {(spec.backend.kind === "mcp" || spec.backend.kind === "http") && <TextField label="URL" value={spec.backend.url ?? ""} onChange={(url) => setSpec({ backend: { ...spec.backend, url } })} mono placeholder="http://127.0.0.1:9100/mcp" />}
        {(spec.backend.kind === "mcp" || spec.backend.kind === "code") && <TextField label="Command" value={spec.backend.command ?? ""} onChange={(command) => setSpec({ backend: { ...spec.backend, command } })} mono placeholder="uv run python my_plugin.py" />}
      </Section>
      {(spec.sources || p.preset === "knowledge" || p.preset === "workspace") && (
        <TextField label={p.preset === "workspace" ? "Mounted directories" : "Sources"} value={(spec.sources ?? []).join(", ")} onChange={(v) => setSpec({ sources: v.split(",").map((s) => s.trim()).filter(Boolean) })} mono />
      )}
      <Section title="Tools" aside={<AddButton onClick={() => setSpec({ tools: [...spec.tools, { name: "new_tool", description: "", effect: "read" }] })} />}>
        <ul className="space-y-2">
          {spec.tools.map((t, i) => (
            <li key={i} className="space-y-1.5 rounded-lg p-2 shadow-[0_0_0_1px_hsl(var(--border))]">
              <div className="flex items-center gap-1.5">
                <Input value={t.name} onChange={(e) => setTool(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })} aria-label="Tool name" className="h-8 min-w-0 flex-1 font-mono text-xs" />
                <Select value={t.effect} onValueChange={(v) => setTool(i, { effect: v as ToolEffect })} items={[{ value: "pure", label: "pure" }, { value: "read", label: "read" }, { value: "write", label: "write" }, { value: "irreversible", label: "irreversible" }]} ariaLabel="Effect" className="w-28" />
                <button type="button" onClick={() => setSpec({ tools: spec.tools.filter((_, j) => j !== i) })} aria-label={`Delete tool ${t.name}`} className="rounded p-1 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <Input value={t.description} onChange={(e) => setTool(i, { description: e.target.value })} placeholder="What it does" aria-label="Tool description" className="h-8 text-xs" />
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Hooks">
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
      <p className="text-[11px] text-muted-foreground">Every plugin implements mas-plugin/1: tools + hooks + backend. Per-agent settings (which tools, query, top K, format) are on the access edge.</p>
    </Body>
  );
}
