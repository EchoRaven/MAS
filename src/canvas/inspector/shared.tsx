import type { ReactNode } from "react";
import { AlertTriangle, CircleAlert, Info, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SystemDoc } from "@/model/types";
import type { Issue } from "@/model/validate";

export type Update = (fn: (doc: SystemDoc) => SystemDoc) => void;

export function IssueList({ issues, onPick }: { issues: Issue[]; onPick?: (i: Issue) => void }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-1.5">
      {issues.map((i, k) => {
        const Icon = i.severity === "error" ? CircleAlert : i.severity === "warning" ? AlertTriangle : Info;
        const clickable = onPick && (i.nodeId || i.edgeId);
        return (
          <li key={k}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onPick!(i)}
              className={cn(
                "flex w-full gap-2 rounded-lg px-2.5 py-2 text-left text-xs",
                i.severity === "error" ? "bg-destructive/10 text-destructive" : i.severity === "warning" ? "bg-warning/10 text-warning" : "bg-secondary text-muted-foreground",
                clickable && "hover:ring-1 hover:ring-current",
              )}
            >
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{i.message}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function Header({ title, subtitle, avatar, onDelete, onClose, actions }: { title: string; subtitle: string; avatar: ReactNode; onDelete?: () => void; onClose: () => void; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {actions}
      {onDelete && (
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-4">{children}</div>;
}

export function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warning" | "info" }) {
  return (
    <p className={cn("rounded-lg px-3 py-2 text-xs", tone === "warning" ? "bg-warning/10 text-warning" : tone === "info" ? "bg-info/10 text-info" : "bg-secondary text-muted-foreground")}>{children}</p>
  );
}

/** A small "+ Add" button for section headers. */
export function AddButton({ onClick, label = "Add" }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClick}>
      + {label}
    </Button>
  );
}
