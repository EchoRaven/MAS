import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  running: "bg-info/10 text-info",
  working: "bg-info/10 text-info",
  in_progress: "bg-info/10 text-info",
  open: "bg-info/10 text-info",
  claimed: "bg-info/10 text-info",
  completed: "bg-success/10 text-success",
  success: "bg-success/10 text-success",
  passed: "bg-success/10 text-success",
  merged: "bg-success/10 text-success",
  implemented: "bg-success/10 text-success",
  released: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
  error: "bg-destructive/10 text-destructive",
  blocked: "bg-destructive/10 text-destructive",
  paused: "bg-warning/10 text-warning",
  pending: "bg-warning/10 text-warning",
  starting: "bg-warning/10 text-warning",
  stopped: "bg-secondary text-muted-foreground ring-1 ring-warning/40",
};

const DOTS: Record<string, string> = {
  running: "bg-info animate-pulse",
  working: "bg-info animate-pulse",
  completed: "bg-success",
  failed: "bg-destructive",
  error: "bg-destructive",
  paused: "bg-warning",
};

export function StatusBadge({ status, className, label, title }: { status: string; className?: string; label?: string; title?: string }) {
  const key = status.toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        STYLES[key] ?? "bg-secondary text-secondary-foreground",
        className,
      )}
    >
      {DOTS[key] && <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", DOTS[key])} />}
      <span title={title}>{label ?? status.replace(/_/g, " ")}</span>
    </span>
  );
}

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={status}
      title={status}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOTS[status.toLowerCase()] ?? "bg-muted-foreground/40", className)}
    />
  );
}
