// Things agents use through access edges: envs (rooms and imported envs included) and plugins.
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Activity, BookOpen, Box, Brain, Database, FolderOpen, Globe, Hash, KanbanSquare, LayoutGrid, Loader, Monitor, Puzzle, RotateCcw, Server, ShieldCheck, Users, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { envNetwork, envToolNames, LIFECYCLE_LABEL } from "@/model/envTools";
import type { EnvData, PluginData } from "@/model/types";
import type { FlowNode } from "../convert";
import { ResHandle, Shell } from "./parts";

const ENV_ICON = { app: LayoutGrid, sandbox: Box, browser: Monitor, database: Database, service: Server, room: Hash, external: Globe } as const;
const POLICY_LABEL: Record<string, string> = { free: "free", round_robin: "round robin", selector: "selector", mention: "on @mention", bid: "bidding" };
const SOURCE_LABEL: Record<string, string> = { dtap: "DT", envgen: "env-gen", compose: "compose", "mas-env": "mas-env" };

const ACCESS_LABEL = { read: "reads", read_write: "uses" } as const;

/** One short line under the header: an icon and text, muted. */
function Row({ icon: Icon, children, title, tone }: { icon: typeof Box; children: React.ReactNode; title?: string; tone?: "warn" | "ok" }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground", tone === "warn" && "text-destructive", tone === "ok" && "text-emerald-700 dark:text-emerald-300")} title={title}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

export const EnvNode = memo(function EnvNode({ id, data, selected }: NodeProps<FlowNode>) {
  const e = data.sys as EnvData;
  const Icon = ENV_ICON[e.env_kind] ?? Box;
  const tools = envToolNames(e, id);
  const sub =
    e.env_kind === "room"
      ? `room · ${POLICY_LABEL[e.room?.policy ?? "free"]}`
      : e.manifest
        ? `${SOURCE_LABEL[e.manifest.source.format] ?? "imported"} · ${e.manifest.exposes.mcp ? `${tools.length} MCP tools` : `${e.manifest.exposes.http.length} HTTP`}`
        : `${e.env_kind}${e.env_kind === "sandbox" && e.image ? ` · ${e.image}` : ""}`;
  const users = data.users ?? [];
  const live = data.live;
  const net = envNetwork(e);
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} className={cn("w-[240px] border border-dashed border-border bg-secondary/40", e.env_kind === "room" && "rounded-[28px]")}>
      <ResHandle role="resource" hidden={data.readOnly} />
      <div className="flex items-center gap-2.5 p-3 pb-2">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center bg-card text-muted-foreground shadow-[var(--ring-shadow)]", e.env_kind === "room" ? "rounded-full" : "rounded-lg")}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{e.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1 border-t border-dashed border-border/70 px-3 py-2">
        {tools.length > 0 && (
          <Row icon={Wrench} title={tools.join(", ")}>
            {tools.slice(0, 3).join(" · ")}
            {tools.length > 3 ? ` +${tools.length - 3}` : ""}
          </Row>
        )}
        {net && (
          <Row icon={e.egress.length ? Globe : ShieldCheck} title={e.egress.length ? `Reaches only ${e.egress.join(", ")}, through the egress proxy; everything else is refused` : "No network at all"}>
            {net}
          </Row>
        )}
        {e.env_kind !== "room" && (
          <Row icon={RotateCcw} title="When its state starts over; whether agents share one machine">
            {LIFECYCLE_LABEL[e.lifecycle]}
            {e.env_kind === "sandbox" ? (e.share === "per_agent" ? " · one per agent" : " · shared") : ""}
          </Row>
        )}
        <Row icon={Users} title={users.map((u) => `${u.name} ${ACCESS_LABEL[u.access]}`).join("\n") || "Nobody is connected: draw an access edge from an agent"} tone={users.length ? undefined : "warn"}>
          {users.length ? users.map((u) => `${u.name}${u.access === "read" ? " (read)" : ""}`).join(", ") : "nobody connected"}
        </Row>
        {live && (
          <Row
            icon={live.state === "starting" ? Loader : Activity}
            tone={live.last?.exit !== undefined && live.last.exit !== 0 ? "warn" : live.state === "ready" ? "ok" : undefined}
            title={[live.isolation, live.last ? `last: ${live.last.tool} ${live.last.args}` : "", `${live.calls} tool call${live.calls === 1 ? "" : "s"}`, live.refused ? `${live.refused} connection${live.refused === 1 ? "" : "s"} refused` : ""].filter(Boolean).join("\n")}
          >
            {live.state === "starting" ? "starting…" : live.last ? `${live.last.tool}${live.last.exit !== undefined ? ` → exit ${live.last.exit}` : ""} · ${live.calls} call${live.calls === 1 ? "" : "s"}` : live.state}
            {live.refused ? ` · ${live.refused} refused` : ""}
          </Row>
        )}
      </div>
    </Shell>
  );
});

export const PLUGIN_ICON = { memory: Brain, knowledge: BookOpen, workspace: FolderOpen, board: KanbanSquare, custom: Puzzle } as const;

export const PluginNode = memo(function PluginNode({ data, selected }: NodeProps<FlowNode>) {
  const p = data.sys as PluginData;
  const Icon = PLUGIN_ICON[p.preset] ?? Puzzle;
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} className="w-[190px] border border-dashed border-border bg-secondary/40">
      <ResHandle role="resource" hidden={data.readOnly} />
      <div className="flex items-center gap-2.5 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-[var(--ring-shadow)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{p.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {p.preset} · {p.spec.scope} · {p.spec.tools.length} tools
          </p>
        </div>
      </div>
    </Shell>
  );
});

