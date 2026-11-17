// Runs of one system: live on the server when connected, or simulated in the
// browser. Both share the bar layout and the canvas + log panels.
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { CanvasContext } from "@/canvas/context";
import { cn } from "@/lib/utils";
import type { SystemDoc } from "@/model/types";
import { useServer } from "@/store/server";
import { useSystems } from "@/store/systems";
import { LiveRun } from "./LiveRun";
import { SimRun } from "./SimRun";

type Mode = "live" | "sim";

export function RunView({ doc }: { doc: SystemDoc }) {
  const systems = useSystems((s) => s.systems);
  const navigate = useNavigate();
  const connected = useServer((s) => s.status === "connected");
  const [picked, setPicked] = useState<Mode | null>(null);
  const mode: Mode = picked ?? (connected ? "live" : "sim");
  const modelLabel = (id: string) => doc.models.find((m) => m.id === id)?.model ?? id;

  const bar = (status: ReactNode, controls: ReactNode, stats: ReactNode) => (
    <div className="glass-panel flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <EntityAvatar kind="run" id={doc.id} name={doc.name} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Select value={doc.id} onValueChange={(id) => navigate(`/runs/${id}`)} items={systems.map((s) => ({ value: s.id, label: s.name }))} ariaLabel="Select system" className="max-w-56 font-semibold" />
            {status}
          </div>
          <div className="mt-1 flex items-center gap-0.5 rounded-full bg-secondary p-0.5 text-[11px]" role="tablist" aria-label="Run mode">
            {(["live", "sim"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                disabled={m === "live" && !connected}
                title={m === "live" && !connected ? "Connect a server in Settings to run for real" : undefined}
                onClick={() => setPicked(m)}
                className={cn("rounded-full px-2 py-0.5 transition-colors disabled:opacity-40", mode === m ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {m === "live" ? "Live" : "Simulated"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <dl className="flex gap-6 text-xs">{stats}</dl>
      <div className="ml-auto flex items-center gap-1.5">
        {controls}
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/canvas/${doc.id}`}>
            <Workflow className="mr-1.5 h-3.5 w-3.5" /> Edit
          </Link>
        </Button>
      </div>
    </div>
  );

  return (
    <CanvasContext.Provider value={{ modelLabel }}>
      <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:p-4">{mode === "live" && connected ? <LiveRun key={doc.id} doc={doc} bar={bar} /> : <SimRun key={doc.id} doc={doc} bar={bar} />}</div>
    </CanvasContext.Provider>
  );
}
