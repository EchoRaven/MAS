import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RUNNERS, runnerById } from "@/model/defaults";
import type { AgentData, HarnessTier } from "@/model/types";
import { AreaField, Hint, NumberField, opts, Section, SelectField, TextField } from "../fields";

const LEVEL_TINT = { full: "bg-success/10 text-success", partial: "bg-info/10 text-info", none: "bg-secondary text-muted-foreground" };

export function CapabilityTable({ a }: { a: AgentData }) {
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
    <dl className="divide-y divide-border/50 overflow-hidden rounded-lg bg-secondary/30 text-[12px] ring-1 ring-border/50">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The harness: which loop drives the model, how it is launched, and what it lets the platform control. */
export function HarnessTab({ a, set }: { a: AgentData; set: (patch: Partial<AgentData>) => void }) {
  const runner = runnerById(a.harness.runner);
  const setHarness = (patch: Partial<AgentData["harness"]>) => set({ harness: { ...a.harness, ...patch } });
  const changeTier = (tier: HarnessTier) => {
    const r = RUNNERS.find((x) => x.tier === tier)!;
    setHarness({ tier, runner: r.id, capabilities: { ...r.caps }, loop: tier === "native" ? (a.harness.loop ?? "react") : undefined });
  };
  return (
    <div className="space-y-2">
      <SelectField
        label="Tier"
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
          onChange={(rid) => setHarness({ runner: rid, capabilities: { ...runnerById(rid)!.caps } })}
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
      {(a.harness.tier === "process" || a.harness.runner === "langgraph") && (
        <TextField label={a.harness.runner === "langgraph" ? "Graph (path:attr)" : "Launch command"} value={a.harness.command ?? ""} onChange={(command) => setHarness({ command })} mono placeholder={a.harness.runner === "claude-code" ? "Default: claude -p --bare" : "./my_agent --json"} />
      )}
      {a.harness.tier === "remote" && <TextField label="Agent Card URL" value={a.harness.url ?? ""} onChange={(url) => setHarness({ url })} mono placeholder="https://agent.example.com/.well-known/agent-card.json" />}
      <AreaField label="Instructions" value={a.harness.instructions} onChange={(instructions) => setHarness({ instructions })} rows={6} hint={a.harness.tier === "process" ? "Passed via --append-system-prompt or the first message" : undefined} />
      <NumberField label="Max steps" value={a.harness.max_steps} onChange={(v) => setHarness({ max_steps: v ?? undefined })} />
      {a.harness.tier !== "native" && (
        <SelectField
          label="Own memory"
          value={a.harness.own_memory ?? "keep"}
          onChange={(own_memory) => setHarness({ own_memory })}
          items={opts([
            ["keep", "Keep"],
            ["disable", "Disable (use platform plugins only)"],
          ])}
          hint="Avoids two memory systems conflicting"
        />
      )}
      <Section title="Capabilities" aside={<Hint>Declared by the adapter. The platform uses them to decide where context, tools and approvals are injected.</Hint>}>
        <CapabilityTable a={a} />
      </Section>
    </div>
  );
}
