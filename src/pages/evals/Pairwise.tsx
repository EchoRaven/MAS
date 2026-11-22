// Pairwise judging for evaluations that grade nothing (open-ended tasks: a story, an article). An evaluation is
// judged against another of the same questions: a model reads both outputs, in both orders, and a win needs both
// orders to agree. The judgements are kept with the evaluations and listed here.
import { useEffect, useState } from "react";
import { Api, type EvalSummary, type PairwiseJob } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { usd } from "@/lib/format";
import { DEFAULT_MODELS } from "@/model/defaults";
import { criterionTag, type EvalRecord, firstPicks, mcnemarP, type PairwiseResult } from "@/run/evals";
import { useSystems } from "@/store/systems";

/** An exact sign test's p over the decided questions, as Compare shows McNemar's. */
const fmtP = (p: number) => (p < 0.001 ? "< 0.001" : p < 0.1 ? p.toFixed(3) : p.toFixed(2));

export function Pairwise({ ev, onError }: { ev: EvalRecord; onError: (m: string) => void }) {
  const [others, setOthers] = useState<EvalSummary[]>([]);
  const [other, setOther] = useState("");
  const [judge, setJudge] = useState(ev.on_model ?? "");
  // a system can judge instead of one model call (a referee panel such as ChatEval), run on the judge model
  const [panel, setPanel] = useState("");
  // score each output alone instead of side by side: no order to sway the judge
  const [alone, setAlone] = useState(false);
  const systems = useSystems((s) => s.systems);
  const [kept, setKept] = useState<PairwiseResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<PairwiseJob[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [links, setLinks] = useState<{ cited: number; found: number; searches: number; outputs: number; with_search: number; words: number; headings: number; items: number; tables: number } | null>(null);

  useEffect(() => {
    let live = true;
    Api.evalSources(ev.id)
      .then((r) => live && setLinks(r.sources))
      .catch(() => undefined);
    Promise.all([Api.evals(), Api.pairwiseOf(ev.id)])
      .then(([r, p]) => {
        if (!live) return;
        const mine = r.evals.find((e) => e.id === ev.id);
        const same = r.evals.filter((e) => e.id !== ev.id && e.grader === "none" && e.status !== "running" && (!mine || e.set === mine.set));
        setOthers(same);
        setOther((o) => o || same[0]?.id || "");
        setKept(p.pairwise);
        setJobs(p.judging ?? []);
      })
      .catch((e) => onError(e.message));
    return () => {
      live = false;
    };
  }, [ev.id, onError]);

  // judgements run in the background (a judging system can take half an hour): poll while any is in progress
  const running = jobs.some((j) => !j.error);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      Api.pairwiseOf(ev.id)
        .then((p) => {
          setKept(p.pairwise);
          setJobs(p.judging ?? []);
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(t);
  }, [running, ev.id]);

  const run = () => {
    setBusy(true);
    Api.startPairwise(ev.id, other, judge || undefined, undefined, panel || undefined, alone)
      .then(() => Api.pairwiseOf(ev.id))
      .then((p) => {
        setKept(p.pairwise);
        setJobs(p.judging ?? []);
      })
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <section className="mt-4 rounded-lg border border-border/60 p-3">
      <h3 className="text-sm font-medium">Pairwise</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Nothing is graded here. Judge these outputs against another evaluation of the same questions: a model (or a judging system, such as ChatEval's referee panel) reads both, in both orders, and a win needs both orders to agree (anything else is a tie). Two judgements per question.
      </p>
      {links && links.outputs > 0 && (
        <p className="mt-2 text-xs" title="A judge rewards length and structure: compare these with the other side's before reading a win as a better answer">
          Shape: {Math.round(links.words / links.outputs)} words, {(links.headings / links.outputs).toFixed(1)} headings and {(links.items / links.outputs).toFixed(1)} list items per output
          {links.tables ? `, ${links.tables} with a table` : ""}
        </p>
      )}
      {links && links.outputs > 0 && (links.cited > 0 || links.searches > 0) && (
        <p className="mt-2 text-xs" title="Links the outputs cite, checked against what each run's own web_search and fetch calls returned. A link no search returned was written from memory or made up; a judge model cannot tell">
          Links: {(links.cited / links.outputs).toFixed(1)} per output
          {links.cited ? `, ${Math.round((100 * links.found) / links.cited)}% of them returned by the run's own searches` : ""}
          {links.with_search < links.outputs ? ` · ${links.outputs - links.with_search} of ${links.outputs} runs searched nothing` : ""}
        </p>
      )}
      {others.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={other} onValueChange={setOther} items={others.map((e) => ({ value: e.id, label: `${e.system_name} · ${new Date(e.started_at).toLocaleString()}` }))} ariaLabel="Other evaluation" />
          <Select value={judge} onValueChange={setJudge} items={[{ value: "", label: "Judge: this evaluation's model" }, ...DEFAULT_MODELS.map((m) => ({ value: m.id, label: `Judge: ${m.id}` }))]} ariaLabel="Judge" />
          <Select
            value={panel}
            onValueChange={setPanel}
            items={[{ value: "", label: "One judge call" }, ...systems.filter((s) => s.id !== ev.system_id).map((s) => ({ value: s.id, label: `Panel: ${s.name}` }))]}
            ariaLabel="Judging system"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="The judge reads each output on its own and scores it 1 to 10; the higher score wins. With no order to favour, a judge that picks whichever response it read first can still tell outputs apart">
            <input type="checkbox" checked={alone} onChange={(e) => setAlone(e.target.checked)} /> Score each alone
          </label>
          <Button size="sm" variant="outline" disabled={busy || !other} onClick={run} title={panel ? "The chosen system judges each pair, run on the judge model; its output must end with a line 'Better: 1', 'Better: 2' or 'Better: tie'. Several model calls per question" : "One call per question and order"}>
            {busy ? "Starting…" : "Judge pairwise"}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No other ungraded evaluation of these questions yet: evaluate a second system on them with the grader None.</p>
      )}
      {jobs.map((j) => (
        <p key={`${j.a}|${j.b}|${j.judge}`} className={`mt-3 text-xs ${j.error ? "text-destructive" : "text-muted-foreground"}`}>
          {j.error ? `Judging by ${j.judge} failed: ${j.error}` : `Judging by ${j.judge}: ${j.done} of ${j.total} questions (both orders each)…`}
        </p>
      ))}
      {kept.map((p) => {
        const mineA = p.a === ev.id;
        const [w, l] = mineA ? [p.a_wins, p.b_wins] : [p.b_wins, p.a_wins];
        const them = mineA ? p.b_name : p.a_name;
        const key = `${p.a}__${p.b}__${p.judge}__${criterionTag(p.criterion)}`;
        const split = p.per.filter((x) => x.first !== x.second).length;
        const unread = p.per.filter((x) => x.first === "unread" || x.second === "unread").length;
        const pos = firstPicks(p.per, p.mode);
        return (
          <div key={key} className="mt-3 text-xs">
            <p>
              <span className="font-medium tabular-nums">
                {w} wins, {l} losses, {p.ties} ties
              </span>{" "}
              against {them} · judge {p.judge}
              {w + l ? ` · p ${fmtP(mcnemarP(w, l))}` : ""} · {usd(p.usd)}
              {split ? ` · the two orders disagreed on ${split} of ${p.per.length}, counted as ties` : ""}
              {unread ? ` · the judge gave no verdict on ${unread}` : ""}
              {pos.picked ? ` · it picked the response shown first in ${pos.first} of ${pos.picked} readings` : ""}{" "}
              <button className="underline" onClick={() => setOpen(open === key ? null : key)}>
                {open === key ? "hide" : "per question"}
              </button>
            </p>
            {open === key && (
              <ul className="mt-1 space-y-0.5">
                {p.per.map((x, i) => {
                  const v = x.verdict === "tie" ? "tie" : (x.verdict === "a") === mineA ? "win" : "loss";
                  const sc = x.scores ? (mineA ? x.scores : [x.scores[1], x.scores[0]]) : null;
                  return (
                    <li key={i} className="flex gap-2" title={x.why ? `First order:\n${x.why[0]}\n\nSecond order:\n${x.why[1]}` : undefined}>
                      <span className="w-8 shrink-0 font-medium">{v}</span>
                      {sc && <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{sc[0] ?? "?"}–{sc[1] ?? "?"}</span>}
                      <span className="line-clamp-1 text-muted-foreground">{x.input}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
