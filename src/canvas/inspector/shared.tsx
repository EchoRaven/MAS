import type { ReactNode } from "react";
import { AlertTriangle, CircleAlert, Info, Plus, Trash2, X, type LucideIcon } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SystemDoc } from "@/model/types";
import type { Issue } from "@/model/validate";

export type Update = (fn: (doc: SystemDoc) => SystemDoc) => void;

const SEV = {
  error: { icon: CircleAlert, tone: "text-destructive", bg: "bg-destructive/[0.07] hover:bg-destructive/[0.12]" },
  warning: { icon: AlertTriangle, tone: "text-warning", bg: "bg-warning/[0.08] hover:bg-warning/[0.14]" },
  info: { icon: Info, tone: "text-muted-foreground", bg: "bg-secondary/60 hover:bg-secondary" },
};

export function IssueList({ issues, onPick }: { issues: Issue[]; onPick?: (i: Issue) => void }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-1">
      {issues.map((i, k) => {
        const s = SEV[i.severity];
        const clickable = !!onPick && !!(i.nodeId || i.edgeId);
        return (
          <li key={k}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onPick!(i)}
              className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12px] leading-snug transition-colors", s.bg, !clickable && "cursor-default")}
            >
              <s.icon className={cn("mt-px h-3.5 w-3.5 shrink-0", s.tone)} />
              <span className="text-foreground/90">{i.message}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function IconButton({ label, onClick, children, tone }: { label: string; onClick: () => void; children: ReactNode; tone?: "danger" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn("flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground", tone === "danger" && "hover:bg-destructive/10 hover:text-destructive")}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Kind-coloured icon tile used by headers and lists. */
export function KindIcon({ icon: Icon, tint, size = "md" }: { icon: LucideIcon; tint: string; size?: "sm" | "md" }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-lg", tint, size === "md" ? "h-8 w-8" : "h-6 w-6 rounded-md")}>
      <Icon className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} />
    </span>
  );
}

export function Header({ title, subtitle, icon, onDelete, onClose, actions }: { title: string; subtitle: ReactNode; icon: ReactNode; onDelete?: () => void; onClose: () => void; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold leading-tight">{title}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex items-center">
        {actions}
        {onDelete && (
          <IconButton label="Delete" onClick={onDelete} tone="danger">
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        )}
        <IconButton label="Close" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

/** Underlined tabs that fit a narrow panel. */
export function PanelTabs({ tabs }: { tabs: [value: string, label: string][] }) {
  return (
    <TabsList className="h-auto w-full justify-start gap-3.5 overflow-x-auto rounded-none border-b border-border/60 bg-transparent p-0 px-4 [scrollbar-width:none]">
      {tabs.map(([v, label]) => (
        <TabsTrigger
          key={v}
          value={v}
          className="relative shrink-0 rounded-none bg-transparent px-0 pb-2 pt-1 text-[12px] font-medium text-muted-foreground shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:rounded-full hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:bg-foreground"
        >
          {label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

export function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-8 pt-3", className)}>{children}</div>;
}

export function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warning" | "info" }) {
  return (
    <p
      className={cn(
        "rounded-md border-l-2 px-2.5 py-1.5 text-[12px] leading-snug",
        tone === "warning" ? "border-warning bg-warning/[0.07] text-foreground/90" : tone === "info" ? "border-info bg-info/[0.07] text-foreground/90" : "border-border bg-secondary/50 text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

/** A small "+" for section headers. */
export function AddButton({ onClick, label = "Add" }: { onClick: () => void; label?: string }) {
  return (
    <IconButton label={label} onClick={onClick}>
      <Plus className="h-3.5 w-3.5" />
    </IconButton>
  );
}

/** A hairline-separated list of editable rows. */
export function RowList({ children, empty }: { children: ReactNode; empty?: string }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  if (!has) return empty ? <p className="py-1 text-[12px] text-muted-foreground">{empty}</p> : null;
  return <ul className="divide-y divide-border/50 overflow-hidden rounded-lg bg-secondary/30 ring-1 ring-border/50">{children}</ul>;
}
