// Layout adapted from MindRoom (https://github.com/mindroom-ai/mindroom,
// frontend/src/App.tsx), Apache License 2.0, via the EnvGen monitor: left
// sidebar, slim header with the page title and theme toggle, workspace surface.
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { NAV_ITEMS, Navigation, getNavigationValue } from "@/components/Navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

const SystemsPage = lazy(() => import("@/pages/Systems").then((m) => ({ default: m.SystemsPage })));
const CanvasPage = lazy(() => import("@/pages/Canvas").then((m) => ({ default: m.CanvasPage })));
const RunsPage = lazy(() => import("@/pages/Runs").then((m) => ({ default: m.RunsPage })));
const TemplatesPage = lazy(() => import("@/pages/Templates").then((m) => ({ default: m.TemplatesPage })));
const LibraryPage = lazy(() => import("@/pages/Library").then((m) => ({ default: m.LibraryPage })));

function PageFallback() {
  return (
    <div className="space-y-3 p-3 md:p-5" role="status" aria-label="加载中">
      <Skeleton className="h-10 w-1/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function AppLayout() {
  const location = useLocation();
  const current = NAV_ITEMS.find((i) => i.value === getNavigationValue(location.pathname)) ?? NAV_ITEMS[0];
  return (
    <div className="relative flex h-screen overflow-hidden bg-background">
      <Navigation mode="desktop" />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-card md:my-2 md:mr-2 md:rounded-2xl md:shadow-[var(--ring-shadow)]">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-2 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Navigation mode="mobile" />
            <h1 className="truncate text-base font-semibold">{current.label}</h1>
          </div>
          <ThemeToggle />
        </header>
        <main id="main-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<SystemsPage />} />
              <Route path="/canvas" element={<CanvasPage />} />
              <Route path="/canvas/:systemId" element={<CanvasPage />} />
              <Route path="/runs" element={<RunsPage />} />
              <Route path="/runs/:systemId" element={<RunsPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/library/:systemId" element={<LibraryPage />} />
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
