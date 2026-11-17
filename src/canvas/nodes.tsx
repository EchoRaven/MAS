import { memo, type ReactNode } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { BookOpen, Box, Database, Globe, Hash, KanbanSquare, Layers, Monitor, Server, Sparkles, User } from "lucide-react";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { cn } from "@/lib/utils";
import { runnerById } from "@/model/defaults";
import type { AgentData, ChannelData, EnvData, GroupData, HumanData, StoreData } from "@/model/types";
import { useCanvasContext } from "./context";
import type { FlowNode, RunStatus } from "./convert";

const STATUS_RING: Record<RunStatus, string> = {
  idle: "",
  working: "ring-2 ring-info shadow-[0_0_0_6px_hsl(var(--info)/0.15)]",
  waiting: "ring-2 ring-warning/80",
  done: "ring-2 ring-success/70",
  blocked: "ring-2 ring-destructive shadow-[0_0_0_6px_hsl(var(--destructive)/0.12)]",
};
const STATUS_TEXT: Record<RunStatus, string> = { idle: "空闲", working: "工作中", waiting: "等待", done: "完成", blocked: "被阻塞" };
const STATUS_DOT: Record<RunStatus, string> = {
  idle: "bg-muted-foreground/40",
  working: "bg-info animate-pulse",
  waiting: "bg-warning",
  done: "bg-success",
  blocked: "bg-destructive",
};

function Handles({ hidden }: { hidden?: boolean }) {
  const cls = cn("!h-2.5 !w-2.5 !border-2 !border-card !bg-muted-foreground/70 transition-opacity", hidden ? "!opacity-0" : "opacity-0 group-hover/node:opacity-100");
  return (
    <>
      <Handle type="source" position={Position.Top} id="t" className={cls} />
      <Handle type="source" position={Position.Right} id="r" className={cls} />
      <Handle type="source" position={Position.Bottom} id="b" className={cls} />
      <Handle type="source" position={Position.Left} id="l" className={cls} />
    </>
  );
}

function Shell({ selected, status, issues, children, className, readOnly }: { selected?: boolean; status?: RunStatus; issues?: number; children: ReactNode; className?: string; readOnly?: boolean }) {
  return (
    <div
      className={cn(
        "group/node relative rounded-xl bg-card text-card-foreground shadow-[var(--ring-shadow)] transition-shadow",
        selected && "ring-2 ring-ring",
        status && STATUS_RING[status],
        className,
      )}
    >
      <Handles hidden={readOnly} />
      {!!issues && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-white" title={`${issues} 条提醒`}>
          {issues}
        </span>
      )}
      {children}
    </div>
  );
}

function StatusLine({ status }: { status?: RunStatus }) {
  if (!status) return null;
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_TEXT[status]}
    </span>
  );
}

const Chip = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground", className)}>{children}</span>
);

const TIER_TINT: Record<string, string> = {
  native: "bg-success/10 text-success",
  sdk: "bg-info/10 text-info",
  process: "bg-warning/10 text-warning",
  remote: "bg-secondary text-muted-foreground",
};

export const AgentNode = memo(function AgentNode({ id, data, selected }: NodeProps<FlowNode>) {
  const a = data.sys as AgentData;
  const { modelLabel } = useCanvasContext();
  const runner = runnerById(a.harness.runner);
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} readOnly={data.readOnly} className="w-[220px]">
      <div className="flex items-start gap-2.5 p-3 pb-2">
        <EntityAvatar kind="agent" id={id} name={a.name} className="h-8 w-8 text-[11px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <p className="truncate text-[13px] font-semibold leading-tight">{a.name}</p>
            <StatusLine status={data.status} />
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{a.role || "未填写角色"}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-t border-border/70 px-3 py-2">
        <Chip className={TIER_TINT[a.harness.tier]}>{a.harness.tier === "native" ? `native · ${a.harness.loop ?? "react"}` : (runner?.label ?? a.harness.tier)}</Chip>
        {(a.harness.tier === "native" || a.harness.tier === "sdk") && <Chip>{modelLabel(a.model)}</Chip>}
        {a.tools.length > 0 && <Chip>{a.tools.length} tools</Chip>}
        {a.spawn && (
          <Chip className="bg-info/10 text-info">
            <Sparkles className="h-2.5 w-2.5" /> 招募 ≤{a.spawn.max_instances}
          </Chip>
        )}
      </div>
    </Shell>
  );
});

