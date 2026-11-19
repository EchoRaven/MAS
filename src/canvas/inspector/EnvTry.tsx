// Try an env's tools from its inspector, without building a run: each tool
// with its description and parameters, run once against a throwaway copy of
// the env (a box of its own, a copy of the database). Calls in one preview
// share state, so a file written can be run next; Reset starts over.
import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Api, type PreviewTool } from "@/api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useServer } from "@/store/server";

/** Long free text gets a box of its own: code, commands, SQL, file contents. */
const LONG = /^(command|content|code|sql|query|script|text|question|request)$/i;

function ToolForm({ tool, onRun, busy }: { tool: PreviewTool; onRun: (args: Record<string, unknown>, confirm: boolean) => void; busy: boolean }) {
  const props = Object.entries(tool.input_schema.properties ?? {});
  const [args, setArgs] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const parse = (v: string, type?: string) => (type === "number" || type === "integer" ? Number(v) : type === "boolean" ? v === "true" : type === "object" || type === "array" ? JSON.parse(v || (type === "array" ? "[]" : "{}")) : v);
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onRun(Object.fromEntries(props.filter(([k]) => args[k] !== undefined && args[k] !== "").map(([k, p]) => [k, parse(args[k], p.type)])), confirm);
        } catch (err) {
          alert(`An argument is not valid JSON: ${(err as Error).message}`);
        }
      }}
    >
      {props.map(([k, p]) => {
        const id = `try-${tool.name}-${k}`;
        const common = { id, value: args[k] ?? "", onChange: (e: { target: { value: string } }) => setArgs((a) => ({ ...a, [k]: e.target.value })), className: "w-full rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px]", placeholder: p.description ?? p.type ?? "" };
        return (
          <label key={k} htmlFor={id} className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
            <span>
              {k}
              {tool.input_schema.required?.includes(k) ? " *" : ""}
            </span>
            {LONG.test(k) ? <textarea rows={3} {...common} /> : <input {...common} />}
          </label>
        );
      })}
      {!props.length && <p className="text-[11px] text-muted-foreground">No arguments.</p>}
      {tool.needs_confirm && (
        <label className="flex items-center gap-1.5 text-[11px] text-destructive">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> This changes the real service, not a copy: run it anyway
        </label>
      )}
      <Button type="submit" size="sm" variant="outline" className="self-start" disabled={busy || (tool.needs_confirm && !confirm)}>
        <Play className="mr-1.5 h-3.5 w-3.5" /> {busy ? "Running…" : `Run ${tool.name}`}
      </Button>
    </form>
  );
}

export function EnvTry({ systemId, envId }: { systemId: string; envId: string }) {
  const connected = useServer((s) => s.status === "connected");
  const [session, setSession] = useState<{ id: string; copy: boolean; tools: PreviewTool[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<{ tool: string; text: string; error: boolean; seconds: number; log: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef<{ id: string } | null>(null);

  // a preview ends with the panel: its box and its copy are removed
  useEffect(() => {
    return () => {
      if (live.current) void Api.envPreviewClose(systemId, envId, live.current.id).catch(() => undefined);
    };
  }, [systemId, envId]);

  if (!connected) return <p className="text-xs text-muted-foreground">Connect to the server (Settings) to try this env's tools.</p>;

  const start = () => {
    setBusy(true);
    setError("");
    Api.envPreview(systemId, envId)
      .then((r) => {
        live.current = { id: r.session };
        setSession({ id: r.session, copy: r.copy, tools: r.tools });
        setOpen(r.tools[0]?.name ?? null);
      })
      .catch((e) => setError(/No such system/.test(e.message) ? "Save the system first: previews run on the stored version." : e.message))
      .finally(() => setBusy(false));
  };
  const reset = async () => {
    if (session) await Api.envPreviewClose(systemId, envId, session.id).catch(() => undefined);
    live.current = null;
    setSession(null);
    setResult(null);
  };

  if (!session)
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] text-muted-foreground">Call each tool yourself, as an agent would, on a throwaway copy of this env: a machine of its own, a copy of the database. Nothing real changes.</p>
        <Button size="sm" variant="outline" className="self-start" onClick={start} disabled={busy}>
          <Play className="mr-1.5 h-3.5 w-3.5" /> {busy ? "Starting…" : "Start a preview"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={cn("rounded px-1.5 py-0.5", session.copy ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>{session.copy ? "throwaway copy" : "real service"}</span>
        <span>{session.tools.length} tools · calls share state until reset</span>
        <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => void reset()}>
          <RotateCcw className="mr-1 h-3 w-3" /> Reset
        </Button>
      </div>
      <ul className="flex flex-col gap-1">
        {session.tools.map((t) => (
          <li key={t.name} className="rounded-md border border-border/60">
            <button type="button" className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-muted/60" onClick={() => setOpen(open === t.name ? null : t.name)} aria-expanded={open === t.name}>
              <span className="font-mono font-medium">{t.name}</span>
              <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{t.effect}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.description}</span>
            </button>
            {open === t.name && (
              <div className="flex flex-col gap-1.5 border-t border-border/60 p-2">
                <p className="text-[11px] text-muted-foreground">{t.description}</p>
                <ToolForm
                  tool={t}
                  busy={busy}
                  onRun={(args, confirm) => {
                    setBusy(true);
                    Api.envPreviewCall(systemId, envId, session.id, { tool: t.name, args, confirm })
                      .then((r) => setResult({ tool: t.name, text: r.result, error: r.error, seconds: r.seconds, log: r.log.map((l) => l.text) }))
                      .catch((e) => setResult({ tool: t.name, text: e.message, error: true, seconds: 0, log: [] }))
                      .finally(() => setBusy(false));
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      {result && (
        <div className="rounded-md border border-border/60" aria-label="Result">
          <p className={cn("border-b border-border/60 px-2 py-1 text-[11px]", result.error ? "text-destructive" : "text-muted-foreground")}>
            {result.tool} · {result.error ? "failed" : "done"} · {result.seconds.toFixed(1)} s
          </p>
          {result.log.length > 0 && <p className="border-b border-border/60 px-2 py-1 text-[11px] text-muted-foreground">{result.log.join(" · ")}</p>}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-2 font-mono text-[11px]">{result.text || "(no output)"}</pre>
        </div>
      )}
    </div>
  );
}
