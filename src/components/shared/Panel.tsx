import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A titled section card (mindroom's glass-panel with a small header). */
export function Panel({
  title,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("glass-panel flex min-h-0 flex-col rounded-xl", className)}>
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {Icon && <Icon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />}
          {title}
        </h2>
        {actions}
      </header>
      <div className={cn("min-h-0 flex-1 px-4 pb-4", bodyClassName)}>{children}</div>
    </section>
  );
}
