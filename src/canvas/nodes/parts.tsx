// Building blocks shared by every node: typed port handles, the access
// handle, the card shell, status line and chips.
import type { ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataType, PortSpec } from "@/model/types";
import { RES_PORT } from "@/model/types";
import type { RunStatus } from "../convert";

export const STATUS_RING: Record<RunStatus, string> = {
  idle: "",
  working: "ring-2 ring-info shadow-[0_0_0_6px_hsl(var(--info)/0.15)]",
  waiting: "ring-2 ring-warning/80",
  done: "ring-2 ring-success/70",
  blocked: "ring-2 ring-destructive shadow-[0_0_0_6px_hsl(var(--destructive)/0.12)]",
};
export const STATUS_TEXT: Record<RunStatus, string> = { idle: "Idle", working: "Working", waiting: "Waiting", done: "Done", blocked: "Blocked" };
export const STATUS_DOT: Record<RunStatus, string> = {
  idle: "bg-muted-foreground/40",
  working: "bg-info animate-pulse",
  waiting: "bg-warning",
  done: "bg-success",
  blocked: "bg-destructive",
};

/** Port colour by data type, so mismatches are visible before you connect. */
export const TYPE_DOT: Record<DataType, string> = {
  message: "!bg-muted-foreground",
  text: "!bg-foreground/60",
  json: "!bg-info",
  file: "!bg-warning",
  event: "!bg-success",
  any: "!bg-card !border-muted-foreground",
};

export const HANDLE = "!h-2.5 !w-2.5 !border-2 !border-card transition-transform hover:!scale-125";

/** Typed ports: inputs on the left, outputs on the right, labelled when there is more than one or the name says something. */
export function Ports({ inputs, outputs, wired = [], hidden }: { inputs: PortSpec[]; outputs: PortSpec[]; wired?: string[]; hidden?: boolean }) {
  const labelled = (list: PortSpec[], dflt: string) => list.length > 1 || (list[0] && list[0].id !== dflt);
  const side = (list: PortSpec[], dir: "in" | "out") => {
    const showLabel = labelled(list, dir);
    return list.map((p, i) => {
      const top = `${((i + 1) / (list.length + 1)) * 100}%`;
      return (
        <div key={`${dir}-${p.id}`}>
          <Handle
            id={p.id}
            type={dir === "in" ? "target" : "source"}
            position={dir === "in" ? Position.Left : Position.Right}
            style={{ top }}
            title={`${p.id}: ${p.type}${p.schema ? `<${p.schema}>` : ""}${p.required ? " · required" : ""}`}
            className={cn(HANDLE, TYPE_DOT[p.type], hidden && "!opacity-0", !wired.includes(p.id) && "opacity-70")}
          />
          {showLabel && (
            <span
              className={cn("pointer-events-none absolute -translate-y-1/2 whitespace-nowrap text-[9px] font-medium text-muted-foreground", dir === "in" ? "left-2" : "right-2")}
              style={{ top }}
            >
              {p.id}
              {p.type === "json" && p.schema ? <span className="text-info">·{p.schema}</span> : null}
            </span>
          )}
        </div>
      );
    });
  };
  return (
    <>
      {side(inputs, "in")}
      {side(outputs, "out")}
    </>
  );
}

/** The access handle: users of resources at the bottom, resources at the top. */
export function ResHandle({ role, hidden }: { role: "user" | "resource"; hidden?: boolean }) {
  return (
    <Handle
      id={RES_PORT}
      type={role === "user" ? "source" : "target"}
      position={role === "user" ? Position.Bottom : Position.Top}
      title={role === "user" ? "Drag to an env or plugin to give access" : "Access"}
      className={cn("!h-2 !w-5 !rounded-full !border-2 !border-card !bg-muted-foreground/50", hidden ? "!opacity-0" : "opacity-0 group-hover/node:opacity-100")}
    />
  );
}

export function Shell({ selected, status, issues, children, className }: { selected?: boolean; status?: RunStatus; issues?: number; children: ReactNode; className?: string }) {
  return (
    <div className={cn("group/node relative rounded-xl bg-card text-card-foreground shadow-[var(--ring-shadow)] transition-shadow", selected && "ring-2 ring-ring", status && STATUS_RING[status], className)}>
      {!!issues && (
        <span className="absolute -right-1.5 -top-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-white" title={`${issues} issue(s)`}>
          {issues}
        </span>
      )}
      {children}
    </div>
  );
}

export function StatusLine({ status }: { status?: RunStatus }) {
  if (!status) return null;
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_TEXT[status]}
    </span>
  );
}

export const Chip = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground", className)}>{children}</span>
);

export const OpenHint = () => (
  <span className="absolute right-2 top-2 text-muted-foreground/60 opacity-0 transition-opacity group-hover/node:opacity-100" title="Double-click to open">
    <Maximize2 className="h-3 w-3" />
  </span>
);

export const TIER_TINT: Record<string, string> = {
  native: "bg-success/10 text-success",
  sdk: "bg-info/10 text-info",
  process: "bg-warning/10 text-warning",
  remote: "bg-secondary text-muted-foreground",
};

/** Space for port labels so they never sit under the text. */
export const padFor = (ifc: { inputs: PortSpec[]; outputs: PortSpec[] }) => cn(ifc.inputs.length > 1 || ifc.inputs[0]?.id !== "in" ? "pl-10" : "", ifc.outputs.length > 1 || ifc.outputs[0]?.id !== "out" ? "pr-14" : "");

