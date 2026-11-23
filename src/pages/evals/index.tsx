// Evaluations: run a system over a set of cases on the server, grade every
// output against its expected answer, and compare runs of the same system.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Check, Download, FlaskConical, Play, Square, Trash2, Upload, X } from "lucide-react";
import { Api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { downloadText, timeAgo, usd } from "@/lib/format";
import { DEFAULT_MODELS } from "@/model/defaults";
import { modelUses, remapModels, runAllOn } from "@/model/modelUse";
import { ModelWarnings } from "@/components/shared/ModelWarnings";
import { cn } from "@/lib/utils";
import type { SystemDoc } from "@/model/types";
import { builtinDatasets, type DatasetSummary, summarize } from "@/run/datasets";
import { type EvalRecord, failureReasons, type Grader, parseCases, repeatStats, etaSeconds, retryableCase, wilson } from "@/run/evals";
import { expectFor, resultTypeFor } from "@/run/result";
import { simulate } from "@/run/simulate";
import { formatVars, parseVars, readVars, sweepOf } from "@/run/vars";
import { Input } from "@/components/ui/input";
import { Pairwise } from "./Pairwise";
import { Trail } from "./Trail";
import { useServer } from "@/store/server";
import { useSystems } from "@/store/systems";

type Summary = Omit<EvalRecord, "cases"> & { total: number };

const GRADERS: { value: Grader; label: string; hint: string }[] = [
  { value: "number", label: "Number", hint: "The last number in the final answer equals the expected one (fractions and percentages too)" },
  { value: "answer", label: "Final answer", hint: "The final answer (after Answer: / Final:, else the last line) equals the expected one, ignoring case and punctuation; an option letter matches 'B. …'" },
  { value: "contains", label: "Contains", hint: "The expected answer appears anywhere in the output" },
  { value: "math", label: "Math (LaTeX)", hint: "The last \\boxed{} (or the final answer) equals the expected one after the MATH benchmark's normalisation: \\frac, \\left, degrees, \\text{} and spacing do not matter, and equal numbers match" },
  { value: "llm", label: "LLM judge", hint: "A model reads the output and decides whether it gives the expected answer" },
  { value: "code", label: "Code: run the tests", hint: "The code in the answer is run with the problem's tests in a throwaway Docker container (no network, 512 MB, 10 s); it passes when the tests do. For HumanEval-style problems" },
  { value: "check", label: "Check: run JS", hint: "JS decides whether each output passes, for answers with no single form (a Game of 24 expression, a list that must meet constraints). It sees output, answer (the final answer), expected and question, and returns true / false or {pass, why}; two seconds per output. A dataset can carry its own" },
  { value: "none", label: "None: compare pairwise", hint: "Nothing is graded: every output is kept, for open-ended tasks (a story, an article). Compare two such evaluations of the same questions pairwise, by a model judging which output is better" },
];

/** the server runs at most this many cases × repeats per evaluation */
const MAX_RUNS = 200;

const pct = (passed: number, graded: number) => (graded ? `${Math.round((100 * passed) / graded)}%` : "–");

/** What a case expects, short: a code case's JSON spec is shown as the function its tests call. */
function expectedLabel(expected: string): string {
  if (!expected.startsWith("{")) return expected;
  try {
    const spec = JSON.parse(expected) as { kind?: string; entry_point?: string };
    if (spec.kind === "code") return spec.entry_point ? `tests of ${spec.entry_point}()` : "tests";
  } catch {
    /* not JSON: show it as it is */
  }
  return expected;
}

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
  const [auditing, setAuditing] = useState(false);
  // a dataset to run on ("" = the questions written or loaded below), and the sample to draw from it
  const [datasetId, setDatasetId] = useState("");
  const [stored, setStored] = useState<DatasetSummary[]>([]);
  const [sampleN, setSampleN] = useState("");
  const [seed, setSeed] = useState("1");
  const [saveName, setSaveName] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [grader, setGrader] = useState<Grader>("number");
  // for grader "check": the JS that decides, from the dataset unless written here
  const [check, setCheck] = useState("");
  const [concurrency, setConcurrency] = useState("2");
  const [repeats, setRepeats] = useState("1");
  // each run's time limit, instead of the system's: "" keeps the system's own
  const [timeLimit, setTimeLimit] = useState("");
  // each run's spending limit instead of the system's budget: a loop that runs away stops at it
  const [usdLimit, setUsdLimit] = useState("");
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
  // the failure reason the case table is narrowed to, if any
  const [onlyReason, setOnlyReason] = useState<string | null>(null);
  useEffect(() => setOnlyReason(null), [selected]);
  const [record, setRecord] = useState<{ eval: EvalRecord; active: boolean } | null>(null);
  const [regrading, setRegrading] = useState(false);
  // questions flagged as broken in this evaluation's dataset: shown, and scored apart
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const flagDataset = record?.eval.dataset?.id;
  useEffect(() => {
    setFlagged(new Set());
    if (!flagDataset) return;
    Api.datasetFlags(flagDataset)
      .then((r) => setFlagged(new Set(r.flags.map((f) => f.input))))
      .catch(() => undefined);
  }, [flagDataset]);
  const [error, setError] = useState("");
  const parsed = useMemo(() => parseCases(text), [text]);
  // the sets shipped with the app work without the server; stored ones come from it
  const builtins = useMemo(() => builtinDatasets().map(summarize), []);
  const loadDatasets = useCallback(() => void Api.datasets().then((r) => setStored(r.datasets.filter((d) => !d.builtin))).catch(() => setStored([])), []);
  useEffect(() => {
    if (connected) loadDatasets();
  }, [connected, loadDatasets]);
  const datasets = [...builtins, ...stored];
  const chosen = datasets.find((d) => d.id === datasetId);
  const sampleSize = Number(sampleN) > 0 ? Number(sampleN) : undefined;
  const caseCount = chosen ? Math.min(sampleSize ?? chosen.total, chosen.total) : parsed.cases.length;
  const rpm = useServer((s) => s.rpm);
  // other systems to run on the same questions, one after another
  const [also, setAlso] = useState<string[]>([]);
  const alsoDocs = useMemo(() => also.map((id) => systems.find((s) => s.id === id)).filter((s): s is SystemDoc => !!s && s.id !== doc.id), [also, systems, doc.id]);
  // model calls one run makes, from a simulated run of the system (an estimate: real runs can loop more or less)
  const callsPerRun = useMemo(() => {
    try {
      return [doc, ...alsoDocs].reduce((n, d) => n + simulate(d).events.filter((e) => e.type === "usage").length, 0);
    } catch {
      return 0;
    }
  }, [doc, alsoDocs]);
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
        setError("");
        if (r.active) timer = window.setTimeout(load, 1500);
        else void refresh();
      } catch (e) {
        if (!live) return;
        setError((e as Error).message);
        // a failed poll (a restart, a blip) is retried, more slowly, rather than leaving the page stuck on "running"
        timer = window.setTimeout(load, 5000);
      }
    };
    void load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [selected, connected, refresh]);

  const [markedAnswers, setMarkedAnswers] = useState(true);
  const start = async (force = false) => {
    setError("");
    try {
      const source = chosen ? { dataset_id: chosen.id, ...(sampleSize && sampleSize < chosen.total ? { sample: { n: sampleSize, seed: Number(seed) || 1 } } : {}) } : { cases: parsed.cases };
      const expect = markedAnswers ? expectFor(grader) : null;
      // n=2|4|8: one evaluation per value, queued one after another (and per system, with others to compare)
      const sw = sweepOf(vars.vars);
      if (sw && "error" in sw) throw new Error(sw.error);
      const theVars = sw ? sw.rest : vars.vars;
      const opts = { ...source, grader, ...(grader === "check" && check.trim() ? { check } : {}), mock: dry, concurrency: Number(concurrency), ...(expect ? { expect } : {}), ...(timeLimit ? { time_limit_min: Number(timeLimit) } : {}), ...(usdLimit ? { usd_limit: Number(usdLimit) } : {}), on_model: onModel && onModel !== "per" ? onModel : undefined, model_map: onModel === "per" ? modelMap : undefined, repeats: Number(repeats), ...(Object.keys(theVars).length ? { vars: theVars } : {}), force };
      const rec = sw ? (await Api.startEvalBatch({ docs: [doc, ...alsoDocs], ...opts, sweep: { name: sw.name, values: sw.values } })).evals[0] : alsoDocs.length ? (await Api.startEvalBatch({ docs: [doc, ...alsoDocs], ...opts })).evals[0] : await Api.startEval({ doc, ...opts });
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
  const reasons = ev ? failureReasons(ev.cases) : [];
  const only = reasons.find((r) => r.reason === onlyReason);
  const rows = ev ? ev.cases.map((c, i) => ({ c, i })).filter(({ i }) => !only || only.cases.includes(i)).sort((a, b) => (a.c.case ?? a.i) - (b.c.case ?? b.i) || (a.c.repeat ?? 0) - (b.c.repeat ?? 0)) : [];
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
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Dataset
            <Select
              value={datasetId || "own"}
              onValueChange={(v) => {
                const id = v === "own" ? "" : v;
                setDatasetId(id);
                const d = datasets.find((x) => x.id === id);
                if (d) {
                  setGrader(d.grader);
                  setCheck(d.check ?? "");
                }
              }}
              items={[{ value: "own", label: "Write or load questions" }, ...datasets.map((d) => ({ value: d.id, label: new RegExp(`\\b${d.total}\\)?$`).test(d.name) ? d.name : `${d.name} · ${d.total}` }))]}
              ariaLabel="Dataset"
            />
          </label>
          {chosen && (
            <div className="space-y-2 rounded-lg bg-secondary/50 p-2.5 text-[12px]">
              <p className="text-muted-foreground">{chosen.description || "No description."}</p>
              {(chosen.source.origin || chosen.source.license) && (
                <p className="text-[11px] text-muted-foreground">
                  {chosen.source.origin && <>From {chosen.source.origin}</>}
                  {chosen.source.license && <> · {chosen.source.license}</>}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                {chosen.total} questions · version {chosen.version}
                {chosen.builtin ? " · built in" : ""}
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                Sample
                <Input value={sampleN} onChange={(e) => setSampleN(e.target.value.replace(/\D/g, ""))} placeholder={`all ${chosen.total}`} aria-label="Sample size" className="h-7 w-20 text-xs" />
                seed
                <Input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} aria-label="Sample seed" className="h-7 w-16 text-xs" />
              </div>
              {!chosen.builtin && (
                <button type="button" className="text-[11px] text-destructive hover:underline" onClick={() => void Api.deleteDataset(chosen.id).then(() => (setDatasetId(""), loadDatasets()))}>
                  Delete this dataset
                </button>
              )}
            </div>
          )}
          {!chosen && (
          <>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" title="A CSV with question and answer columns, JSON lines, or one 'question | answer' per line">
            <Upload className="h-3.5 w-3.5" /> Load cases from a file…
            <input
              type="file"
              accept=".csv,.jsonl,.json,.txt,.tsv"
              className="sr-only"
              aria-label="Load cases from a file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(setText);
                e.target.value = "";
              }}
            />
          </label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            aria-label="Cases"
            placeholder={'One case per line: question | expected answer\nor JSON lines: {"input": "…", "expected": "…"}'}
            className="font-mono text-[12px]"
          />
          {parsed.cases.length > 0 &&
            (saveName === null ? (
              <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => setSaveName("")}>
                Save these questions as a dataset…
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Dataset name" aria-label="Dataset name" className="h-7 text-xs" autoFocus />
                <Button
                  type="button"
                  size="sm"
                  className="h-7"
                  disabled={!saveName.trim()}
                  onClick={() =>
                    void Api.createDataset({ name: saveName.trim(), text, grader })
                      .then((d) => {
                        setSaveName(null);
                        setNotice(`Saved “${d.name}” (${d.total} questions)`);
                        loadDatasets();
                        setDatasetId(d.id);
                      })
                      .catch((e) => setError(e.message))
                  }
                >
                  Save
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => setSaveName(null)}>
                  Cancel
                </Button>
              </div>
            ))}
          </>
          )}
          {notice && <p className="text-[11px] text-success">{notice}</p>}
          <p className="text-xs text-muted-foreground">
            {alsoDocs.length > 0 && `${alsoDocs.length + 1} systems, one after another · `}
            {caseCount} case{caseCount === 1 ? "" : "s"}
            {Number(repeats) > 1 ? ` × ${repeats} repeats = ${caseCount * Number(repeats)} runs` : ""}
            {callsPerRun > 0 && caseCount > 0 && !dry && (
              <span title="From a simulated run of the system; real runs can make more or fewer calls. Requests are capped per minute so the provider never sees a burst">
                {" "}
                · ≈{Math.min(caseCount * Number(repeats), MAX_RUNS) * callsPerRun} model calls, at least {Math.max(1, Math.ceil((Math.min(caseCount * Number(repeats), MAX_RUNS) * callsPerRun) / rpm))} min at {rpm}/min
              </span>
            )}
            {caseCount > 0 &&
              !dry &&
              (() => {
                // how far a score on this many runs can move by chance (95%, at a typical 70% right)
                const n = Math.min(caseCount * Number(repeats), MAX_RUNS);
                const [lo, hi] = wilson(Math.round(0.7 * n), n);
                const spread = Math.round(((hi - lo) / 2) * 100);
                return (
                  <span title="The 95% interval of a score around 70% on this many runs. Two systems are compared question by question on Compare (the paired test), which needs fewer runs than this suggests, but one run of a small set says little either way">
                    {" "}
                    · a score can move about ±{spread} points by chance{Number(repeats) === 1 && n <= 100 ? ": a second repeat narrows it" : ""}
                  </span>
                );
              })()}
            {caseCount * Number(repeats) > MAX_RUNS && <span className="text-amber-700 dark:text-amber-300"> · only the first {Math.floor(MAX_RUNS / Number(repeats))} will run (at most {MAX_RUNS} runs per evaluation)</span>}
            {!chosen && parsed.skipped ? <span className="text-destructive"> · {parsed.skipped} line{parsed.skipped === 1 ? "" : "s"} not understood</span> : null}
          </p>
          <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
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
            <label className="flex flex-col gap-1 text-xs text-muted-foreground" title="Each run's time limit, instead of the system's own. A slower model needs longer: a run cut off by its limit has no answer">
              Minutes
              <Select value={timeLimit || "own"} onValueChange={(v) => setTimeLimit(v === "own" ? "" : v)} items={[{ value: "own", label: `system (${doc.budget.wallclock_min ?? "none"})` }, ...["5", "10", "20", "30", "60"].map((v) => ({ value: v, label: v }))]} ariaLabel="Minutes per run" />
            </label>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">{GRADERS.find((g) => g.value === grader)?.hint}</p>
          {grader === "check" && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Check
              <textarea
                className="min-h-24 rounded-md border border-border bg-background p-2 font-mono text-[11px] text-foreground"
                value={check}
                onChange={(e) => setCheck(e.target.value)}
                placeholder={'return answer.trim() === expected.trim()  // or {pass, why}'}
                aria-label="Check code"
                spellCheck={false}
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground" title="Each run stops once it has spent this much, instead of at the system's own budget. A loop that repeats itself or keeps calling stops here rather than costing more every round">
            Max cost per run
            <Select value={usdLimit || "own"} onValueChange={(v) => setUsdLimit(v === "own" ? "" : v)} items={[{ value: "own", label: `system (${doc.budget.usd != null ? `$${doc.budget.usd}` : "none"})` }, ...["0.05", "0.1", "0.25", "0.5", "1", "2"].map((v) => ({ value: v, label: `$${v}` }))]} ariaLabel="Max cost per run" />
          </label>
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
            <label className="flex flex-col gap-1 text-xs text-muted-foreground" title="Values every run starts with; the system's code reads them as ctx.vars. n=2|4|8 sweeps n: one evaluation per value, one after another">
              Variables
              <Input value={varsText} onChange={(e) => setVarsText(e.target.value)} placeholder={wanted.map((w) => `${w}=…`).join(", ")} aria-label="Run variables" className="h-8 text-xs" />
              {vars.bad.length > 0 && <span className="text-destructive">not name=value: {vars.bad[0]}</span>}
              {(() => {
                const sw = sweepOf(vars.vars);
                if (!sw) return null;
                if ("error" in sw) return <span className="text-destructive">{sw.error}</span>;
                const n = sw.values.length * (1 + alsoDocs.length);
                return <span>Sweeps {sw.name} over {sw.values.join(", ")}: {n} evaluation{n === 1 ? "" : "s"}, one after another, compared under Compare systems</span>;
              })()}
            </label>
          )}
          <details className="text-xs text-muted-foreground" open={also.length > 0}>
            <summary className="cursor-pointer hover:text-foreground">Compare with other systems{alsoDocs.length ? ` (${alsoDocs.length})` : ""}</summary>
            <p className="mt-1">They run on the same questions and models, one after another, and show up together under Compare systems.</p>
            {(() => {
              // the four controls a multi-agent system should beat (docs/benchmarks.md): one agent, a vote, one call
              // imagining the discussion, one agent with the same tools
              const controls = ["sys_baseline", "sys_self_consistency", "sys_paper_spp", "sys_baseline_code"].filter((id) => id !== doc.id && systems.some((x) => x.id === id));
              if (!controls.length || controls.every((id) => also.includes(id))) return null;
              return (
                <button
                  type="button"
                  className="mt-1 text-primary hover:underline"
                  title="One agent, several samples and a vote, one call imagining the discussion (Solo Performance Prompting), one agent with code: each has explained away a claimed gain"
                  onClick={() => setAlso((a) => [...new Set([...a, ...controls])].slice(0, 9))}
                >
                  Add the four controls
                </button>
              );
            })()}
            <div className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border/70 p-1.5" role="group" aria-label="Systems to compare with">
              {systems
                .filter((s) => s.id !== doc.id)
                .map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-secondary/60 hover:text-foreground">
                    <input type="checkbox" checked={also.includes(s.id)} onChange={(e) => setAlso((a) => (e.target.checked ? [...a, s.id] : a.filter((x) => x !== s.id)))} disabled={!also.includes(s.id) && alsoDocs.length >= 9} />
                    <span className="truncate">{s.name}</span>
                  </label>
                ))}
            </div>
          </details>
          {expectFor(grader) && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Each run is checked for a marked answer (a line 'Answer: …', 'Final: …' or \boxed{…}). An answer without one is graded on its last line, which may be a check or a critique; such cases are flagged first among the failures. Grades do not change.">
              <input type="checkbox" checked={markedAnswers} onChange={(e) => setMarkedAnswers(e.target.checked)} /> Check that every answer is marked ("Answer: …")
            </label>
          )}
          {(() => {
            // a system that declares what it returns, graded by a rule that needs something else
            const want = resultTypeFor(grader);
            const has = doc.result?.type;
            if (!want || !has || has === want || (has === "text" && want === "number")) return null;
            return (
              <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200" role="note">
                {doc.name} returns {has}, but the grader {GRADERS.find((g) => g.value === grader)?.label} needs {want}. Most cases will fail for that reason alone.
              </p>
            );
          })()}
          {(() => {
            // a scratchpad every run shares: concurrent and later cases read each other's files
            const shared = doc.nodes.filter((n) => n.data.kind === "plugin" && (n.data.preset === "workspace" || n.data.preset === "board") && n.data.spec.scope === "system");
            if (!shared.length) return null;
            return (
              <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200" role="note">
                {shared.map((n) => n.data.name).join(", ")} {shared.length > 1 ? "are" : "is"} shared by every run and kept between them, so each case can read what the others left there. For a scratchpad that should start empty in every case, set its scope to Per run.
              </p>
            );
          })()}
          <ModelWarnings doc={effective} skip={dry} hint="or pick other models above" />
          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="Every model is replaced by the built-in test model: no cost, canned answers">
              <input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} />
              <FlaskConical className="h-3.5 w-3.5" /> Dry run
            </label>
            <Button type="submit" size="sm" disabled={!caseCount}>
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
            <span className="flex gap-3">
              <Link to="/evals/datasets" className="text-xs text-primary hover:underline">
                Datasets →
              </Link>
              <Link to="/evals/compare" className="text-xs text-primary hover:underline">
                Compare systems →
              </Link>
            </span>
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
                  {e.grader === "none" ? `${e.total} outputs` : `${e.passed}/${e.total}`}
                  {(e.repeats ?? 1) > 1 ? ` (×${e.repeats})` : ""} · {GRADERS.find((g) => g.value === e.grader)?.label}
                  {e.mock ? " · dry run" : ""}
                  {e.on_model ? ` · on ${e.on_model}` : ""}
                  {e.model_map ? ` · ${Object.values(e.model_map).join(" / ")}` : ""}
                  {e.vars ? ` · ${formatVars(e.vars)}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{e.status === "running" ? "running…" : e.status === "queued" ? "queued" : timeAgo(e.started_at)}</span>
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
                <p className="text-3xl font-semibold tabular-nums">{ev.grader === "none" ? "Not graded" : pct(ev.passed, ev.graded)}</p>
                {stats && stats.per.length > 1 && (
                  <p className="text-xs tabular-nums text-muted-foreground" title="Accuracy of each repeat, and their standard deviation">
                    {stats.per.map((p) => `${Math.round(p * 100)}%`).join(" · ")}
                    {stats.sd !== null ? ` (sd ${Math.round(stats.sd * 1000) / 10} pts)` : ""}
                  </p>
                )}
              </div>
              {ev.grader === "none" ? <Stat label="Outputs" value={`${ev.cases.filter((c) => c.output).length} of ${ev.cases.length}`} /> : <Stat label="Passed" value={`${ev.passed} of ${ev.cases.length}`} />}
              {(() => {
                const kept = ev.cases.filter((c) => !flagged.has(c.input));
                if (kept.length === ev.cases.length) return null;
                const ok = kept.filter((c) => c.pass).length;
                return <Stat label="Without flagged" value={`${ok} of ${kept.length} (${Math.round((ok / Math.max(1, kept.length)) * 1000) / 10}%): ${ev.cases.length - kept.length} flagged as broken, left out`} />;
              })()}
              <Stat label="Cost" value={usd(ev.usd)} />
              <Stat label="Per case" value={ev.graded ? usd(ev.usd / ev.graded) : ev.grader === "none" && ev.cases.length ? usd(ev.usd / ev.cases.length) : "–"} />
              <Stat label="Grader" value={`${GRADERS.find((g) => g.value === ev.grader)?.label}${ev.mock ? " · dry run" : ""}`} />
              {ev.vars && <Stat label="Variables" value={formatVars(ev.vars)} />}
              {(ev.on_model || ev.model_map) && <Stat label="Models" value={[ev.on_model && `all on ${ev.on_model}`, ...Object.entries(ev.model_map ?? {}).map(([a, b]) => `${a} → ${b}`)].filter(Boolean).join(", ")} />}
              <Stat label="Status" value={ev.status === "queued" ? "queued: starts when the one before it ends" : record?.active ? `running · ${ev.cases.filter((c) => c.status === "done" || c.status === "error").length}/${ev.cases.length}${(() => { const s = etaSeconds(ev); return s === null ? "" : ` · about ${s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`} left`; })()}` : ev.status} />
              <div className="ml-auto flex flex-wrap justify-end gap-1.5">
                {record?.active ? (
                  <Button variant="outline" size="sm" onClick={() => void Api.stopEval(ev.id).catch((e) => setError(e.message))}>
                    <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
                  </Button>
                ) : (
                  <>
                    {(() => {
                      // a second opinion on the wrong answers, to catch a grader that marks right answers wrong
                      const n = ev.cases.filter((c) => c.status === "done" && c.pass === false && c.output).length;
                      if (!n || ev.mock || ev.grader === "llm" || ev.grader === "code") return null;
                      return (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={auditing}
                          title="Ask the LLM judge, one call per miss, whether each wrong answer in fact agrees with the expected one. Grades stay as they are; the ones it calls right show which grader rule to check"
                          onClick={() => {
                            setAuditing(true);
                            void Api.auditEval(ev.id)
                              .then((r) => setRecord({ eval: r.eval, active: false }))
                              .catch((e) => setError(e.message))
                              .finally(() => setAuditing(false));
                          }}
                        >
                          {auditing ? "Checking…" : `Check ${n} misses with the judge`}
                        </Button>
                      );
                    })()}
                    {(() => {
                      // cases that gave no answer (an error, no output, never run): run only those again
                      const n = ev.cases.filter(retryableCase).length;
                      if (!n || ev.grader === "llm") return null;
                      return (
                        <Button
                          variant="outline"
                          size="sm"
                          title="Run again only the cases that gave no answer (an error, no output, never run), with the same models and settings; the others keep their results"
                          onClick={() =>
                            void Api.retryEval(ev.id)
                              .then((r) => setRecord({ eval: r.eval, active: true }))
                              .then(refresh)
                              .catch((e) => setError(e.message))
                          }
                        >
                          Retry {n} failed
                        </Button>
                      );
                    })()}
                    {grader !== "llm" && ev.grader !== "llm" && ev.grader !== "none" && grader !== "none" && (grader === "code") === (ev.grader === "code") && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={regrading}
                        title={
                          ev.grader === "code"
                            ? "Run each stored answer against its tests again, in Docker (after a fix to the grader); no model is called"
                            : "Grade the stored outputs again with the grader chosen on the left; nothing is run again"
                        }
                        onClick={() => {
                          setRegrading(true);
                          void Api.regradeEval(ev.id, grader)
                            .then((r) => setRecord({ eval: r, active: false }))
                            .then(refresh)
                            .catch((e) => setError(e.message))
                            .finally(() => setRegrading(false));
                        }}
                      >
                        {ev.grader === "code" ? (regrading ? "Running the tests…" : "Run the tests again") : `Regrade as ${GRADERS.find((g) => g.value === grader)?.label}`}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      title={ev.invalid ? "Count this evaluation again in comparisons" : "A setup bug found after it ran? Mark it invalid with the reason: it is kept, but left out of comparisons and pooled runs by default"}
                      onClick={() => {
                        const reason = ev.invalid ? null : window.prompt("Why is this evaluation invalid? (shown wherever it is listed)");
                        if (!ev.invalid && !reason?.trim()) return;
                        void Api.markEvalInvalid(ev.id, reason)
                          .then((r) => {
                            setRecord((x) => (x ? { ...x, eval: r.eval } : x));
                            return refresh();
                          })
                          .catch((e) => setError(e.message));
                      }}
                    >
                      {ev.invalid ? "Mark valid" : "Mark invalid…"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Download this evaluation"
                      title="Every case with its output, grade and run id, as JSON"
                      onClick={() => downloadText(`${ev.id}.json`, JSON.stringify(ev, null, 2), "application/json")}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
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
            {(() => {
              const checked = ev.cases.filter((c) => c.pass === false && c.audit);
              if (!checked.length) return null;
              const right = checked.filter((c) => c.audit!.pass).length;
              return (
                <p className={cn("mt-3 text-xs", right ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                  The judge read {checked.length} wrong answers{ev.audit_usd ? ` (${usd(ev.audit_usd)})` : ""}: {right ? `it calls ${right} of them right. Check the grader on those (marked below); the grades stand until it is fixed and the evaluation regraded.` : "it agrees with the grader on every one."}
                </p>
              );
            })()}
            {ev.grader === "none" && !record?.active && <Pairwise ev={ev} onError={setError} />}
            {ev.status === "finished" && ev.grader !== "none" && <Trail id={ev.id} />}
            {!!ev.auto_retried && (
              <p className="mt-3 text-xs text-muted-foreground">
                {ev.auto_retried === 1 ? "One case" : `${ev.auto_retried} cases`} failed for the provider (overloaded, a dropped connection) and ran once more at the end; a second failure counts.
              </p>
            )}
            {ev.invalid && (
              <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200" role="note">
                Marked invalid: {ev.invalid.reason}. It is left out of comparisons and pooled runs by default.
              </p>
            )}
            {ev.stop_reason && (
              <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                {ev.stop_reason}
              </p>
            )}
            {reasons.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Why cases failed">
                <span className="text-muted-foreground">Why cases failed:</span>
                {reasons.map((r) => (
                  <button
                    key={r.reason}
                    type="button"
                    aria-pressed={onlyReason === r.reason}
                    title={onlyReason === r.reason ? "Show every case again" : "Show only these cases"}
                    onClick={() => setOnlyReason((o) => (o === r.reason ? null : r.reason))}
                    className={cn("rounded-full border px-2.5 py-0.5", onlyReason === r.reason ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-border/70 hover:bg-secondary/60")}
                  >
                    <span className="tabular-nums font-medium">{r.count}</span> × {r.reason}
                  </button>
                ))}
              </div>
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
                          <span className={cn("line-clamp-3", flagged.has(c.input) && "line-through opacity-60")}>{c.input}</span>
                          {flagged.has(c.input) && <span className="text-xs text-amber-700 dark:text-amber-300">flagged as broken: left out of scores</span>}
                          {(ev.repeats ?? 1) > 1 && q && <span className="text-xs text-muted-foreground">passed {q.passed} of {q.graded}</span>}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">repeat {(c.repeat ?? 0) + 1}</span>
                      )}
                    </td>
                    <td className="break-words py-2 pr-3 font-medium" title={first ? c.expected : undefined}>
                      {first ? <span className="line-clamp-4">{expectedLabel(c.expected)}</span> : ""}
                    </td>
                    <td className="py-2 pr-3">
                      {c.status === "pending" ? (
                        <span className="text-muted-foreground">{c.why ?? "waiting"}</span>
                      ) : c.status === "running" ? (
                        <span className="text-muted-foreground">running…</span>
                      ) : (
                        <>
                          <span className="line-clamp-2" title={c.output}>
                            {/* an ungraded output has no answer line: show how it begins */}
                            {ev.grader === "none" ? c.output?.slice(0, 300) || "(no output)" : c.answer || "(no answer)"}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {c.why}
                            {c.cut_short && <span className="text-amber-700 dark:text-amber-300" title="The run was stopped at a limit (rounds, time, budget) before its conversation ended; its answer is the conversation's last message">{" · "}cut short at a limit</span>}
                            {c.pass === false && c.audit?.pass && <span className="text-amber-700 dark:text-amber-300" title={`The judge: ${c.audit.why}`}>{" · "}judge says right</span>}
                            {!!c.reached?.length && <span className="text-amber-700 dark:text-amber-300" title="A member marked the right answer in a message during the run; the team's final answer lost it">{" · "}had it: {c.reached.join(", ")}</span>}
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
