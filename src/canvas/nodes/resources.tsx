// Things agents use through access edges: envs (rooms and imported envs included) and plugins.
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { BookOpen, Box, Brain, Database, FolderOpen, Globe, Hash, KanbanSquare, LayoutGrid, Monitor, Puzzle, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EnvData, PluginData } from "@/model/types";
import type { FlowNode } from "../convert";
import { ResHandle, Shell } from "./parts";

const ENV_ICON = { app: LayoutGrid, sandbox: Box, browser: Monitor, database: Database, service: Server, room: Hash, external: Globe } as const;
const POLICY_LABEL: Record<string, string> = { free: "free", round_robin: "round robin", selector: "selector", mention: "on @mention", bid: "bidding" };
const SOURCE_LABEL: Record<string, string> = { dtap: "DT", envgen: "env-gen", compose: "compose", "mas-env": "mas-env" };

export const EnvNode = memo(function EnvNode({ data, selected }: NodeProps<FlowNode>) {
  const e = data.sys as EnvData;
  const Icon = ENV_ICON[e.env_kind] ?? Box;
  const tools = e.manifest?.exposes.mcp?.tools.length ?? 0;
  const sub =
    e.env_kind === "room"
      ? `room · ${POLICY_LABEL[e.room?.policy ?? "free"]}`
      : e.manifest
        ? `${SOURCE_LABEL[e.manifest.source.format] ?? "imported"} · ${tools ? `${tools} MCP tools` : `${e.manifest.exposes.http.length} HTTP`}`
        : `env · ${e.env_kind}${e.env_kind === "sandbox" && e.image ? ` · ${e.image}` : ""}`;
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} className={cn("w-[200px] border border-dashed border-border bg-secondary/40", e.env_kind === "room" && "rounded-full")}>
      <ResHandle role="resource" hidden={data.readOnly} />
      <div className="flex items-center gap-2.5 p-3">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center bg-card text-muted-foreground shadow-[var(--ring-shadow)]", e.env_kind === "room" ? "rounded-full" : "rounded-lg")}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{e.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
        </div>
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

