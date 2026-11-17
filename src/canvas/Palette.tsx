import { ChevronRight, Upload } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NodeData, NodeKind } from "@/model/types";
import { DND_MIME, type DragPayload } from "./FlowView";
import { PALETTE, type PaletteEntry } from "./presets";

export type ImportKind = "agent" | "env" | "plugin";

const BTN =
  "relative flex h-10 w-10 cursor-grab items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing data-[state=open]:bg-secondary data-[state=open]:text-foreground";

function dragProps(payload: DragPayload) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

function Entry({ entry, onAdd, onImport }: { entry: PaletteEntry; onAdd: (kind: NodeKind, data?: NodeData) => void; onImport: (k: ImportKind) => void }) {
  const Icon = entry.icon;
  if (!entry.variants) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label={entry.label} className={BTN} onClick={() => onAdd(entry.kind)} {...dragProps({ kind: entry.kind })}>
            <Icon className="h-[18px] w-[18px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="font-medium">{entry.label}</p>
          <p className="text-muted-foreground">{entry.hint}</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={entry.label} className={BTN} {...dragProps({ kind: entry.kind, data: entry.variants[0].make() })}>
              <Icon className="h-[18px] w-[18px]" />
              <ChevronRight className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 opacity-50" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="font-medium">{entry.label}</p>
          <p className="text-muted-foreground">{entry.hint}</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" className="w-64">
        <DropdownMenuLabel>{entry.label}</DropdownMenuLabel>
        {entry.variants.map((v) => (
          <DropdownMenuItem key={v.id} onSelect={() => onAdd(entry.kind, v.make())} className="flex-col items-start gap-0">
            <span className="text-[13px]">{v.label}</span>
            <span className="text-[11px] text-muted-foreground">{v.hint}</span>
          </DropdownMenuItem>
        ))}
        {entry.importable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onImport(entry.importable!)}>
              <Upload className="mr-2 h-3.5 w-3.5" /> Import…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A narrow toolbar of components. Click or drag a plain item; items with variants open a menu. */
export function Palette({ onAdd, onImport, className }: { onAdd: (kind: NodeKind, data?: NodeData) => void; onImport: (k: ImportKind) => void; className?: string }) {
  return (
    <nav aria-label="Components" className={cn("flex flex-col items-center gap-1 py-2", className)}>
      {PALETTE.map((e) => (
        <Entry key={e.kind} entry={e} onAdd={onAdd} onImport={onImport} />
      ))}
    </nav>
  );
}
