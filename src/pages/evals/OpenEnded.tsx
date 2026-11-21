// Open-ended question sets on the Compare page: evaluations that grade nothing (stories, articles) have no
// accuracy, so they are compared by the pairwise judgements made between them, set by set, with the share of
// each one's links that its own searches returned.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Api, type EvalSummary } from "@/api/client";
import type { PairwiseResult } from "@/run/evals";

type Sources = { cited: number; found: number; outputs: number };

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
        for (const p of [...seen.values()].sort((x, y) => x.at.localeCompare(y.at))) latest.set(`${p.a}|${p.b}|${p.judge}`, p);
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
  const linkShare = (id: string) => {
    const s = sources[id];
    return s && s.cited ? `${Math.round((100 * s.found) / s.cited)}% of ${(s.cited / Math.max(1, s.outputs)).toFixed(1)} links` : "";
  };

  return (
    <section className="glass-panel overflow-x-auto rounded-xl p-4" aria-label="Open-ended sets">
      <h2 className="text-sm font-medium">Open-ended sets, judged pairwise</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Evaluations that grade nothing (stories, articles) have no accuracy. Here are the pairwise judgements made between them: a judge read both outputs for each question in both orders, and a win needs both orders to agree. Links: the share of each side's cited links that its own runs' searches returned.
      </p>
      {sets.map((s) => (
        <div key={s.set} className="mt-3">
          <h3 className="text-xs font-medium">{s.name}</h3>
          <table className="mt-1 w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3 font-normal">A</th>
                <th className="py-1 pr-3 font-normal">B</th>
                <th className="py-1 pr-3 font-normal">Judge</th>
                <th className="py-1 pr-3 font-normal">A wins · B wins · ties</th>
                <th className="py-1 pr-3 font-normal">Links A / B</th>
              </tr>
            </thead>
            <tbody>
              {s.judged.map((p) => {
                const unread = p.per.filter((x) => x.first === "unread" || x.second === "unread").length;
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
                    <td className="py-1 pr-3">{p.judge}</td>
                    <td className="py-1 pr-3 tabular-nums">
                      <span className="font-medium">
                        {p.a_wins} · {p.b_wins} · {p.ties}
                      </span>
                      {unread ? <span className="block text-[11px] text-amber-700 dark:text-amber-300">no verdict on {unread}: not to be trusted</span> : null}
                      {invalid ? <span className="block text-[11px] text-muted-foreground">invalid: {invalid.reason}</span> : null}
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
