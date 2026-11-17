// Layout adapted from MindRoom (https://github.com/mindroom-ai/mindroom,
// frontend/src/App.tsx), Apache License 2.0, via the EnvGen monitor: left
// sidebar, slim header with the page title and theme toggle, workspace surface.
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { NAV_ITEMS, Navigation, getNavigationValue } from "@/components/Navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useServer } from "@/store/server";
import { startSync } from "@/store/sync";

const SystemsPage = lazy(() => import("@/pages/Systems").then((m) => ({ default: m.SystemsPage })));
const CanvasPage = lazy(() => import("@/pages/canvas").then((m) => ({ default: m.CanvasPage })));
const RunsPage = lazy(() => import("@/pages/runs").then((m) => ({ default: m.RunsPage })));
const EvalsPage = lazy(() => import("@/pages/evals").then((m) => ({ default: m.EvalsPage })));
const ComparePage = lazy(() => import("@/pages/evals/Compare").then((m) => ({ default: m.ComparePage })));
const TemplatesPage = lazy(() => import("@/pages/Templates").then((m) => ({ default: m.TemplatesPage })));
const LibraryPage = lazy(() => import("@/pages/library").then((m) => ({ default: m.LibraryPage })));
const DemosPage = lazy(() => import("@/pages/demos").then((m) => ({ default: m.DemosPage })));
const SettingsPage = lazy(() => import("@/pages/settings").then((m) => ({ default: m.SettingsPage })));

const SERVER_LABEL = { checking: "Server…", offline: "Offline", needs_token: "Connect server", connected: "Server" } as const;

/** Where runs happen: on the server when connected, otherwise simulated in the browser. */
function ServerPill() {
  const status = useServer((s) => s.status);
  return (
    <Link
      to="/settings"
      title={status === "connected" ? "Connected to the MAS Studio server" : status === "offline" ? "No server: systems stay in this browser and runs are simulated" : "Enter the server token"}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", status === "connected" ? "bg-success" : status === "needs_token" ? "bg-warning" : "bg-muted-foreground/50")} />
      {SERVER_LABEL[status]}
    </Link>
  );
}

function PageFallback() {
  return (
    <div className="space-y-3 p-3 md:p-5" role="status" aria-label="Loading">
      <Skeleton className="h-10 w-1/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function AppLayout() {
  const location = useLocation();
  const current = NAV_ITEMS.find((i) => i.value === getNavigationValue(location.pathname)) ?? NAV_ITEMS[0];
  useEffect(() => {
    void useServer.getState().check();
    startSync();
  }, []);
  return (
    <div className="relative flex h-screen overflow-hidden bg-background">
      <Navigation mode="desktop" />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-card md:my-2 md:mr-2 md:rounded-2xl md:shadow-[var(--ring-shadow)]">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-2 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Navigation mode="mobile" />
            <h1 className="truncate text-base font-semibold">{current.label}</h1>
          </div>
          <div className="flex items-center gap-1">
            <ServerPill />
            <ThemeToggle />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<SystemsPage />} />
              <Route path="/canvas" element={<CanvasPage />} />
              <Route path="/canvas/:systemId" element={<CanvasPage />} />
              <Route path="/runs" element={<RunsPage />} />
              <Route path="/runs/:systemId" element={<RunsPage />} />
              <Route path="/evals" element={<EvalsPage />} />
              <Route path="/evals/compare" element={<ComparePage />} />
              <Route path="/evals/:systemId" element={<EvalsPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/library/:systemId" element={<LibraryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/demos" element={<DemosPage />} />
              <Route path="/demos/:demoId" element={<DemosPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    </TooltipProvider>
  );
}
