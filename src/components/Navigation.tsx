// Adapted from MindRoom (https://github.com/mindroom-ai/mindroom,
// frontend/src/components/Navigation/Navigation.tsx), Apache License 2.0,
// via the EnvGen monitor. Modified: studio sections.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, Boxes, Clapperboard, LayoutTemplate, Menu, PanelLeftClose, PanelLeftOpen, PlayCircle, Settings, Workflow, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui";

export type NavigationItem = { value: string; path: string; label: string; icon: LucideIcon; group: "Workspace" | "Resources" };

export const NAV_ITEMS: NavigationItem[] = [
  { value: "systems", path: "/", label: "Systems", icon: Boxes, group: "Workspace" },
  { value: "canvas", path: "/canvas", label: "Canvas", icon: Workflow, group: "Workspace" },
  { value: "runs", path: "/runs", label: "Runs", icon: PlayCircle, group: "Workspace" },
  { value: "demos", path: "/demos", label: "Demos", icon: Clapperboard, group: "Resources" },
  { value: "templates", path: "/templates", label: "Templates", icon: LayoutTemplate, group: "Resources" },
  { value: "library", path: "/library", label: "Library", icon: BookOpen, group: "Resources" },
  { value: "settings", path: "/settings", label: "Settings", icon: Settings, group: "Resources" },
];
const GROUPS: NavigationItem["group"][] = ["Workspace", "Resources"];

export function getNavigationValue(pathname: string): string {
  const first = pathname.split("/").filter(Boolean)[0];
  if (first && NAV_ITEMS.some((i) => i.value === first)) return first;
  return "systems";
}

function RailLinks({ current }: { current: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {NAV_ITEMS.map((item) => {
        const active = item.value === current;
        const Icon = item.icon;
        return (
          <Tooltip key={item.value}>
            <TooltipTrigger asChild>
              <Link
                to={item.path}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  active && "bg-active text-foreground",
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function Links({ current, mobile = false, onNavigate }: { current: string; mobile?: boolean; onNavigate?: () => void }) {
  return (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <div key={group}>
          <p className="px-3 pb-1.5 text-xs text-muted-foreground">{group}</p>
          <div className="space-y-0.5">
            {NAV_ITEMS.filter((i) => i.group === group).map((item) => {
              const active = item.value === current;
              const Icon = item.icon;
              return (
                <Link
                  key={item.value}
                  to={item.path}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                    mobile ? "min-h-11" : "min-h-8",
                    active && "bg-active font-medium text-foreground",
                  )}
                >
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" aria-label="MAS Studio home" className="-mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
      <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0 dark:invert" />
      {!compact && (
        <span className="whitespace-nowrap text-base font-semibold tracking-tight">
          MAS <span className="font-normal text-muted-foreground">Studio</span>
        </span>
      )}
    </Link>
  );
}

export function Navigation({ mode = "all", className }: { mode?: "all" | "desktop" | "mobile"; className?: string }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const current = getNavigationValue(location.pathname);
  const collapsed = useUiStore((s) => s.navCollapsed);
  const toggle = useUiStore((s) => s.toggleNav);
  useEffect(() => setOpen(false), [location.pathname]);
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <>
      {mode !== "desktop" && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label="Open navigation"
              className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-secondary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring md:hidden", className)}
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </button>
          </DialogTrigger>
          <DialogContent className="left-0 top-0 h-dvh w-[min(18rem,85vw)] max-w-none translate-x-0 translate-y-0 content-start gap-3 overflow-y-auto rounded-none border-0 border-r bg-background p-3">
            <DialogHeader className="px-3 pb-1 pt-2 text-left">
              <DialogTitle className="text-base">Navigation</DialogTitle>
              <DialogDescription className="text-xs">Multi-agent system studio</DialogDescription>
            </DialogHeader>
            <nav aria-label="Mobile navigation">
              <Links current={current} mobile onNavigate={() => setOpen(false)} />
            </nav>
          </DialogContent>
        </Dialog>
      )}
      {mode !== "mobile" && (
        <aside aria-label="MAS Studio" className={cn("hidden shrink-0 flex-col bg-background transition-[width] duration-200 md:flex", collapsed ? "w-14" : "w-52", className)}>
          <div className={cn("flex h-14 shrink-0 items-center", collapsed ? "justify-center" : "px-5")}>
            <Brand compact={collapsed} />
          </div>
          <nav aria-label="Main navigation" className={cn("min-h-0 flex-1 overflow-y-auto pb-6 pt-3", collapsed ? "px-2" : "px-3")}>
            {collapsed ? <RailLinks current={current} /> : <Links current={current} />}
          </nav>
          <div className={cn("flex py-3", collapsed ? "justify-center" : "px-3")}>
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <ToggleIcon className="h-4 w-4" />
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
