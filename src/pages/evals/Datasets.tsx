// Every dataset in the workspace: where it comes from, its license, its
// version and grader, and its first questions. Built-in sets cannot be
// deleted; saved ones can.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Api } from "@/api/client";
import { Button } from "@/components/ui/button";
import type { Dataset, DatasetSummary } from "@/run/datasets";
import { cn } from "@/lib/utils";
import { useServer } from "@/store/server";

const GRADER: Record<string, string> = { answer: "Final answer", number: "Number", math: "Math (LaTeX)", contains: "Contains", llm: "LLM judge", code: "Code: run the tests", none: "None: judged pairwise" };

/** What a case expects, short: a code case's spec is the function its tests call. */
function expectedText(e: string): string {
  if (e.startsWith("{")) {
    try {
      const s = JSON.parse(e) as { kind?: string; entry_point?: string };
      if (s.kind === "code") return `tests of ${s.entry_point ?? "the code"}()`;
    } catch {
      /* as it is */
    }
  }
  return e;
}

export function DatasetsPage() {
  const connected = useServer((s) => s.status === "connected");
  const [list, setList] = useState<DatasetSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Dataset | null>(null);
  const load = useCallback(() => void Api.datasets().then((r) => setList(r.datasets)).catch(() => setList([])), []);
  useEffect(() => {
    if (connected) load();
  }, [connected, load]);
  useEffect(() => {
    setDetail(null);
    if (open) void Api.dataset(open).then(setDetail).catch(() => setDetail(null));
  }, [open]);
  if (!connected)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Datasets live on the server. <Link to="/settings" className="text-primary underline">Connect to it in Settings</Link>.
      </div>
    );
  return (
    <div className="h-full overflow-y-auto p-3 md:p-6">
      <div className="mx-auto max-w-5xl space-y-3">
        <Link to="/evals" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Evaluate
        </Link>
        <section className="glass-panel rounded-xl p-4" aria-label="Datasets">
          <h2 className="text-sm font-semibold">Datasets</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            The questions evaluations run on. A dataset's version is a hash of its cases, so two evaluations with the same version ran the same questions. Add one on the Evaluate page ("Save these questions as a dataset…") or with <code className="rounded bg-secondary px-1">POST /api/datasets</code>.
          </p>
          <table className="mt-3 w-full text-left text-[12px]">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/70">
                <th className="py-1.5 font-medium">Name</th>
                <th className="py-1.5 text-right font-medium">Questions</th>
                <th className="py-1.5 pl-3 font-medium">Grader</th>
                <th className="py-1.5 font-medium">Source · license</th>
                <th className="py-1.5 font-medium">Version</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list?.map((d) => (
                <tr key={d.id} className={cn("cursor-pointer border-b border-border/40 align-top hover:bg-secondary/40", open === d.id && "bg-secondary/50")} onClick={() => setOpen(open === d.id ? null : d.id)} aria-selected={open === d.id}>
                  <td className="py-1.5 pr-2">
                    <span className="font-medium">{d.name}</span>
                    {d.builtin && <span className="ml-1.5 rounded-full bg-secondary px-1.5 text-[10.5px] text-muted-foreground">built in</span>}
                    {d.description && <span className="block text-[11px] text-muted-foreground">{d.description}</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{d.total}</td>
                  <td className="py-1.5 pl-3">{GRADER[d.grader] ?? d.grader}</td>
                  <td className="max-w-72 py-1.5 pr-2 text-[11px] text-muted-foreground">
                    {d.source?.origin ? (/^https?:\/\//.test(d.source.origin.split(" ")[0]) ? <a href={d.source.origin.split(" ")[0]} target="_blank" rel="noreferrer" className="break-all text-info hover:underline" onClick={(e) => e.stopPropagation()}>{d.source.origin}</a> : d.source.origin) : "—"}
                    {d.source?.license && <span className="block">{d.source.license}</span>}
                  </td>
                  <td className="py-1.5 font-mono text-[11px] text-muted-foreground">{d.version}</td>
                  <td className="py-1.5 text-right">
                    {!d.builtin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={`Delete ${d.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete the dataset ${d.name}? Evaluations that used it keep their results.`)) void Api.deleteDataset(d.id).then(load);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {open && (
          <section className="glass-panel rounded-xl p-4" aria-label="Dataset questions">
            {!detail ? (
              <p className="text-[12px] text-muted-foreground">Loading…</p>
            ) : (
              <>
                <h3 className="text-sm font-semibold">{detail.name}: the first questions</h3>
                {detail.source?.citation && <p className="mt-0.5 text-[11px] text-muted-foreground">{detail.source.citation}</p>}
                <ol className="mt-2 space-y-2">
                  {detail.cases.slice(0, 5).map((c, i) => (
                    <li key={i} className="rounded-lg bg-secondary/40 p-2.5 text-[12px]">
                      <p className="line-clamp-6 whitespace-pre-wrap">{c.input}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        expects <span className="font-medium text-foreground">{expectedText(String(c.expected)).slice(0, 200)}</span>
                      </p>
                    </li>
                  ))}
                </ol>
                {detail.cases.length > 5 && <p className="mt-2 text-[11px] text-muted-foreground">…and {detail.cases.length - 5} more.</p>}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
