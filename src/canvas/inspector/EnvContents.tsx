// What is inside an env, in its inspector: a sandbox's files for a run (or
// one agent's, when each has its own machine) and a file's text, a
// database's tables and rows, an imported env's services and tools.
import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { Api, type EnvContents as Contents } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useServer } from "@/store/server";

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function EnvContents({ systemId, envId }: { systemId: string; envId: string }) {
  const connected = useServer((s) => s.status === "connected");
  const [q, setQ] = useState<{ run?: string; agent?: string; table?: string }>({});
  const [data, setData] = useState<Contents | null>(null);
  const [file, setFile] = useState<Extract<Contents, { kind: "files" }>["file"] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!connected) return;
    setBusy(true);
    Api.envContents(systemId, envId, q)
      .then((d) => (setData(d), setError("")))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [connected, systemId, envId, q]);
  useEffect(load, [load]);
  useEffect(() => setFile(null), [q.run, q.agent, envId]);

  if (!connected) return <p className="text-xs text-muted-foreground">Connect to the server (Settings) to see what is inside.</p>;
  if (error) return <p className="text-xs text-destructive">{/No such system/.test(error) ? "Save the system and run it once: its envs fill up during runs." : error}</p>;
  if (!data) return <p className="text-xs text-muted-foreground">Loading…</p>;

  const refresh = (
    <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Refresh" onClick={load} disabled={busy}>
      <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
    </Button>
  );

  if (data.kind === "files") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          {data.runs.length > 0 && (
            <Select value={data.run ?? ""} onValueChange={(run) => setQ((x) => ({ ...x, run }))} items={data.runs.map((r) => ({ value: r, label: r.replace(/^run_/, "run ") }))} ariaLabel="Run" size="sm" className="min-w-0 flex-1" />
          )}
          {data.agents.length > 0 && <Select value={data.agent ?? ""} onValueChange={(agent) => setQ((x) => ({ ...x, agent }))} items={data.agents.map((a) => ({ value: a, label: a }))} ariaLabel="Agent" size="sm" className="w-28" />}
          <span className="ml-auto">{refresh}</span>
        </div>
        {data.lifecycle === "per_run" && !data.runs.length ? (
          <p className="text-xs text-muted-foreground">No runs yet: each run gets a fresh /work, kept here afterwards.</p>
        ) : !data.files?.length ? (
          <p className="text-xs text-muted-foreground">/work is empty.</p>
        ) : (
          <ul className="max-h-56 overflow-y-auto rounded-md border border-border/60 text-xs" aria-label="Files in /work">
            {data.files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  className={cn("flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/60", file?.path === f.path && "bg-muted")}
                  onClick={() =>
                    Api.envContents(systemId, envId, { ...q, run: data.run ?? undefined, agent: data.agent ?? undefined, path: f.path })
                      .then((d) => d.kind === "files" && setFile(d.file ?? null))
                      .catch((e) => setError(e.message))
                  }
                >
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono">{f.path}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{size(f.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {file && (
          <div className="rounded-md border border-border/60">
            <p className="border-b border-border/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {file.path} · {size(file.size)}
              {file.truncated ? " · first 100 KB" : ""}
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre p-2 font-mono text-[11px] leading-relaxed">{file.binary ? "(binary file)" : file.text || "(empty)"}</pre>
          </div>
        )}
      </div>
    );
  }

  if (data.kind === "database") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center">
          <span className="text-xs text-muted-foreground">{data.note ?? `${data.tables.length} table${data.tables.length === 1 ? "" : "s"}`}</span>
          <span className="ml-auto">{refresh}</span>
        </div>
        <ul className="rounded-md border border-border/60 text-xs" aria-label="Tables">
          {data.tables.map((t) => (
            <li key={t.name}>
              <button type="button" className={cn("flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-muted/60", data.table === t.name && "bg-muted")} onClick={() => setQ((x) => ({ ...x, table: t.name }))} title={t.columns.join(", ")}>
                <span className="font-mono">{t.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.columns.map((c) => c.split(" ")[0]).join(", ")}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{t.rows} rows</span>
              </button>
            </li>
          ))}
        </ul>
        {data.sample && (
          <div className="max-h-72 overflow-auto rounded-md border border-border/60">
            <table className="text-[11px]">
              <thead className="sticky top-0 bg-card">
                <tr>{Object.keys(data.sample[0] ?? {}).map((k) => <th key={k} className="px-2 py-1 text-left font-medium text-muted-foreground">{k}</th>)}</tr>
              </thead>
              <tbody>
                {data.sample.map((row, i) => (
                  <tr key={i} className="border-t border-border/40">
                    {Object.values(row).map((v, j) => <td key={j} className="max-w-[12rem] truncate px-2 py-0.5 font-mono">{v === null ? "∅" : String(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.sample.length && <p className="p-2 text-xs text-muted-foreground">No rows.</p>}
          </div>
        )}
      </div>
    );
  }

  if (data.kind === "imported") {
    const m = data.manifest;
    return (
      <div className="flex flex-col gap-1.5 text-xs">
        <p className="text-muted-foreground">Health: <span className="font-mono">{m.health}</span></p>
        <p className="font-medium">Services</p>
        <ul className="rounded-md border border-border/60">
          {m.services.map((s) => <li key={s.name} className="flex gap-2 px-2 py-1"><span className="font-mono">{s.name}</span><span className="min-w-0 truncate text-muted-foreground">{s.image ?? ""}{s.port ? ` :${s.port}` : ""}</span></li>)}
        </ul>
        {m.tools.length > 0 && <p className="text-muted-foreground">Tools: <span className="font-mono">{m.tools.join(", ")}</span></p>}
      </div>
    );
  }

  if (data.kind === "room") return <p className="text-xs text-muted-foreground">A room's messages are in each run: open a run and filter its Messages by this room.</p>;
  return <p className="text-xs text-muted-foreground">Nothing to show for this kind of env.</p>;
}
