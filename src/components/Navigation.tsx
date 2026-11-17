// Adapted from MindRoom (https://github.com/mindroom-ai/mindroom,
// frontend/src/components/Navigation/Navigation.tsx), Apache License 2.0,
// via the EnvGen monitor. Modified: studio sections.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, Boxes, LayoutTemplate, Menu, PlayCircle, Workflow, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type NavigationItem = { value: string; path: string; label: string; icon: LucideIcon; group: "工作区" | "资源" };

export const NAV_ITEMS: NavigationItem[] = [
  { value: "systems", path: "/", label: "系统", icon: Boxes, group: "工作区" },
  { value: "canvas", path: "/canvas", label: "画布", icon: Workflow, group: "工作区" },
  { value: "runs", path: "/runs", label: "运行", icon: PlayCircle, group: "工作区" },
  { value: "templates", path: "/templates", label: "模板", icon: LayoutTemplate, group: "资源" },
  { value: "library", path: "/library", label: "模型与工具", icon: BookOpen, group: "资源" },
];
const GROUPS: NavigationItem["group"][] = ["工作区", "资源"];

export function getNavigationValue(pathname: string): string {
  const first = pathname.split("/").filter(Boolean)[0];
  if (first && NAV_ITEMS.some((i) => i.value === first)) return first;
  return "systems";
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

function Brand() {
  return (
    <Link to="/" aria-label="MAS Studio 首页" className="-mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
      <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0 dark:invert" />
      <span className="whitespace-nowrap text-base font-semibold tracking-tight">
        MAS <span className="font-normal text-muted-foreground">Studio</span>
      </span>
    </Link>
  );
}

export function Navigation({ mode = "all", className }: { mode?: "all" | "desktop" | "mobile"; className?: string }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const current = getNavigationValue(location.pathname);
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <>
      {mode !== "desktop" && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label="打开导航"
              className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-secondary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring md:hidden", className)}
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </button>
          </DialogTrigger>
          <DialogContent className="left-0 top-0 h-dvh w-[min(18rem,85vw)] max-w-none translate-x-0 translate-y-0 content-start gap-3 overflow-y-auto rounded-none border-0 border-r bg-background p-3">
            <DialogHeader className="px-3 pb-1 pt-2 text-left">
              <DialogTitle className="text-base">导航</DialogTitle>
              <DialogDescription className="text-xs">Multi-agent system studio</DialogDescription>
            </DialogHeader>
            <nav aria-label="移动端导航">
              <Links current={current} mobile onNavigate={() => setOpen(false)} />
            </nav>
          </DialogContent>
        </Dialog>
      )}
      {mode !== "mobile" && (
        <aside aria-label="MAS Studio" className={cn("hidden w-56 shrink-0 flex-col bg-background md:flex", className)}>
          <div className="flex h-14 shrink-0 items-center px-5">
            <Brand />
          </div>
          <nav aria-label="主导航" className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3">
            <Links current={current} />
          </nav>
          <div className="px-5 py-3 text-xs text-muted-foreground">Spec v0.1 · 数据保存在本浏览器</div>
        </aside>
      )}
    </>
  );
}
