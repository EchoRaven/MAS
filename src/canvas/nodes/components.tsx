// Components that do work: agents, bare model calls, functions, humans.
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Sparkles, SquareFunction, User } from "lucide-react";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { cn } from "@/lib/utils";
import { runnerById } from "@/model/defaults";
import { interfaceOf } from "@/model/ports";
import type { AgentData, FunctionNodeData, HumanData, ModelNodeData } from "@/model/types";
import { useCanvasContext } from "../context";
import type { FlowNode } from "../convert";
import { Chip, OpenHint, padFor, Ports, ResHandle, Shell, StatusLine, TIER_TINT } from "./parts";

export const AgentNode = memo(function AgentNode({ id, data, selected }: NodeProps<FlowNode>) {
  const a = data.sys as AgentData;
  const { modelLabel } = useCanvasContext();
  const runner = runnerById(a.harness.runner);
  const stages = a.pipeline.pre.length + a.pipeline.post.length;
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} entry={data.entry} className="w-[250px]">
      <Ports inputs={a.interface.inputs} outputs={a.interface.outputs} wired={data.wired} hidden={data.readOnly} />
      <ResHandle role="user" hidden={data.readOnly} />
      {!data.readOnly && <OpenHint />}
      <div className={cn("flex items-start gap-2.5 p-3 pb-2", padFor(a.interface))}>
        <EntityAvatar kind="agent" id={id} name={a.name} className="h-8 w-8 text-[11px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <p className="truncate text-[13px] font-semibold leading-tight">{a.name}</p>
            <StatusLine status={data.status} />
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{a.role || "No role"}</p>
        </div>
      </div>
      <div className={cn("flex flex-wrap gap-1 border-t border-border/70 px-3 py-2", padFor(a.interface))}>
        <Chip className={TIER_TINT[a.harness.tier]}>{a.harness.tier === "native" ? `native · ${a.harness.loop ?? "react"}` : (runner?.label ?? a.harness.tier)}</Chip>
        {(a.harness.tier === "native" || a.harness.tier === "sdk") && <Chip>{modelLabel(a.model)}</Chip>}
        {a.tools.length > 0 && <Chip>{a.tools.length} tools</Chip>}
        {stages > 0 && <Chip className="bg-info/10 text-info">{stages} stage{stages > 1 ? "s" : ""}</Chip>}
        {a.spawn && (
          <Chip className="bg-info/10 text-info">
            <Sparkles className="h-2.5 w-2.5" /> spawns ≤{a.spawn.max_instances}
          </Chip>
        )}
      </div>
    </Shell>
  );
});

export const ModelNode = memo(function ModelNode({ data, selected }: NodeProps<FlowNode>) {
  const m = data.sys as ModelNodeData;
  const { modelLabel } = useCanvasContext();
  const out = m.interface.outputs[0];
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} entry={data.entry} className="min-w-[200px]">
      <Ports inputs={m.interface.inputs} outputs={m.interface.outputs} wired={data.wired} hidden={data.readOnly} />
      <div className={cn("flex items-center gap-2.5 p-3", padFor(m.interface))}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <p className="truncate text-[13px] font-semibold">{m.name}</p>
            <StatusLine status={data.status} />
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {modelLabel(m.model)}
            {out?.type === "json" ? ` · json${out.schema ? `<${out.schema}>` : ""}` : ""}
          </p>
        </div>
      </div>
    </Shell>
  );
});

export const FunctionNode = memo(function FunctionNode({ data, selected }: NodeProps<FlowNode>) {
  const f = data.sys as FunctionNodeData;
  const firstLine = f.fn.code.split("\n").find((l) => l.trim() && !l.trim().startsWith("//")) ?? "";
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} entry={data.entry} className="min-w-[200px] max-w-[260px]">
      <Ports inputs={f.interface.inputs} outputs={f.interface.outputs} wired={data.wired} hidden={data.readOnly} />
      <ResHandle role="user" hidden={data.readOnly} />
      <div className={cn("p-3", padFor(f.interface))}>
        <div className="flex items-center gap-2">
          <SquareFunction className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{f.name}</p>
          <Chip>{f.fn.lang}</Chip>
        </div>
        {firstLine && <p className="mt-1.5 truncate rounded bg-secondary/70 px-1.5 py-1 font-mono text-[10px] text-muted-foreground">{firstLine.trim()}</p>}
      </div>
    </Shell>
  );
});

export const HumanNode = memo(function HumanNode({ data, selected }: NodeProps<FlowNode>) {
  const h = data.sys as HumanData;
  const ifc = interfaceOf(h);
  return (
    <Shell selected={selected} status={data.status} issues={data.issues} entry={data.entry} className="w-[180px]">
      <Ports inputs={ifc.inputs} outputs={ifc.outputs} wired={data.wired} hidden={data.readOnly} />
      <ResHandle role="user" hidden={data.readOnly} />
      <div className="flex items-center gap-2.5 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground outline -outline-offset-1 outline-border">
          <User className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{h.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{h.approves ? `Approver · ${h.role}` : h.role}</p>
        </div>
      </div>
    </Shell>
  );
});

