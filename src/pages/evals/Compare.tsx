// Evaluations of different systems on the same questions, side by side:
// accuracy with its spread over repeats, cost, and which question each got right.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Copy, Download, Flag } from "lucide-react";
import { Api, type DatasetFlag, type EvalSummary } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { downloadText, timeAgo, usd } from "@/lib/format";
import { csvGrid, markdownTable } from "@/run/exportEvals";
import { cn } from "@/lib/utils";
import { type EvalRecord, pairedDiff, repeatStats } from "@/run/evals";
import { formatVars } from "@/run/vars";
import { useServer } from "@/store/server";

const modelsLabel = (e: Pick<EvalRecord, "on_model" | "model_map" | "mock" | "vars">) =>
  [e.mock ? "dry run" : [e.on_model && `all on ${e.on_model}`, ...Object.entries(e.model_map ?? {}).map(([a, b]) => `${a}→${b}`)].filter(Boolean).join(", ") || "its own models", e.vars && formatVars(e.vars)]
    .filter(Boolean)
    .join(" · ");

/** The models an evaluation ran on, as one key for the filter: "gemini_lite", "mixed models", "its own models". */
const modelKey = (e: Pick<EvalRecord, "on_model" | "model_map" | "mock">) => (e.mock ? "dry run" : e.on_model ? e.on_model : e.model_map && Object.keys(e.model_map).length ? "mixed models" : "its own models");

const incomplete = (e: EvalSummary) => e.status !== "finished" || e.graded < e.total;
/** an evaluation in which no model ever answered (no key, a dead endpoint): a broken run, not a score of 0 */
const noAnswers = (e: EvalSummary) => !e.mock && e.usd === 0 && e.passed === 0;

