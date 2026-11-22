// Open-ended question sets on the Compare page: evaluations that grade nothing (stories, articles) have no
// accuracy, so they are compared by the pairwise judgements made between them, set by set, with the share of
// each one's links that its own searches returned.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Api, type EvalSummary } from "@/api/client";
import { criterionTag, firstPicks, mcnemarP, type PairwiseResult, poolJudgements } from "@/run/evals";

type Sources = { cited: number; found: number; outputs: number; words: number; headings: number; items: number; tables: number };

export function OpenEnded() {
  const [sets, setSets] = useState<{ set: string; name: string; evals: EvalSummary[]; judged: PairwiseResult[] }[] | null>(null);
  const [sources, setSources] = useState<Record<string, Sources>>({});

  useEffect(() => {
    let live = true;
    (async () => {
      const ungraded = (await Api.evals()).evals.filter((e) => e.grader === "none" && e.status === "finished");
      const by = new Map<string, EvalSummary[]>();
      for (const e of ungraded) by.set(e.set, [...(by.get(e.set) ?? []), e]);
      const out = [];
      for (const [set, evals] of by) {
        const seen = new Map<string, PairwiseResult>();
        for (const e of evals) for (const p of (await Api.pairwiseOf(e.id)).pairwise) seen.set(`${p.a}|${p.b}|${p.judge}|${p.at}`, p);
        // the latest judgement of each pair by each judge
        const latest = new Map<string, PairwiseResult>();
        for (const p of [...seen.values()].sort((x, y) => x.at.localeCompare(y.at))) latest.set(`${p.a}|${p.b}|${p.judge}|${criterionTag(p.criterion)}`, p);
        const bad = (p: PairwiseResult) => +!!(evals.find((e) => e.id === p.a)?.invalid || evals.find((e) => e.id === p.b)?.invalid);
        out.push({ set, name: evals[0].set_name ?? evals[0].first_question.slice(0, 60), evals, judged: [...latest.values()].sort((x, y) => bad(x) - bad(y)) });
      }
      if (!live) return;
      setSets(out.filter((s) => s.judged.length));
      const src: Record<string, Sources> = {};
      for (const e of ungraded) src[e.id] = (await Api.evalSources(e.id)).sources;
      if (live) setSources(src);
    })().catch(() => live && setSets([]));
    return () => {
      live = false;
    };
  }, []);

  if (!sets?.length) return null;
  const when = (id: string, evals: EvalSummary[]) => {
    const e = evals.find((x) => x.id === id);
    return e ? new Date(e.started_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  };
  const shape = (id: string) => {
    const s = sources[id];
    return s && s.outputs ? `${Math.round(s.words / s.outputs)} w · ${(s.headings / s.outputs).toFixed(1)} h · ${(s.items / s.outputs).toFixed(1)} li` : "";
  };
  const linkShare = (id: string) => {
    const s = sources[id];
    return s && s.cited ? `${Math.round((100 * s.found) / s.cited)}% of ${(s.cited / Math.max(1, s.outputs)).toFixed(1)} links` : "";
  };

  return (
    <section className="glass-panel overflow-x-auto rounded-xl p-4" aria-label="Open-ended sets">
      <h2 className="text-sm font-medium">Open-ended sets, judged pairwise</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Evaluations that grade nothing (stories, articles) have no accuracy. Here are the pairwise judgements made between them: a judge read both outputs for each question in both orders, and a win needs both orders to agree. Shape: each side's mean words, headings and list items, since a judge rewards length and structure. Links: the share of each side's cited links that its own runs' searches returned.
      </p>
      {sets.map((s) => (
        <div key={s.set} className="mt-3">
          <h3 className="text-xs font-medium">{s.name}</h3>
          <Pooled set={s} />
          <table className="mt-1 w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3 font-normal">A</th>
                <th className="py-1 pr-3 font-normal">B</th>
                <th className="py-1 pr-3 font-normal">Judge</th>
                <th className="py-1 pr-3 font-normal">A wins · B wins · ties</th>
                <th className="py-1 pr-3 font-normal" title="Mean words, headings and list items per output: a judge rewards length and structure">Shape A / B</th>
                <th className="py-1 pr-3 font-normal">Links A / B</th>
              </tr>
            </thead>
            <tbody>
              {s.judged.map((p) => {
                const unread = p.per.filter((x) => x.first === "unread" || x.second === "unread").length;
                const pos = firstPicks(p.per, p.mode);
                const biased = pos.picked >= 6 && pos.first / pos.picked >= 0.8;
                const invalid = [p.a, p.b].map((id) => s.evals.find((e) => e.id === id)?.invalid).find(Boolean);
                return (
                  <tr key={`${p.a}|${p.b}|${p.judge}`} className={`border-t border-border/50 ${invalid ? "opacity-50" : ""}`} title={invalid ? `Invalid: ${invalid.reason}` : undefined}>
                    <td className="py-1 pr-3">
                      <Link to={`/evals/${s.evals.find((e) => e.id === p.a)?.system_id ?? ""}`} className="hover:underline">{p.a_name}</Link>
                      <span className="block text-[11px] text-muted-foreground">{when(p.a, s.evals)}</span>
                    </td>
                    <td className="py-1 pr-3">
                      <Link to={`/evals/${s.evals.find((e) => e.id === p.b)?.system_id ?? ""}`} className="hover:underline">{p.b_name}</Link>
                      <span className="block text-[11px] text-muted-foreground">{when(p.b, s.evals)}</span>
                    </td>
                    <td className="py-1 pr-3" title={criterionTag(p.criterion) ? `Its own criterion: ${p.criterion}` : undefined}>
                      {p.judge}
                      {criterionTag(p.criterion) ? <span className="block text-[11px] text-muted-foreground">own criterion</span> : null}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">
                      <span className="font-medium">
                        {p.a_wins} · {p.b_wins} · {p.ties}
                      </span>
                      {p.a_wins + p.b_wins ? (
                        <span className="ml-1 text-[11px] text-muted-foreground" title="Exact sign test over the questions one side won (ties left out): the chance of a split at least this uneven if neither side were better">
                          p {(() => {
                            const v = mcnemarP(p.a_wins, p.b_wins);
                            return v < 0.001 ? "< 0.001" : v < 0.1 ? v.toFixed(3) : v.toFixed(2);
                          })()}
                        </span>
                      ) : null}
                      {unread ? <span className="block text-[11px] text-amber-700 dark:text-amber-300">no verdict on {unread}: not to be trusted</span> : null}
                      {pos.picked ? (
                        <span className={`block text-[11px] ${biased ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`} title="How often the judge picked whichever response it was shown first. Near half: no position bias. Near all: the order decided, and most verdicts are ties">
                          shown first won {pos.first} of {pos.picked}
                        </span>
                      ) : null}
                      {invalid ? <span className="block text-[11px] text-muted-foreground">invalid: {invalid.reason}</span> : null}
                    </td>
                    <td className="py-1 pr-3 text-[11px] text-muted-foreground">
                      <span className="block whitespace-nowrap">{shape(p.a) || "–"}</span>
                      <span className="block whitespace-nowrap">{shape(p.b) || "–"}</span>
                    </td>
                    <td className="py-1 pr-3 text-[11px] text-muted-foreground">
                      {linkShare(p.a) || "–"} / {linkShare(p.b) || "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

/**
 * The judgements of a set pooled by setup: every valid judgement of system A against system B by the same judge
 * (runs judged separately add up), with the totals and an exact sign test over them. Invalid evaluations are left out.
 */
function Pooled({ set }: { set: { evals: EvalSummary[]; judged: PairwiseResult[] } }) {
  const rows = poolJudgements(set.evals, set.judged).filter((g) => g.n > 1);
  if (!rows.length) return null;
  const fmt = (v: number) => (v < 0.001 ? "< 0.001" : v < 0.1 ? v.toFixed(3) : v.toFixed(2));
  return (
    <div className="mt-1 rounded-md bg-secondary/40 px-2 py-1.5 text-[11px]" title="Judgements of the same two systems by the same judge, added up across runs (invalid evaluations and judgements with missing verdicts left out)">
      <span className="font-medium">Pooled across runs: </span>
      {rows.map((g, i) => (
        <span key={i} className="mr-3 inline-block">
          {g.a} vs {g.b} ({g.judge}, {g.n} judgements): {g.w}–{g.l}, {g.t} ties{g.w + g.l ? `, p ${fmt(mcnemarP(g.w, g.l))}` : ""}
        </span>
      ))}
    </div>
  );
}
