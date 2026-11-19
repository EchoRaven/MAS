import { checkContract, manifestToYaml } from "@/model/envspec";
import { nodeName } from "@/model/ports";
import { defaultDbQuery } from "@/model/pipelines";
import type { EnvData, SystemDoc } from "@/model/types";
import { opts, Section, SelectField, TextField } from "../fields";
import { DbQueryEditor } from "./DbQueryEditor";
import { EnvContents } from "./EnvContents";
import { EnvTry } from "./EnvTry";
import { Body, IssueList, Note } from "./shared";

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
          <TextField label="Egress" hint="Hosts it may reach (through the egress proxy), comma-separated: example.com, *.github.com, host:8443. Everything else, and every private address, is blocked. Empty: no network at all." placeholder="none" value={e.egress.join(", ")} onChange={(v) => set({ egress: v.split(",").map((s) => s.trim()).filter(Boolean) })} mono />
          {e.env_kind === "sandbox" && (
            <SelectField
              label="Machines"
              value={e.share ?? "shared"}
              onChange={(share) => set({ share })}
              items={opts([["shared", "One, shared by every agent connected"], ["per_agent", "One per agent: own machine and /work"]])}
              hint="Shared: agents see each other's files (a team on one repo). Per agent: each is isolated from the others."
            />
          )}
        </>
      )}
      {e.env_kind === "database" && <DbQueryEditor value={e.db ?? defaultDbQuery()} onChange={(db) => set({ db })} doc={doc} />}
      <Section title="Contents" defaultOpen>
        <EnvContents systemId={doc.id} envId={id} />
      </Section>
      {e.env_kind !== "room" && (
        <Section title="Try it">
          <EnvTry systemId={doc.id} envId={id} />
        </Section>
      )}
      {m && (
        <Section title="Imported contract">
          <Note tone="info">
            {SOURCE[m.source.format] ?? m.source.format}
            {m.version ? ` · v${m.version}` : ""} · {m.exposes.mcp ? `${m.exposes.mcp.tools.length} MCP tools` : "no MCP"} · {m.lifecycle.reset ? "resettable" : "no reset"}
          </Note>
          <IssueList issues={checkContract(m)} />
          <details className="overflow-hidden rounded-lg bg-secondary/40 ring-1 ring-border/50">
            <summary className="cursor-pointer px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground">Manifest · mas-env/1</summary>
            <pre className="max-h-72 overflow-auto border-t border-border/50 px-2.5 py-2 font-mono text-[10px] leading-relaxed">{manifestToYaml(m)}</pre>
          </details>
        </Section>
      )}
    </Body>
  );
}