export function ComparePage() {
  const connected = useServer((s) => s.status === "connected");
  const [params, setParams] = useSearchParams();
  const [all, setAll] = useState<EvalSummary[] | null>(null);
  const [records, setRecords] = useState<Record<string, EvalRecord>>({});
  // evaluations left out by hand; null = the default (older runs of the same system on the same models)
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  // the evaluation the others are compared with question by question; null = a baseline, else the least accurate
  const [refPick, setRefPick] = useState<string | null>(null);
  const [onlyDiffer, setOnlyDiffer] = useState(false);
  // show the evaluations on one model only; "all" shows every one
  const [modelFilter, setModelFilter] = useState("all");
  const flash = (msg: string) => {
    setCopied(msg);
    window.setTimeout(() => setCopied(""), 1800);
  };

  useEffect(() => {
    if (!connected) return;
    Api.evals()
      .then((r) => setAll(r.evals.filter((e) => e.status !== "running" && e.graded > 0)))
      .catch((e) => setError(e.message));
  }, [connected]);

  // question sets with at least one evaluation, the most compared first
  const sets = useMemo(() => {
    const by = new Map<string, EvalSummary[]>();
    for (const e of all ?? []) by.set(e.set, [...(by.get(e.set) ?? []), e]);
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [all]);
  const set = params.get("set") ?? sets[0]?.[0] ?? "";
  const members = useMemo(() => sets.find(([id]) => id === set)?.[1] ?? [], [sets, set]);
  const superseded = useMemo(() => {
    const seen = new Set<string>();
    const out = new Set<string>();
    for (const e of [...members].sort((a, b) => b.started_at.localeCompare(a.started_at))) {
      const k = `${e.system_id}|${modelsLabel(e)}|${e.grader}`;
      // an evaluation that did not run every case (stopped, cut off) would rank on a part of the questions: off by default too
      if (seen.has(k) || incomplete(e) || noAnswers(e)) out.add(e.id);
      seen.add(k);
    }
    return out;
  }, [members]);
  const off = picked ?? superseded;
  const setOff = (fn: (s: Set<string>) => Set<string>) => setPicked(fn(off));

  useEffect(() => {
    for (const e of members) {
      if (records[e.id]) continue;
      Api.evalRecord(e.id)
        .then((r) => setRecords((m) => ({ ...m, [e.id]: r.eval })))
        .catch(() => undefined);
    }
  }, [members, records]);

  // questions flagged as broken in the set's dataset: left out of scores unless asked for
  const datasetId = useMemo(() => members.map((e) => records[e.id]?.dataset?.id).find(Boolean) ?? null, [members, records]);
  const [flags, setFlags] = useState<DatasetFlag[]>([]);
  const [leaveOut, setLeaveOut] = useState(true);
  useEffect(() => {
    setFlags([]);
    if (!datasetId) return;
    Api.datasetFlags(datasetId)
      .then((r) => setFlags(r.flags))
      .catch(() => undefined);
  }, [datasetId]);
  const flagged = useMemo(() => new Map(flags.map((f) => [f.input, f.reason])), [flags]);
  const flag = (input: string, reason: string | null) => {
    if (!datasetId) return;
    Api.flagQuestion(datasetId, input, reason)
      .then((r) => setFlags(r.flags))
      .catch((e) => setError(e.message));
  };

  if (!connected)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Evaluations live on the server. <Link to="/settings" className="text-primary underline">Connect to it in Settings</Link>.
      </p>
    );
  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!all) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (!sets.length) return <p className="p-6 text-sm text-muted-foreground">No finished evaluations yet. Run some on the Evaluate page, on the same questions, to compare them here.</p>;

  const models = [...new Set(members.map(modelKey))];
  const shown = modelFilter === "all" || !models.includes(modelFilter) ? members : members.filter((e) => modelKey(e) === modelFilter);
  const allRows = shown
    .filter((e) => records[e.id])
    .map((e) => {
      const full = records[e.id];
      // scores, spreads, exports and paired tests leave flagged questions out; the grid still shows them
      const rec = leaveOut && flagged.size ? { ...full, cases: full.cases.filter((c) => !flagged.has(c.input)) } : full;
      const st = repeatStats(rec);
      const passed = rec.cases.filter((c) => c.pass).length;
      const graded = rec.cases.filter((c) => c.pass !== undefined).length;
      return { e, rec, full, st, acc: st.mean ?? (graded ? passed / graded : 0) };
    })
    .sort((a, b) => b.acc - a.acc || a.e.usd - b.e.usd);
  const rows = allRows.filter((r) => !off.has(r.e.id));
  // the ticked evaluations, as the exports describe them
  const exportRows = rows.map(({ e, rec }) => ({ label: e.system_name, setup: modelsLabel(e), rec }));
  // the questions in set order, with each evaluation's pass count on it
  const questions = rows[0] ? [...new Map(rows[0].full.cases.map((c, i) => [c.case ?? i, c.input])).entries()] : [];
  // the reference: the one picked, else the plain single agent on the model most rows use, else any baseline
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(modelKey(r.e), (counts.get(modelKey(r.e)) ?? 0) + 1);
  const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const ref =
    rows.find((r) => r.e.id === refPick) ??
    rows.find((r) => r.e.system_id === "sys_baseline" && modelKey(r.e) === common) ??
    rows.find((r) => r.e.system_id === "sys_baseline") ??
    rows.find((r) => /baseline/i.test(r.e.system_id)) ??
    rows[rows.length - 1];
  const vsRef = new Map(rows.filter((r) => r !== ref && ref).map((r) => [r.e.id, pairedDiff(r.rec, ref!.rec)]));
  const cell = (rec: EvalRecord, input: string) => {
    const cs = rec.cases.filter((c) => c.input === input && c.pass !== undefined);
    return { passed: cs.filter((c) => c.pass).length, graded: cs.length };
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/evals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Evaluate
        </Link>
        <Select
          value={set}
          onValueChange={(v) => (setParams({ set: v }), setPicked(null))}
          items={sets.map(([id, es]) => ({ value: id, label: `${es.find((e) => e.set_name)?.set_name ?? `“${es[0].first_question.slice(0, 48)}…”`} · ${es[0].questions} questions · ${es.length} evaluation${es.length > 1 ? "s" : ""}` }))}
          ariaLabel="Question set"
          className="max-w-xl"
        />
        {models.length > 1 && (
          <Select
            value={models.includes(modelFilter) ? modelFilter : "all"}
            onValueChange={setModelFilter}
            items={[{ value: "all", label: `All models (${models.length})` }, ...models.map((m) => ({ value: m, label: m === "its own models" || m === "mixed models" || m === "dry run" ? m : `all on ${m}` }))]}
            ariaLabel="Models"
            className="max-w-[14rem]"
          />
        )}
        {rows.length > 0 && (
          <div className="ml-auto flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              title="The table above as Markdown, for a write-up"
              onClick={() =>
                void navigator.clipboard
                  .writeText(markdownTable(exportRows, ref?.rec))
                  .then(() => flash("Copied"))
                  .catch(() => flash("Could not copy"))
              }
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" /> {copied || "Copy as Markdown"}
            </Button>
            <Button variant="outline" size="sm" title="Question by question: the share of runs each system got right" onClick={() => downloadText(`comparison-${set}.csv`, csvGrid(exportRows), "text/csv")}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
            </Button>
          </div>
        )}
      </div>

      <section className="glass-panel rounded-xl p-4" aria-label="Results">
        <table className="w-full text-left text-[13px]">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border/70">
              <th className="w-8 py-1.5" />
              <th>System</th>
              <th>Models · variables</th>
              <th className="text-right">Accuracy</th>
              <th className="hidden text-right sm:table-cell">Per repeat</th>
              <th className="hidden text-right lg:table-cell" title="Questions this system got right that the reference got wrong (+), and the other way (−); p: exact McNemar test on those">vs reference</th>
              <th className="text-right">Cost</th>
              <th className="hidden text-right sm:table-cell">Per correct answer</th>
              <th className="hidden text-right md:table-cell">Run</th>
            </tr>
          </thead>
          <tbody>
            {[...shown]
              .sort((a, b) => {
                const ra = allRows.find((x) => x.e.id === a.id);
                const rb = allRows.find((x) => x.e.id === b.id);
                return Number(off.has(a.id)) - Number(off.has(b.id)) || (rb?.acc ?? 0) - (ra?.acc ?? 0) || b.started_at.localeCompare(a.started_at);
              })
              .map((e) => {
              const r = allRows.find((x) => x.e.id === e.id);
              const on = !off.has(e.id);
              return (
                <tr key={e.id} className={cn("border-b border-border/40", !on && "opacity-50")}>
                  <td className="py-2">
                    <input type="checkbox" checked={on} aria-label={`Include ${e.system_name}`} onChange={() => setOff((s) => (s.has(e.id) ? new Set([...s].filter((x) => x !== e.id)) : new Set([...s, e.id])))} />
                  </td>
                  <td className="py-2 pr-3">
                    <Link to={`/evals/${e.system_id}`} className="font-medium hover:underline">
                      {e.system_name}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{modelsLabel(e)}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{r ? `${Math.round(r.acc * 1000) / 10}%` : "…"}</td>
                  <td className="hidden py-2 text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
                    {r && r.st.per.length > 1 ? `${r.st.per.map((p) => Math.round(p * 100)).join(" · ")}${r.st.sd !== null ? ` (sd ${Math.round(r.st.sd * 1000) / 10})` : ""}` : "one run"}
                  </td>
                  <td className="hidden py-2 text-right text-xs tabular-nums lg:table-cell">
                    {!on || !ref ? null : ref.e.id === e.id ? (
                      <span className="text-muted-foreground">reference</span>
                    ) : (
                      (() => {
                        const d = vsRef.get(e.id);
                        if (!d) return "…";
                        return (
                          <button
                            type="button"
                            className="hover:underline"
                            title={`Fixed: ${d.fixed.map((k) => `#${k + 1}`).join(" ") || "none"}\nLost: ${d.lost.map((k) => `#${k + 1}`).join(" ") || "none"}\nOn ${d.shared} shared questions. Click to make this the reference.`}
                            onClick={() => setRefPick(e.id)}
                          >
                            <span className="text-emerald-700 dark:text-emerald-300">+{d.fixed.length}</span> <span className="text-destructive">−{d.lost.length}</span>
                            <span className={cn("ml-1", d.p < 0.05 ? "font-medium text-foreground" : "text-muted-foreground")}>p {d.p < 0.001 ? "<0.001" : d.p.toFixed(d.p < 0.01 ? 3 : 2)}</span>
                          </button>
                        );
                      })()
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{usd(e.usd)}</td>
                  <td className="hidden py-2 text-right tabular-nums text-muted-foreground sm:table-cell">{(() => { const ok = r ? r.rec.cases.filter((c) => c.pass).length : e.passed; return ok ? usd(e.usd / ok) : "–"; })()}</td>
                  <td className="hidden py-2 text-right text-xs text-muted-foreground md:table-cell" title={e.started_at}>
                    {timeAgo(e.started_at)}
                    {incomplete(e) ? ` · ${e.status}, ${e.graded} of ${e.total} graded` : noAnswers(e) ? " · no model answered" : superseded.has(e.id) ? " · older" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-muted-foreground">Sorted by accuracy. Older runs of the same system on the same models, evaluations that did not finish, and ones where no model answered start unticked. With few questions or one repeat, differences of a point or two are within run-to-run noise: compare the spread. “vs reference” counts the questions each system fixed and lost against the reference (click one to make it the reference); p below 0.05 means a difference that size is unlikely by chance.</p>
      </section>

      {rows.length > 0 && (
        <section className="glass-panel overflow-x-auto rounded-xl p-4" aria-label="Question by question">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold">Question by question</h2>
            {flagged.size > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={flags.map((f) => `${f.reason}: ${f.input.slice(0, 80)}`).join("\n")}>
                <input type="checkbox" checked={leaveOut} onChange={(ev) => setLeaveOut(ev.target.checked)} /> Leave out {flagged.size} flagged question{flagged.size === 1 ? "" : "s"}
              </label>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={onlyDiffer} onChange={(ev) => setOnlyDiffer(ev.target.checked)} /> Only questions where they differ
            </label>
          </div>
          <table className="text-[12px]">
            <thead>
              <tr>
                <th className="w-8" />
                <th className="min-w-[16rem] pb-1 text-left font-normal text-muted-foreground">Question</th>
                {rows.map(({ e }) => (
                  <th key={e.id} className="px-1 pb-1 align-bottom font-normal text-muted-foreground">
                    <span className="block max-w-[7rem] truncate" title={`${e.system_name} · ${modelsLabel(e)}`}>
                      {e.system_name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {questions.map(([k, input]) => {
                const cells = rows.map(({ full }) => cell(full, input));
                const why = flagged.get(input);
                const allFail = cells.every((c) => c.graded && !c.passed);
                const fractions = cells.filter((c) => c.graded).map((c) => c.passed / c.graded);
                if (onlyDiffer && fractions.every((f) => f === fractions[0])) return null;
                return (
                  <tr key={k} className={cn(allFail && !why && "bg-destructive/5", why && "opacity-50")}>
                    <td className="pr-2 text-right tabular-nums text-muted-foreground">{k + 1}</td>
                    <td className="max-w-[28rem] truncate py-0.5 pr-3" title={why ? `Flagged: ${why}\n\n${input}` : input}>
                      {datasetId && (
                        <button
                          type="button"
                          className={cn("mr-1.5 align-middle", why ? "text-amber-600" : "text-muted-foreground/40 hover:text-amber-600")}
                          aria-label={why ? `Clear the flag on question ${k + 1}` : `Flag question ${k + 1} as broken`}
                          title={why ? `Flagged: ${why} (click to clear)` : "Flag as broken: its key cannot be right, or it has no sensible answer"}
                          onClick={() => {
                            if (why) return flag(input, null);
                            const reason = window.prompt("Why is this question broken? (it will be left out of scores)", "the key cannot be right");
                            if (reason) flag(input, reason);
                          }}
                        >
                          <Flag className="inline h-3 w-3" />
                        </button>
                      )}
                      <span className={cn(why && "line-through")}>{input}</span>
                    </td>
                    {cells.map((c, i) => {
                      const f = c.graded ? c.passed / c.graded : null;
                      return (
                        <td key={i} className="px-1 py-0.5">
                          <span
                            className={cn(
                              "block rounded px-1.5 py-0.5 text-center tabular-nums",
                              f === null ? "text-muted-foreground" : f === 1 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : f === 0 ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                            )}
                            title={`${rows[i].e.system_name}: passed ${c.passed} of ${c.graded}`}
                          >
                            {c.graded ? (c.graded > 1 ? `${c.passed}/${c.graded}` : c.passed ? "✓" : "✗") : "–"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">A shaded row is a question no system got right in any run.</p>
        </section>
      )}
    </div>
  );
}
