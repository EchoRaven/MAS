import { Fragment } from "react";
import { Upload } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NodeData, NodeKind } from "@/model/types";
import { DND_MIME, type DragPayload } from "./FlowView";
import { KIND_STYLE } from "./kinds";
import { PALETTE, type PaletteEntry } from "./presets";

export type ImportKind = "agent" | "env" | "plugin";

/** Toolbar groups, top to bottom. */
const GROUPS: NodeKind[][] = [["agent", "model", "function"], ["human"], ["env", "plugin"], ["group"]];

export const SHORTCUT: Record<NodeKind, string> = { agent: "A", model: "M", function: "F", human: "H", env: "E", plugin: "P", group: "G" };

const BTN =
  "group/btn relative flex h-9 w-9 cursor-grab items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing data-[state=open]:bg-secondary data-[state=open]:text-foreground";

function dragProps(payload: DragPayload) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

function Tip({ entry }: { entry: PaletteEntry }) {
  return (
    <TooltipContent side="right" className="max-w-56">
      <p className="flex items-center justify-between gap-3 font-medium">
        {entry.label}
        <kbd className="rounded border border-border bg-secondary px-1 font-mono text-[10px] text-muted-foreground">{SHORTCUT[entry.kind]}</kbd>
      </p>
      <p className="mt-0.5 text-muted-foreground">{entry.hint}</p>
    </TooltipContent>
  );
}

function Entry({ entry, onAdd, onImport }: { entry: PaletteEntry; onAdd: (kind: NodeKind, data?: NodeData) => void; onImport: (k: ImportKind) => void }) {
  const Icon = KIND_STYLE[entry.kind].icon;
  const icon = <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />;
  if (!entry.variants) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label={entry.label} className={BTN} onClick={() => onAdd(entry.kind)} {...dragProps({ kind: entry.kind })}>
            {icon}
          </button>
        </TooltipTrigger>
        <Tip entry={entry} />
      </Tooltip>
    );
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={entry.label} className={BTN} {...dragProps({ kind: entry.kind, data: entry.variants[0].make() })}>
              {icon}
              <span className="absolute bottom-1 right-1 h-0 w-0 border-l-[4px] border-t-[4px] border-l-transparent border-t-current opacity-40" style={{ transform: "rotate(-90deg)" }} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <Tip entry={entry} />
      </Tooltip>
      <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-64 p-1">
        <DropdownMenuLabel className="flex items-center gap-2 text-[12px]">
          <span className={cn("flex h-5 w-5 items-center justify-center rounded-md", KIND_STYLE[entry.kind].tint)}>
            <Icon className="h-3 w-3" />
          </span>
          {entry.label}
        </DropdownMenuLabel>
        {entry.variants.map((v) => (
          <DropdownMenuItem key={v.id} onSelect={() => onAdd(entry.kind, v.make())} className="flex-col items-start gap-0 rounded-md px-2 py-1.5">
            <span className="text-[13px]">{v.label}</span>
            <span className="text-[11px] leading-snug text-muted-foreground">{v.hint}</span>
          </DropdownMenuItem>
        ))}
        {entry.importable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onImport(entry.importable!)} className="rounded-md px-2 py-1.5 text-[13px]">
              <Upload className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> Import…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A floating toolbar of components. Click or drag a plain tool; tools with variants open a menu. */
export function Palette({ onAdd, onImport, className }: { onAdd: (kind: NodeKind, data?: NodeData) => void; onImport: (k: ImportKind) => void; className?: string }) {
  return (
    <nav aria-label="Components" className={cn("flex flex-col items-center gap-0.5 rounded-xl bg-card/95 p-1 shadow-[var(--pop-shadow)] backdrop-blur", className)}>
      {GROUPS.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <span className="my-0.5 h-px w-5 bg-border" />}
          {group.map((kind) => {
            const entry = PALETTE.find((e) => e.kind === kind)!;
            return <Entry key={kind} entry={entry} onAdd={onAdd} onImport={onImport} />;
          })}
        </Fragment>
      ))}
    </nav>
  );
}
