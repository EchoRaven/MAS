import { AlertTriangle, Check, CircleAlert, Info } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { nodeName } from "@/model/ports";
import type { SystemDoc } from "@/model/types";
import type { Issue } from "@/model/validate";

const ICON = { error: CircleAlert, warning: AlertTriangle, info: Info };
const TINT = { error: "text-destructive", warning: "text-warning", info: "text-muted-foreground" };

/** Issue counts in the toolbar; open to see every issue, click one to jump to it. */
export function IssuesMenu({ doc, issues, onPick }: { doc: SystemDoc; issues: Issue[]; onPick: (i: Issue) => void }) {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const sorted = [...issues].sort((a, b) => ["error", "warning", "info"].indexOf(a.severity) - ["error", "warning", "info"].indexOf(b.severity));
  const where = (i: Issue) => {
    if (i.nodeId) return nodeName(doc.nodes.find((n) => n.id === i.nodeId));
    const e = i.edgeId ? doc.edges.find((x) => x.id === i.edgeId) : undefined;
    if (e) return `${nodeName(doc.nodes.find((n) => n.id === e.source))} → ${nodeName(doc.nodes.find((n) => n.id === e.target))}`;
    return "System";
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs hover:bg-secondary data-[state=open]:bg-secondary" aria-label="Issues">
          {errors > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <CircleAlert className="h-3.5 w-3.5" /> {errors}
            </span>
          )}
          {warnings > 0 && (
            <span className="flex items-center gap-1 text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> {warnings}
            </span>
          )}
          {errors + warnings === 0 && (
            <span className="flex items-center gap-1 text-success">
              <Check className="h-3.5 w-3.5" /> No issues
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-[min(420px,90vw)] overflow-y-auto">
        <DropdownMenuLabel>{issues.length ? `${issues.length} issue${issues.length > 1 ? "s" : ""}` : "Nothing to fix"}</DropdownMenuLabel>
        {sorted.map((i, k) => {
          const Icon = ICON[i.severity];
          return (
            <DropdownMenuItem key={k} onSelect={() => onPick(i)} className="items-start gap-2 py-2">
              <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", TINT[i.severity])} />
              <span className="min-w-0">
                <span className="block text-[11px] font-medium text-muted-foreground">{where(i)}</span>
                <span className="block text-xs">{i.message}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
