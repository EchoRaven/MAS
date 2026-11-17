// Groups: a collapsed card outside, and boundary nodes for its ports inside.
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Layers, LogIn, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GroupData } from "@/model/types";
import type { FlowNode } from "../convert";
import { HANDLE, OpenHint, padFor, Ports, Shell, StatusLine, TYPE_DOT } from "./parts";

export const GroupNode = memo(function GroupNode({ data, selected }: NodeProps<FlowNode>) {
  const g = data.sys as GroupData;
  return (
    <div className="relative">
      {/* stacked look: it holds more inside */}
      <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-xl bg-card shadow-[var(--ring-shadow)]" />
      <Shell selected={selected} status={data.status} issues={data.issues} className="min-w-[220px]">
        <Ports inputs={g.interface.inputs} outputs={g.interface.outputs} wired={data.wired} hidden={data.readOnly} />
        {!data.readOnly && <OpenHint />}
        <div className={cn("flex items-center gap-2.5 p-3", padFor(g.interface))}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Layers className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <p className="truncate text-[13px] font-semibold">{g.name}</p>
              <StatusLine status={data.status} />
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              Group · {data.members ?? 0} inside{g.budget_usd != null ? ` · $${g.budget_usd}` : ""}
            </p>
          </div>
        </div>
      </Shell>
    </div>
  );
});

/** A group's own ports, seen from inside its canvas. */
export const BoundaryNode = memo(function BoundaryNode({ data }: NodeProps<FlowNode>) {
  const b = data.boundary!;
  const height = Math.max(64, b.ports.length * 30 + 28);
  return (
    <div className="relative w-[140px] rounded-xl border border-dashed border-muted-foreground/40 bg-secondary/40 px-3 py-2" style={{ height }}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        {b.dir === "in" ? <LogIn className="h-3.5 w-3.5" /> : <LogOut className="h-3.5 w-3.5" />}
        Group {b.dir === "in" ? "inputs" : "outputs"}
      </p>
      {b.ports.length === 0 && <p className="mt-1 text-[10px] text-muted-foreground">No ports. Add them in the group's Interface tab.</p>}
      {b.ports.map((p, i) => {
        const top = `${((i + 1) / (b.ports.length + 1)) * 100}%`;
        return (
          <div key={p.id}>
            <Handle
              id={p.id}
              type={b.dir === "in" ? "source" : "target"}
              position={b.dir === "in" ? Position.Right : Position.Left}
              style={{ top }}
              className={cn(HANDLE, TYPE_DOT[p.type], data.readOnly && "!opacity-0")}
            />
            <span className={cn("absolute -translate-y-1/2 text-[10px] font-medium", b.dir === "in" ? "right-3" : "left-3")} style={{ top }}>
              {p.id}
              <span className="text-muted-foreground"> · {p.type}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
});