export const HumanNode = memo(function HumanNode({ data, selected }: NodeProps<FlowNode>) {
  const h = data.sys as HumanData;
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} readOnly={data.readOnly} className="w-[180px]">
      <div className="flex items-center gap-2.5 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground outline -outline-offset-1 outline-border">
          <User className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{h.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{h.approves ? `审批 · ${h.role}` : h.role}</p>
        </div>
      </div>
    </Shell>
  );
});

const ENV_ICON = { sandbox: Box, browser: Monitor, database: Database, service: Server, external: Globe } as const;

export const EnvNode = memo(function EnvNode({ data, selected }: NodeProps<FlowNode>) {
  const e = data.sys as EnvData;
  const Icon = ENV_ICON[e.env_kind] ?? Box;
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} readOnly={data.readOnly} className="w-[190px] border border-dashed border-border bg-secondary/40">
      <div className="flex items-center gap-2.5 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-[var(--ring-shadow)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{e.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            env · {e.env_kind}
            {e.env_kind === "sandbox" && e.image ? ` · ${e.image}` : ""}
          </p>
        </div>
      </div>
    </Shell>
  );
});

const STORE_ICON = { memory: Layers, knowledge: BookOpen, board: KanbanSquare } as const;

export const StoreNode = memo(function StoreNode({ data, selected }: NodeProps<FlowNode>) {
  const s = data.sys as StoreData;
  const Icon = STORE_ICON[s.store_kind] ?? Database;
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} readOnly={data.readOnly} className="w-[180px] border border-dashed border-border bg-secondary/40">
      <div className="flex items-center gap-2.5 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-[var(--ring-shadow)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{s.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {s.store_kind} · {s.scope}
          </p>
        </div>
      </div>
    </Shell>
  );
});

const POLICY_LABEL: Record<string, string> = { free: "自由发言", round_robin: "轮流", selector: "主持人指定", mention: "@ 才回应", bid: "竞价" };

export const ChannelNode = memo(function ChannelNode({ data, selected }: NodeProps<FlowNode>) {
  const c = data.sys as ChannelData;
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} readOnly={data.readOnly} className="rounded-full">
      <div className="flex items-center gap-2 py-2 pl-2 pr-4">
        <EntityAvatar kind="run" id={c.name} name={c.name} className="h-7 w-7 rounded-full" />
        <div>
          <p className="flex items-center text-[13px] font-semibold">
            <Hash className="h-3 w-3 text-muted-foreground" />
            {c.name}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {c.channel_type} · {POLICY_LABEL[c.policy]}
          </p>
        </div>
      </div>
    </Shell>
  );
});

export const GroupNode = memo(function GroupNode({ data, selected }: NodeProps<FlowNode>) {
  const g = data.sys as GroupData;
  return (
    <div
      className={cn(
        "group/node relative h-full w-full rounded-2xl border border-dashed border-muted-foreground/40 bg-secondary/30",
        selected && "border-ring",
        data.status && STATUS_RING[data.status],
      )}
    >
      {!data.readOnly && <NodeResizer isVisible={selected} minWidth={240} minHeight={160} lineClassName="!border-ring" handleClassName="!h-2.5 !w-2.5 !rounded-sm !border-ring !bg-card" />}
      <Handles hidden={data.readOnly} />
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold">{g.name}</span>
        <span className="text-[10px] text-muted-foreground">
          Group · {data.members ?? 0} 个成员{g.budget_usd != null ? ` · 预算 $${g.budget_usd}` : ""}
        </span>
        {!!data.issues && <span className="ml-auto rounded-full bg-warning px-1.5 text-[10px] font-semibold text-white">{data.issues}</span>}
      </div>
    </div>
  );
});

export const NODE_TYPES = {
  agent: AgentNode,
  human: HumanNode,
  env: EnvNode,
  store: StoreNode,
  channel: ChannelNode,
  group: GroupNode,
};
