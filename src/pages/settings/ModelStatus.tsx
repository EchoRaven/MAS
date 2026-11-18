// Which models work from this server right now: what the server learned from
// its calls (a refused key, no credit), with a button to test one, say after
// pasting a new key above.
import { useCallback, useEffect, useState } from "react";
import { CircleCheck, CircleHelp, CircleX, KeyRound, RefreshCw } from "lucide-react";
import { Api, type ModelHealth } from "@/api/client";
import { Button } from "@/components/ui/button";
import { DEFAULT_MODELS } from "@/model/defaults";
import { cn } from "@/lib/utils";

const MODELS = DEFAULT_MODELS.filter((m) => m.provider !== "mock");

const LOOK: Record<ModelHealth["status"], { icon: typeof CircleCheck; cls: string; label: string }> = {
  ok: { icon: CircleCheck, cls: "text-success", label: "works" },
  failing: { icon: CircleX, cls: "text-destructive", label: "failing" },
  no_key: { icon: KeyRound, cls: "text-muted-foreground", label: "no key" },
  unknown: { icon: CircleHelp, cls: "text-muted-foreground", label: "not tried yet" },
};

export function ModelStatusSection() {
  const [rows, setRows] = useState<ModelHealth[] | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const load = useCallback(() => void Api.modelHealth(MODELS).then((r) => setRows(r.models)).catch(() => setRows([])), []);
  useEffect(load, [load]);

  const test = async (id: string) => {
    const m = MODELS.find((x) => x.id === id);
    if (!m) return;
    setTesting(id);
    try {
      const r = await Api.testModel(m);
      setReplies((x) => ({ ...x, [id]: r.ok ? `answered in ${r.ms} ms` : (r.error ?? "failed") }));
    } catch (e) {
      setReplies((x) => ({ ...x, [id]: (e as Error).message }));
    } finally {
      setTesting(null);
      load();
    }
  };

  return (
    <section className="glass-panel rounded-xl p-4" aria-label="Model status">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Model status</h2>
        <span className="text-[12px] text-muted-foreground">What the server learned from calling each model. Test one after changing its key.</span>
        <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={load} aria-label="Refresh model status">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ul className="mt-2 divide-y divide-border/70">
        {rows?.map((r) => {
          const look = LOOK[r.status];
          const Icon = look.icon;
          const spec = MODELS.find((m) => m.id === r.id);
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
              <Icon className={cn("h-3.5 w-3.5 shrink-0", look.cls)} aria-hidden />
              <span className="font-mono text-xs">{r.id}</span>
              <span className="text-[11px] text-muted-foreground">
                {spec?.provider} · {r.model}
                {r.kind !== "chat" ? ` · ${r.kind}` : ""}
              </span>
              <span className={cn("text-[11px]", look.cls)}>{look.label}</span>
              <Button variant="outline" size="sm" className="ml-auto h-7" disabled={testing !== null || r.status === "no_key"} onClick={() => void test(r.id)}>
                {testing === r.id ? "Testing…" : "Test"}
              </Button>
              {(r.why || replies[r.id]) && <p className="w-full break-words pl-5 text-[11px] text-muted-foreground">{replies[r.id] ?? r.why}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
