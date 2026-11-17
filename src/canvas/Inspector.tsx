import { useState, type ReactNode } from "react";
import { AlertTriangle, CircleAlert, Info, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { cn } from "@/lib/utils";
import { KIND_LABEL, RUNNERS, runnerById } from "@/model/defaults";
import type {
  AgentData,
  ChannelData,
  EdgeKind,
  EnvData,
  GroupData,
  HarnessTier,
  HumanData,
  NodeData,
  StoreBinding,
  StoreData,
  SysEdge,
  SystemDoc,
  Trigger,
} from "@/model/types";
import type { Issue } from "@/model/validate";
import { EDGE_LABEL } from "./convert";
import { AreaField, Chips, NumberField, opts, Section, SelectField, TextField, Toggle } from "./fields";

type Update = (fn: (doc: SystemDoc) => SystemDoc) => void;

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-1.5">
      {issues.map((i, k) => {
        const Icon = i.severity === "error" ? CircleAlert : i.severity === "warning" ? AlertTriangle : Info;
        return (
          <li
            key={k}
            className={cn(
              "flex gap-2 rounded-lg px-2.5 py-2 text-xs",
              i.severity === "error" ? "bg-destructive/10 text-destructive" : i.severity === "warning" ? "bg-warning/10 text-warning" : "bg-secondary text-muted-foreground",
            )}
          >
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{i.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Header({ title, subtitle, avatar, onDelete, onClose }: { title: string; subtitle: string; avatar: ReactNode; onDelete?: () => void; onClose: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {onDelete && (
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

const LEVEL_TINT = { full: "bg-success/10 text-success", partial: "bg-info/10 text-info", none: "bg-secondary text-muted-foreground" };

function CapabilityTable({ a }: { a: AgentData }) {
  const c = a.harness.capabilities;
  const rows: [string, ReactNode][] = [
    ["Context control", <span className={cn("rounded-full px-2 py-0.5", LEVEL_TINT[c.context_control])}>{c.context_control}</span>],
    ["Tool injection", c.tool_injection.length ? c.tool_injection.join(" / ") : "No"],
    ["Observable steps", <span className={cn("rounded-full px-2 py-0.5", LEVEL_TINT[c.observable_steps])}>{c.observable_steps}</span>],
    ["Pre-action approval", c.approval_hook ? "Yes" : "No (enforced at the env boundary only)"],
    ["Resumable sessions", c.resumable ? "Yes" : "No"],
    ["Cost reporting", c.cost_reporting ? "Yes" : "Estimated by platform"],
  ];
  return (
    <dl className="divide-y divide-border/70 rounded-lg text-xs shadow-[0_0_0_1px_hsl(var(--border))]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-2 px-3 py-1.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const TRIGGERS: { value: Trigger; label: string }[] = [
  { value: "on_message", label: "Message received" },
  { value: "on_call", label: "Called" },
  { value: "on_handoff", label: "Handed off" },
  { value: "on_state", label: "State change" },
  { value: "on_schedule", label: "Schedule" },
  { value: "on_start", label: "System start" },
  { value: "on_event", label: "Platform event" },
];

function AgentInspector({ id, a, doc, set }: { id: string; a: AgentData; doc: SystemDoc; set: (patch: Partial<AgentData>) => void }) {
  const runner = runnerById(a.harness.runner);
  const setHarness = (patch: Partial<AgentData["harness"]>) => set({ harness: { ...a.harness, ...patch } });
  const setContext = (patch: Partial<AgentData["context"]>) => set({ context: { ...a.context, ...patch } });
  const stores = doc.nodes.filter((n) => n.data.kind === "store");
  const others = doc.nodes.filter((n) => n.data.kind === "agent" && n.id !== id);
  const usesModel = a.harness.tier === "native" || a.harness.tier === "sdk";
  const noCtx = a.harness.capabilities.context_control === "none";

  const changeTier = (tier: HarnessTier) => {
    const r = RUNNERS.find((x) => x.tier === tier)!;
    setHarness({ tier, runner: r.id, capabilities: { ...r.caps }, loop: tier === "native" ? (a.harness.loop ?? "react") : undefined });
  };
  const changeRunner = (rid: string) => {
    const r = runnerById(rid)!;
    setHarness({ runner: rid, capabilities: { ...r.caps } });
  };
  const binding = (storeId: string) => a.context.sources.find((s) => s.store === storeId);
  const setBinding = (storeId: string, mode: StoreBinding["mode"] | "off") => {
    const rest = a.context.sources.filter((s) => s.store !== storeId);
    setContext({ sources: mode === "off" ? rest : [...rest, { store: storeId, mode, top_k: binding(storeId)?.top_k ?? 5 }] });
  };

  return (
    <Tabs defaultValue="basic" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="mx-4 mt-3 grid grid-cols-5">
        <TabsTrigger value="basic">Basics</TabsTrigger>
        <TabsTrigger value="harness">Harness</TabsTrigger>
        <TabsTrigger value="tools">Tools</TabsTrigger>
        <TabsTrigger value="context">Context</TabsTrigger>
        <TabsTrigger value="schedule">Schedule</TabsTrigger>
      </TabsList>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <TabsContent value="basic" className="mt-0 space-y-4">
          <TextField label="Name" value={a.name} onChange={(name) => set({ name })} />
          <TextField label="Role" value={a.role} onChange={(role) => set({ role })} placeholder="One line on what it is responsible for" />
          {usesModel ? (
            <SelectField
              label="Base model"
              value={a.model}
              onChange={(model) => set({ model })}
              items={doc.models.map((m) => ({ value: m.id, label: m.model, hint: m.price_in || m.price_out ? `$${m.price_in}/$${m.price_out}` : m.provider }))}
              hint="Input / output price per million tokens; manage these under Models & Tools"
            />
          ) : (
            <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
              {a.harness.tier === "process" ? "A process harness picks and calls its own model; set the model in its own config." : "A remote agent's model is chosen by the remote side."}
            </p>
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
        </TabsContent>

        <TabsContent value="harness" className="mt-0 space-y-4">
          <SelectField
            label="Integration tier"
            value={a.harness.tier}
            onChange={changeTier}
            items={opts([
              ["native", "native · built into the platform"],
              ["sdk", "sdk · in-process SDK"],
              ["process", "process · external process"],
              ["remote", "remote · remote agent"],
            ])}
          />
          {a.harness.tier !== "native" && (
            <SelectField
              label="Adapter"
              value={a.harness.runner ?? ""}
              onChange={changeRunner}
              items={RUNNERS.filter((r) => r.tier === a.harness.tier).map((r) => ({ value: r.id, label: r.label }))}
              hint={runner?.hint}
            />
          )}
          {a.harness.tier === "native" && (
            <SelectField
              label="Loop"
              value={a.harness.loop ?? "react"}
              onChange={(loop) => setHarness({ loop })}
              items={opts([
                ["react", "react · reason-act loop"],
                ["plan_execute", "plan_execute · plan, then execute"],
                ["single_shot", "single_shot · one call"],
              ])}
            />
          )}
          {a.harness.tier === "process" && <TextField label="Launch command" value={a.harness.command ?? ""} onChange={(command) => setHarness({ command })} mono placeholder={a.harness.runner === "claude-code" ? "Default: claude -p --bare" : "./my_agent --json"} />}
          {a.harness.tier === "remote" && <TextField label="Agent Card URL" value={a.harness.url ?? ""} onChange={(url) => setHarness({ url })} mono placeholder="https://agent.example.com/.well-known/agent-card.json" />}
          <AreaField label="Instructions" value={a.harness.instructions} onChange={(instructions) => setHarness({ instructions })} rows={6} hint={a.harness.tier === "process" ? "Passed via --append-system-prompt or the first message" : undefined} />
          <NumberField label="Max steps" value={a.harness.max_steps} onChange={(v) => setHarness({ max_steps: v ?? undefined })} />
          {a.harness.tier !== "native" && (
            <SelectField
              label="Harness's own memory"
              value={a.harness.own_memory ?? "keep"}
              onChange={(own_memory) => setHarness({ own_memory })}
              items={opts([
                ["keep", "Keep"],
                ["disable", "Disable (use platform Stores only)"],
              ])}
              hint="Avoids two memory systems conflicting"
            />
          )}
          <Section title="Capabilities">
            <CapabilityTable a={a} />
            <p className="text-[11px] text-muted-foreground">Capabilities come from the adapter. The platform uses them to decide at which boundary context, tools and approvals are injected.</p>
          </Section>
        </TabsContent>

        <TabsContent value="tools" className="mt-0 space-y-4">
          {a.harness.capabilities.tool_injection.length === 0 && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">This harness does not support tool injection.</p>}
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
          <p className="text-[11px] text-muted-foreground">Communication tools (send_message, call_, handoff_to_) are injected automatically from the edges on the canvas; no need to pick them here.</p>
          <Section title="Spawn">
            <Toggle label="Allow spawning sub-agents" checked={!!a.spawn} onChange={(on) => set({ spawn: on ? { template: others[0]?.id ?? "", max_instances: 4 } : null })} hint="The platform injects spawn_agent / retire_agent; new instances never exceed this agent's permissions or budget" />
            {a.spawn && (
              <>
                <SelectField label="Template" value={a.spawn.template} onChange={(template) => set({ spawn: { ...a.spawn!, template } })} items={others.map((n) => ({ value: n.id, label: (n.data as AgentData).name }))} />
                <NumberField label="Max instances" value={a.spawn.max_instances} onChange={(v) => set({ spawn: { ...a.spawn!, max_instances: v ?? 1 } })} />
              </>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="context" className="mt-0 space-y-4">
          {noCtx && <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">This harness does not expose context control. The settings below take effect through MCP tools, env files and message prefixes; window and compaction settings have no effect.</p>}
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
          <Section title="Memory & knowledge sources">
            {stores.length === 0 ? (
              <p className="text-xs text-muted-foreground">No Stores in this system yet. Drag one in from the left.</p>
            ) : (
              stores.map((s) => (
                <SelectField
                  key={s.id}
                  label={(s.data as StoreData).name}
                  value={binding(s.id)?.mode ?? "off"}
                  onChange={(m) => setBinding(s.id, m as StoreBinding["mode"] | "off")}
                  items={opts([
                    ["off", "Off"],
                    ["tool", "As a tool: the agent decides when to look up"],
                    ["auto_inject", "Auto-inject: retrieve before every call"],
                    ["pinned", "Pinned"],
                  ])}
                />
              ))
            )}
          </Section>
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

function Body({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-4">{children}</div>;
}

function OtherNodeInspector({ id, data, doc, set }: { id: string; data: NodeData; doc: SystemDoc; set: (patch: Partial<NodeData>) => void }) {
  switch (data.kind) {
    case "human": {
      const h = data as HumanData;
      return (
        <Body>
          <TextField label="Name" value={h.name} onChange={(name) => set({ name })} />
          <TextField label="Role" value={h.role} onChange={(role) => set({ role })} />
          <Toggle label="Can approve" checked={h.approves} onChange={(approves) => set({ approves } as Partial<HumanData>)} hint="Calls to this human show up in their inbox as approval requests" />
        </Body>
      );
    }
    case "env": {
      const e = data as EnvData;
      return (
        <Body>
          <TextField label="Name" value={e.name} onChange={(name) => set({ name })} />
          <SelectField label="Type" value={e.env_kind} onChange={(env_kind) => set({ env_kind } as Partial<EnvData>)} items={opts([["sandbox", "sandbox · container / microVM"], ["browser", "browser · headless browser"], ["database", "database · managed database"], ["service", "service · managed service"], ["external", "external · third-party system"]])} />
          {e.env_kind === "sandbox" && <TextField label="Image" value={e.image} onChange={(image) => set({ image } as Partial<EnvData>)} mono />}
          <SelectField label="Lifecycle" value={e.lifecycle} onChange={(lifecycle) => set({ lifecycle } as Partial<EnvData>)} items={opts([["per_run", "New for each run"], ["per_session", "Per session"], ["persistent", "Persistent"]])} />
          <SelectField label="Snapshots" value={e.snapshot} onChange={(snapshot) => set({ snapshot } as Partial<EnvData>)} items={opts([["never", "Never"], ["on_write", "On every write"], ["on_checkpoint", "At checkpoints"]])} hint={e.env_kind === "external" ? "External envs cannot be snapshotted; actions are only logged" : "Enables replay and forking"} />
          <TextField label="Allowed egress (comma-separated; all blocked by default)" value={e.egress.join(", ")} onChange={(v) => set({ egress: v.split(",").map((s) => s.trim()).filter(Boolean) } as Partial<EnvData>)} mono />
        </Body>
      );
    }
    case "store": {
      const s = data as StoreData;
      return (
        <Body>
          <TextField label="Name" value={s.name} onChange={(name) => set({ name })} />
          <SelectField label="Type" value={s.store_kind} onChange={(store_kind) => set({ store_kind } as Partial<StoreData>)} items={opts([["memory", "memory · memory"], ["knowledge", "knowledge · knowledge base"], ["board", "board · task board"]])} />
          <SelectField label="Backend" value={s.backend} onChange={(backend) => set({ backend } as Partial<StoreData>)} items={opts([["builtin", "Built-in"], ["pgvector", "pgvector"], ["qdrant", "Qdrant"], ["mcp", "MCP knowledge server"], ["http", "HTTP"]])} />
          <SelectField label="Scope" value={s.scope} onChange={(scope) => set({ scope } as Partial<StoreData>)} items={opts([["agent", "Private to the agent"], ["group", "Shared within the Group"], ["end_user", "Isolated per end user"], ["system", "Whole system"]])} />
          <SelectField label="Writes" value={s.write} onChange={(write) => set({ write } as Partial<StoreData>)} items={opts([["agent_tool", "Agent writes via a tool"], ["auto_extract", "Platform extracts automatically"], ["none", "Read-only"]])} />
          {s.store_kind === "knowledge" && <TextField label="Sources (comma-separated)" value={s.sources.join(", ")} onChange={(v) => set({ sources: v.split(",").map((x) => x.trim()).filter(Boolean) } as Partial<StoreData>)} mono />}
        </Body>
      );
    }
    case "channel": {
      const c = data as ChannelData;
      const members = doc.edges.filter((e) => e.target === id || e.source === id).map((e) => (e.source === id ? e.target : e.source));
      return (
        <Body>
          <TextField label="Name" value={c.name} onChange={(name) => set({ name })} />
          <SelectField label="Type" value={c.channel_type} onChange={(channel_type) => set({ channel_type } as Partial<ChannelData>)} items={opts([["room", "room · broadcast to members"], ["topic", "topic · publish / subscribe"]])} />
          <SelectField label="Speaking policy" value={c.policy} onChange={(policy) => set({ policy } as Partial<ChannelData>)} items={opts([["free", "Free: anyone triggered may reply"], ["round_robin", "Round robin"], ["selector", "A moderator picks who speaks next"], ["mention", "Only @-mentioned members reply"], ["bid", "Bid: the most eager member speaks"]])} />
          {c.policy === "selector" && (
            <SelectField label="Moderator" value={c.selector ?? ""} onChange={(selector) => set({ selector } as Partial<ChannelData>)} items={members.map((m) => ({ value: m, label: (doc.nodes.find((n) => n.id === m)?.data as { name?: string })?.name ?? m }))} />
          )}
          <SelectField label="History for late joiners" value={c.history} onChange={(history) => set({ history } as Partial<ChannelData>)} items={opts([["persistent", "Full history"], ["since_join", "Only since joining"]])} />
          <p className="text-xs text-muted-foreground">Members: the {members.length} nodes connected to this room.</p>
        </Body>
      );
    }
    case "group": {
      const g = data as GroupData;
      const members = doc.nodes.filter((n) => n.parent === id).map((n) => ({ value: n.id, label: (n.data as { name?: string }).name ?? n.id }));
      return (
        <Body>
          <TextField label="Name" value={g.name} onChange={(name) => set({ name })} />
          <SelectField label="Entry member" value={g.entry} onChange={(entry) => set({ entry } as Partial<GroupData>)} items={members} hint="Messages and calls to the Group from outside arrive here" />
          <SelectField label="Output from" value={g.output_from} onChange={(output_from) => set({ output_from } as Partial<GroupData>)} items={members} />
          <NumberField label="Group budget (USD)" value={g.budget_usd} onChange={(budget_usd) => set({ budget_usd } as Partial<GroupData>)} step={0.5} />
          <SelectField label="On internal failure" value={g.on_error} onChange={(on_error) => set({ on_error } as Partial<GroupData>)} items={opts([["retry_then_fail_up", "Retry once, then fail up"], ["fail_up", "Fail up"], ["ignore", "Ignore"]])} />
          <p className="text-xs text-muted-foreground">Drag a node into the frame to add it to the Group, or out to remove it. A Group is also a boundary for budget, permissions and errors.</p>
        </Body>
      );
    }
    default:
      return null;
  }
}

function EdgeInspector({ e, doc, set }: { e: SysEdge; doc: SystemDoc; set: (patch: Partial<SysEdge>) => void }) {
  const target = doc.nodes.find((n) => n.id === e.target);
  const toResource = target?.data.kind === "env" || target?.data.kind === "store";
  const kinds: EdgeKind[] = toResource ? ["access"] : ["message", "call", "handoff", "access"];
  return (
    <Body>
      <SelectField label="Interaction" value={e.kind} onChange={(kind) => set({ kind })} items={kinds.map((k) => ({ value: k, label: EDGE_LABEL[k] }))} hint={toResource ? "Edges to an env or store can only be access" : undefined} />
      {e.kind !== "access" && <TextField label="Label" value={e.label ?? ""} onChange={(label) => set({ label: label || undefined })} />}
      {e.kind === "handoff" && (
        <SelectField label="Context carried on handoff" value={e.carry ?? "summary"} onChange={(carry) => set({ carry })} items={opts([["none", "None"], ["summary", "Summary"], ["full", "Full history"]])} />
      )}
      {e.kind === "access" && <SelectField label="Access" value={e.access ?? "read_write"} onChange={(access) => set({ access })} items={opts([["read", "Read-only"], ["read_write", "Read/write"]])} />}
      {(e.kind === "message" || e.kind === "call") && <TextField label="Message schema (optional)" value={e.schema ?? ""} onChange={(schema) => set({ schema: schema || undefined })} mono placeholder="ReviewRequest" />}
      <Section title="Gate">
        <Toggle label="Require a check before crossing this edge" checked={!!e.gate} onChange={(on) => set({ gate: on ? { name: "gate", condition: "", on_fail: "block", escalate_after: 3 } : null })} />
        {e.gate && (
          <>
            <TextField label="Name" value={e.gate.name} onChange={(name) => set({ gate: { ...e.gate!, name } })} />
            <TextField label="Condition" value={e.gate.condition} onChange={(condition) => set({ gate: { ...e.gate!, condition } })} mono hint="check: <command> (runs in the env) · judge: <agent id> (scored by a judge) · expr: <expression>" />
            <SelectField label="On failure" value={e.gate.on_fail} onChange={(on_fail) => set({ gate: { ...e.gate!, on_fail } })} items={opts([["block", "Block and tell the sender why"], ["require_approval", "Ask a human to approve"], ["route_back", "Send back to the sender"]])} />
            <NumberField label="Escalate to a human after N rejections" value={e.gate.escalate_after} onChange={(v) => set({ gate: { ...e.gate!, escalate_after: v ?? 3 } })} />
          </>
        )}
      </Section>
    </Body>
  );
}

const TERMINATION = [
  { value: "any_agent_calls_finish", label: "An agent calls finish" },
  { value: "all_idle", label: "All idle" },
  { value: "budget_exceeded", label: "Budget exceeded" },
  { value: "max_rounds", label: "Max rounds reached" },
  { value: "judge_outputs_verdict", label: "Judge returns a verdict" },
];

function SystemInspector({ doc, update, issues }: { doc: SystemDoc; update: Update; issues: Issue[] }) {
  const set = (patch: Partial<SystemDoc>) => update((d) => ({ ...d, ...patch }));
  const [showAll, setShowAll] = useState(false);
  return (
    <>
      <div className="border-b border-border/70 px-4 py-3">
        <p className="text-sm font-semibold">System settings</p>
        <p className="text-xs text-muted-foreground">Select a node or edge on the canvas to edit it</p>
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
        <Section
          title="System policies"
          aside={
            <Button variant="ghost" size="sm" className="h-7" onClick={() => set({ policies: [...doc.policies, { id: `p${Date.now() % 100000}`, on: "usage", condition: "", action: "notify" }] })}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          }
        >
          {doc.policies.length === 0 && <p className="text-xs text-muted-foreground">No system policies. Edit gates by selecting their edge.</p>}
          {doc.policies.map((p, i) => {
            const setP = (patch: Partial<typeof p>) => set({ policies: doc.policies.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={p.id} className="space-y-2 rounded-lg p-3 shadow-[0_0_0_1px_hsl(var(--border))]">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">on</span>
                  <input className="glass-input h-8 min-w-0 flex-1 px-2 font-mono text-xs" value={p.on} onChange={(e) => setP({ on: e.target.value })} aria-label="Event" />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => set({ policies: doc.policies.filter((_, j) => j !== i) })} aria-label="Delete policy">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">if</span>
                  <input className="glass-input h-8 min-w-0 flex-1 px-2 font-mono text-xs" value={p.condition} onChange={(e) => setP({ condition: e.target.value })} aria-label="Condition" />
                </div>
                <SelectField label="do" value={p.action} onChange={(action) => setP({ action })} items={opts([["terminate", "terminate"], ["suspend", "suspend"], ["notify", "notify"], ["block", "block"], ["require_approval", "require_approval"]])} />
              </div>
            );
          })}
        </Section>
        <Section title={`Issues (${issues.length})`} aside={issues.length > 6 && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : "Show all"}</button>}>
          {issues.length === 0 ? <p className="text-xs text-success">No issues found.</p> : <IssueList issues={showAll ? issues : issues.slice(0, 6)} />}
        </Section>
      </Body>
    </>
  );
}

export function Inspector({
  doc,
  update,
  nodeId,
  edgeId,
  issues,
  onClose,
}: {
  doc: SystemDoc;
  update: Update;
  nodeId?: string;
  edgeId?: string;
  issues: Issue[];
  onClose: () => void;
}) {
  const node = nodeId ? doc.nodes.find((n) => n.id === nodeId) : undefined;
  const edge = edgeId ? doc.edges.find((e) => e.id === edgeId) : undefined;

  const setNode = (patch: Partial<NodeData>) =>
    update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } as NodeData } : n)) }));
  const deleteNode = () =>
    update((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => n.id !== nodeId).map((n) => (n.parent === nodeId ? { ...n, parent: undefined, position: { x: n.position.x + (node?.position.x ?? 0), y: n.position.y + (node?.position.y ?? 0) } } : n)),
      edges: d.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    }));
  const setEdge = (patch: Partial<SysEdge>) => update((d) => ({ ...d, edges: d.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)) }));
  const deleteEdge = () => update((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== edgeId) }));

  if (node) {
    const name = "name" in node.data ? node.data.name : node.id;
    const own = issues.filter((i) => i.nodeId === node.id);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Header
          title={name}
          subtitle={`${KIND_LABEL[node.data.kind]} · id: ${node.id}`}
          avatar={<EntityAvatar kind={node.data.kind === "agent" ? "agent" : "system"} id={node.id} name={name} className="h-8 w-8 text-[11px]" />}
          onDelete={deleteNode}
          onClose={onClose}
        />
        {own.length > 0 && (
          <div className="px-4 pt-3">
            <IssueList issues={own} />
          </div>
        )}
        {node.data.kind === "agent" ? (
          <AgentInspector key={node.id} id={node.id} a={node.data as AgentData} doc={doc} set={setNode as (p: Partial<AgentData>) => void} />
        ) : (
          <OtherNodeInspector key={node.id} id={node.id} data={node.data} doc={doc} set={setNode} />
        )}
      </div>
    );
  }
  if (edge) {
    const nm = (id: string) => {
      const n = doc.nodes.find((x) => x.id === id);
      return n && "name" in n.data ? n.data.name : id;
    };
    const own = issues.filter((i) => i.edgeId === edge.id);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Header title={`${nm(edge.source)} → ${nm(edge.target)}`} subtitle={EDGE_LABEL[edge.kind]} avatar={<EntityAvatar kind="system" id={edge.id} name="" className="h-8 w-8" />} onDelete={deleteEdge} onClose={onClose} />
        {own.length > 0 && (
          <div className="px-4 pt-3">
            <IssueList issues={own} />
          </div>
        )}
        <EdgeInspector key={edge.id} e={edge} doc={doc} set={setEdge} />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SystemInspector doc={doc} update={update} issues={issues} />
    </div>
  );
}
