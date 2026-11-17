import { Bot, Box, Database, Hash, Layers, User, type LucideIcon } from "lucide-react";
import type { NodeKind } from "@/model/types";
import { cn } from "@/lib/utils";
import { EDGE_COLOR, EDGE_LABEL } from "./convert";
import { DND_MIME } from "./FlowView";

const ITEMS: { kind: NodeKind; label: string; hint: string; icon: LucideIcon }[] = [
  { kind: "agent", label: "Agent", hint: "model + harness + tools", icon: Bot },
  { kind: "human", label: "Human", hint: "approve, guide, ask", icon: User },
  { kind: "channel", label: "Room", hint: "multi-party channel", icon: Hash },
  { kind: "env", label: "Env", hint: "sandbox, browser, database…", icon: Box },
  { kind: "store", label: "Store", hint: "memory, knowledge, board", icon: Database },
  { kind: "group", label: "Group", hint: "wrap as a subsystem", icon: Layers },
];

export function Palette({ onAdd, className }: { onAdd: (kind: NodeKind) => void; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4 overflow-y-auto p-3", className)}>
      <div>
        <p className="px-1 pb-2 text-xs text-muted-foreground">Drag onto the canvas, or click to add</p>
        <ul className="space-y-1">
          {ITEMS.map(({ kind, label, hint, icon: Icon }) => (
            <li key={kind}>
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_MIME, kind);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onAdd(kind)}
                className="flex w-full cursor-grab items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-[var(--ring-shadow)]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="px-1">
        <p className="pb-2 text-xs text-muted-foreground">Edges (drag from a node's edge)</p>
        <ul className="space-y-1.5 text-[11px] text-muted-foreground">
          {(["message", "call", "handoff", "access"] as const).map((k) => (
            <li key={k} className="flex items-center gap-2">
              <svg width="28" height="8" aria-hidden="true">
                <line x1="1" y1="4" x2="27" y2="4" style={{ stroke: EDGE_COLOR[k], strokeWidth: k === "handoff" ? 2.25 : 1.5, strokeDasharray: k === "access" ? "3 3" : undefined }} />
              </svg>
              {EDGE_LABEL[k]}
            </li>
          ))}
          <li className="pt-1">Edges to an env / store become access; others default to message. Change it in the inspector.</li>
        </ul>
      </div>
    </div>
  );
}
