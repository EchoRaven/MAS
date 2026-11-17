// Evaluations: run a system over a set of cases on the server, grade every
// output against its expected answer, and compare runs of the same system.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Check, FlaskConical, Play, Square, Trash2, X } from "lucide-react";
import { Api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { timeAgo, usd } from "@/lib/format";
import { DEFAULT_MODELS } from "@/model/defaults";
import { modelUses, remapModels, runAllOn } from "@/model/modelUse";
import { ModelWarnings } from "@/components/shared/ModelWarnings";
import { cn } from "@/lib/utils";
import { type EvalRecord, type Grader, parseCases, repeatStats, SAMPLE_SETS } from "@/run/evals";
import { formatVars, parseVars, readVars } from "@/run/vars";
import { Input } from "@/components/ui/input";
import { useServer } from "@/store/server";
import { useSystems } from "@/store/systems";

type Summary = Omit<EvalRecord, "cases"> & { total: number };

const GRADERS: { value: Grader; label: string; hint: string }[] = [
  { value: "number", label: "Number", hint: "The last number in the final answer equals the expected one (fractions and percentages too)" },
  { value: "answer", label: "Final answer", hint: "The final answer (after Answer: / Final:, else the last line) equals the expected one, ignoring case and punctuation; an option letter matches 'B. …'" },
  { value: "contains", label: "Contains", hint: "The expected answer appears anywhere in the output" },
  { value: "llm", label: "LLM judge", hint: "A model reads the output and decides whether it gives the expected answer" },
];

const pct = (passed: number, graded: number) => (graded ? `${Math.round((100 * passed) / graded)}%` : "–");

export function EvalsPage() {
  const { systemId } = useParams();
  const systems = useSystems((s) => s.systems);
  if (!systemId) return systems.length ? <Navigate to={`/evals/${systems[0].id}`} replace /> : <Navigate to="/" replace />;
  const doc = systems.find((s) => s.id === systemId);
  if (!doc) return <Navigate to="/" replace />;
  return <Evals key={doc.id} systemId={doc.id} />;
}

function Evals({ systemId }: { systemId: string }) {
  const systems = useSystems((s) => s.systems);
  const doc = systems.find((s) => s.id === systemId)!;
  const navigate = useNavigate();
  const connected = useServer((s) => s.status === "connected");
  const [text, setText] = useState("");
  const [grader, setGrader] = useState<Grader>("number");
  const [concurrency, setConcurrency] = useState("2");
  const [repeats, setRepeats] = useState("1");
  const [dry, setDry] = useState(false);
  const [varsText, setVarsText] = useState("");
  const wanted = useMemo(() => readVars(doc), [doc]);
  const vars = parseVars(varsText);
  // "" = the system's own models, "per" = chosen per model (modelMap), else every chat model on that one
  const [onModel, setOnModel] = useState("");
  const [modelMap, setModelMap] = useState<Record<string, string>>({});
  const usedModels = useMemo(() => [...new Set(modelUses(doc).map((u) => u.model))].filter((id) => (doc.models.find((m) => m.id === id)?.kind ?? "chat") === "chat"), [doc]);
  // chat models the system could be run on instead of its own: its catalog, then the defaults
  const chatModels = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of [...doc.models, ...DEFAULT_MODELS]) if ((m.kind ?? "chat") === "chat" && m.provider !== "mock" && !seen.has(m.id)) seen.set(m.id, `${m.id} · ${m.model}`);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [doc.models]);
  const [list, setList] = useState<Summary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [record, setRecord] = useState<{ eval: EvalRecord; active: boolean } | null>(null);
  const [error, setError] = useState("");
  const parsed = useMemo(() => parseCases(text), [text]);
  // the system as the evaluation will run it, for the model warnings
  const effective = useMemo(() => {
    try {
      if (onModel === "per") return remapModels(doc, modelMap, DEFAULT_MODELS);
      return onModel ? runAllOn(doc, onModel, DEFAULT_MODELS) : doc;
    } catch {
      return doc;
    }
  }, [doc, onModel, modelMap]);

  const refresh = useCallback(async () => {
    const { evals } = await Api.evals(systemId);
    setList(evals);
    return evals;
  }, [systemId]);

  useEffect(() => {
    if (!connected) return;
    void refresh()
      .then((l) => setSelected((s) => s ?? l[0]?.id ?? null))
      .catch((e) => setError(e.message));
  }, [connected, refresh]);

  // the selected evaluation, polled while it runs
  useEffect(() => {
    if (!selected || !connected) return setRecord(null);
    let live = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const r = await Api.evalRecord(selected);
        if (!live) return;
        setRecord(r);
        if (r.active) timer = window.setTimeout(load, 1500);
        else void refresh();
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    void load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [selected, connected, refresh]);

  const start = async (force = false) => {
    setError("");
    try {
      const rec = await Api.startEval({ doc, cases: parsed.cases, grader, mock: dry, concurrency: Number(concurrency), on_model: onModel && onModel !== "per" ? onModel : undefined, model_map: onModel === "per" ? modelMap : undefined, repeats: Number(repeats), ...(Object.keys(vars.vars).length ? { vars: vars.vars } : {}), force });
      await refresh();
      setSelected(rec.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!connected)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Evaluations run on the server. <Link to="/settings" className="text-primary underline">Connect to it in Settings</Link>.
      </div>
    );

  const ev = record?.eval;
  const stats = ev ? repeatStats(ev) : null;
  // a question's repeats sit together
  const rows = ev ? ev.cases.map((c, i) => ({ c, i })).sort((a, b) => (a.c.case ?? a.i) - (b.c.case ?? b.i) || (a.c.repeat ?? 0) - (b.c.repeat ?? 0)) : [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 md:flex-row md:overflow-hidden md:p-4">
      <aside className="flex w-full shrink-0 flex-col gap-3 md:w-[380px] md:overflow-y-auto">
        <Select value={systemId} onValueChange={(id) => navigate(`/evals/${id}`)} items={systems.map((s) => ({ value: s.id, label: s.name }))} ariaLabel="Select system" />
        <form
          className="glass-panel space-y-2.5 rounded-xl p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">New evaluation</h2>
            <Select
              value=""
              placeholder="Load a sample set…"
              onValueChange={(name) => {
                const set = SAMPLE_SETS.find((x) => x.name === name);
                if (set) (setText(set.text), setGrader(set.grader));
              }}
              items={SAMPLE_SETS.map((x) => ({ value: x.name, label: x.name }))}
              ariaLabel="Load a sample set"
              size="sm"
              className="w-44"
            />
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            aria-label="Cases"
            placeholder={'One case per line: question | expected answer\nor JSON lines: {"input": "…", "expected": "…"}'}
            className="font-mono text-[12px]"
          />
          <p className="text-xs text-muted-foreground">
            {parsed.cases.length} case{parsed.cases.length === 1 ? "" : "s"}
            {Number(repeats) > 1 ? ` × ${repeats} repeats = ${parsed.cases.length * Number(repeats)} runs` : ""}
            {parsed.skipped ? <span className="text-destructive"> · {parsed.skipped} line{parsed.skipped === 1 ? "" : "s"} not understood</span> : null}
          </p>
          <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Grader
              <Select value={grader} onValueChange={(v) => setGrader(v as Grader)} items={GRADERS.map((g) => ({ value: g.value, label: g.label }))} ariaLabel="Grader" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Runs at once
              <Select value={concurrency} onValueChange={setConcurrency} items={["1", "2", "3", "4"].map((v) => ({ value: v, label: v }))} ariaLabel="Runs at once" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground" title="Run every question this many times: scores move between runs, and the spread says how much">
              Repeats
              <Select value={repeats} onValueChange={setRepeats} items={["1", "2", "3", "5"].map((v) => ({ value: v, label: v }))} ariaLabel="Repeats" />
            </label>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">{GRADERS.find((g) => g.value === grader)?.hint}</p>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Models
            <Select value={onModel || "own"} onValueChange={(v) => setOnModel(v === "own" ? "" : v)} items={[{ value: "own", label: "As the system says" }, ...chatModels.map((m) => ({ value: m.value, label: `Everything on ${m.label}` })), { value: "per", label: "Choose per model…" }]} ariaLabel="Models" />
          </label>
          {onModel === "per" && (
            <div className="space-y-1.5 rounded-lg bg-secondary/50 p-2">
              {usedModels.map((id) => (
                <label key={id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {id} <span className="opacity-70">({doc.models.find((m) => m.id === id)?.model})</span>
                  </span>
                  <Select
                    value={modelMap[id] ?? "same"}
                    onValueChange={(v) => setModelMap(({ [id]: _old, ...rest }) => (v === "same" ? rest : { ...rest, [id]: v }))}
                    items={[{ value: "same", label: "as it is" }, ...chatModels.filter((m) => m.value !== id).map((m) => ({ value: m.value, label: m.label }))]}
                    ariaLabel={`Serve ${id} with`}
                    size="sm"
                    className="max-w-48"
                  />
                </label>
              ))}
            </div>
          )}
          {(wanted.length > 0 || varsText) && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground" title="Values every run starts with; the system's code reads them as ctx.vars">
              Variables
              <Input value={varsText} onChange={(e) => setVarsText(e.target.value)} placeholder={wanted.map((w) => `${w}=…`).join(", ")} aria-label="Run variables" className="h-8 text-xs" />
              {vars.bad.length > 0 && <span className="text-destructive">not name=value: {vars.bad[0]}</span>}
            </label>
          )}
          <ModelWarnings doc={effective} skip={dry} hint="or pick other models above" />
          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="Every model is replaced by the built-in test model: no cost, canned answers">
              <input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} />
              <FlaskConical className="h-3.5 w-3.5" /> Dry run
            </label>
            <Button type="submit" size="sm" disabled={!parsed.cases.length}>
              <Play className="mr-1.5 h-3.5 w-3.5" /> Evaluate
            </Button>
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}{" "}
              {/has \d+ error/.test(error) && (
                <button type="button" className="underline" onClick={() => void start(true)}>
                  Run anyway
                </button>
              )}
            </p>
          )}
        </form>

        <section aria-label="Evaluations of this system" className="space-y-1">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs text-muted-foreground">{list.length ? "Earlier evaluations" : "No evaluations of this system yet"}</h2>
            <Link to="/evals/compare" className="text-xs text-primary hover:underline">
              Compare systems →
            </Link>
          </div>
          {list.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelected(e.id)}
              className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary", selected === e.id && "bg-secondary")}
            >
              <span className="min-w-0">
                <span className="font-medium tabular-nums">{pct(e.passed, e.graded)}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {e.passed}/{e.total}
                  {(e.repeats ?? 1) > 1 ? ` (×${e.repeats})` : ""} · {GRADERS.find((g) => g.value === e.grader)?.label}
                  {e.mock ? " · dry run" : ""}
                  {e.on_model ? ` · on ${e.on_model}` : ""}
                  {e.model_map ? ` · ${Object.values(e.model_map).join(" / ")}` : ""}
                  {e.vars ? ` · ${formatVars(e.vars)}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{e.status === "running" ? "running…" : timeAgo(e.started_at)}</span>
            </button>
          ))}
        </section>
      </aside>

      <main className="glass-panel min-h-[320px] min-w-0 flex-1 overflow-y-auto rounded-xl p-4">
        {!ev ? (
          <p className="text-sm text-muted-foreground">Paste cases (or pick a sample set) and press Evaluate. Each case runs as an ordinary run, so you can open any of them.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
              <div>
                <p className="text-xs text-muted-foreground">Accuracy</p>
                <p className="text-3xl font-semibold tabular-nums">{pct(ev.passed, ev.graded)}</p>
                {stats && stats.per.length > 1 && (
                  <p className="text-xs tabular-nums text-muted-foreground" title="Accuracy of each repeat, and their standard deviation">
                    {stats.per.map((p) => `${Math.round(p * 100)}%`).join(" · ")}
                    {stats.sd !== null ? ` (sd ${Math.round(stats.sd * 1000) / 10} pts)` : ""}
                  </p>
                )}
              </div>
              <Stat label="Passed" value={`${ev.passed} of ${ev.cases.length}`} />
              <Stat label="Cost" value={usd(ev.usd)} />
              <Stat label="Per case" value={ev.graded ? usd(ev.usd / ev.graded) : "–"} />
              <Stat label="Grader" value={`${GRADERS.find((g) => g.value === ev.grader)?.label}${ev.mock ? " · dry run" : ""}`} />
              {ev.vars && <Stat label="Variables" value={formatVars(ev.vars)} />}
              {(ev.on_model || ev.model_map) && <Stat label="Models" value={[ev.on_model && `all on ${ev.on_model}`, ...Object.entries(ev.model_map ?? {}).map(([a, b]) => `${a} → ${b}`)].filter(Boolean).join(", ")} />}
              <Stat label="Status" value={record?.active ? `running · ${ev.cases.filter((c) => c.status === "done" || c.status === "error").length}/${ev.cases.length}` : ev.status} />
              <div className="ml-auto flex gap-1.5">
                {record?.active ? (
                  <Button variant="outline" size="sm" onClick={() => void Api.stopEval(ev.id)}>
                    <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
                  </Button>
                ) : (
                  <>
                    {grader !== "llm" && (
                      <Button
                        variant="outline"
                        size="sm"
                        title="Grade the stored outputs again with the grader chosen on the left; nothing is run again"
                        onClick={() =>
                          void Api.regradeEval(ev.id, grader)
                            .then((r) => setRecord({ eval: r, active: false }))
                            .then(refresh)
                            .catch((e) => setError(e.message))
                        }
                      >
                        Regrade as {GRADERS.find((g) => g.value === grader)?.label}
                      </Button>
                    )}
                    <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Delete this evaluation"
                    onClick={() =>
                      void Api.deleteEval(ev.id).then(async () => {
                        const l = await refresh();
                        setSelected(l[0]?.id ?? null);
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  </>
                )}
              </div>
            </div>
            {ev.stop_reason && (
              <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                {ev.stop_reason}
              </p>
            )}
            <table className="mt-4 w-full table-fixed text-left text-[13px]">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/70">
                  <th className="w-8 py-1.5">#</th>
                  <th className="w-[34%]">Input</th>
                  <th className="w-[10%]">Expected</th>
                  <th>Answer</th>
                  <th className="w-[72px] text-right">Cost</th>
                  <th className="w-[56px] text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, i }) => {
                  const first = (c.repeat ?? 0) === 0;
                  const q = stats?.byCase.get(c.case ?? i);
                  return (
                  <tr key={i} className={cn("align-top", (ev.repeats ?? 1) > 1 && !first ? "border-b border-border/20" : "border-b border-border/40")}>
                    <td className="py-2 text-muted-foreground">
                      {c.pass === true ? <Check className="h-4 w-4 text-emerald-600" aria-label="passed" /> : c.pass === false ? <X className="h-4 w-4 text-destructive" aria-label="failed" /> : <span className="text-xs">{(c.case ?? i) + 1}</span>}
                    </td>
                    <td className="py-2 pr-3" title={c.input}>
                      {first ? (
                        <>
                          <span className="line-clamp-3">{c.input}</span>
                          {(ev.repeats ?? 1) > 1 && q && <span className="text-xs text-muted-foreground">passed {q.passed} of {q.graded}</span>}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">repeat {(c.repeat ?? 0) + 1}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-medium">{first ? c.expected : ""}</td>
                    <td className="py-2 pr-3">
                      {c.status === "pending" ? (
                        <span className="text-muted-foreground">{c.why ?? "waiting"}</span>
                      ) : c.status === "running" ? (
                        <span className="text-muted-foreground">running…</span>
                      ) : (
                        <>
                          <span className="line-clamp-2" title={c.output}>
                            {c.answer || "(no answer)"}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {c.why}
                            {c.run_id && (
                              <>
                                {" · "}
                                <Link to={`/runs/${systemId}?run=${c.run_id}`} className="underline">
                                  open the run
                                </Link>
                              </>
                            )}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{c.usd !== undefined ? usd(c.usd) : ""}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{c.seconds !== undefined ? `${c.seconds}s` : ""}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
