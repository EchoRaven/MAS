// Pairwise judging for evaluations that grade nothing (open-ended tasks: a story, an article). An evaluation is
// judged against another of the same questions: a model reads both outputs, in both orders, and a win needs both
// orders to agree. The judgements are kept with the evaluations and listed here.
import { useEffect, useState } from "react";
import { Api, type EvalSummary } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { usd } from "@/lib/format";
import { DEFAULT_MODELS } from "@/model/defaults";
import type { EvalRecord, PairwiseResult } from "@/run/evals";

export function Pairwise({ ev, onError }: { ev: EvalRecord; onError: (m: string) => void }) {
  const [others, setOthers] = useState<EvalSummary[]>([]);
  const [other, setOther] = useState("");
  const [judge, setJudge] = useState(ev.on_model ?? "");
  const [kept, setKept] = useState<PairwiseResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([Api.evals(), Api.pairwiseOf(ev.id)])
      .then(([r, p]) => {
        if (!live) return;
        const mine = r.evals.find((e) => e.id === ev.id);
        const same = r.evals.filter((e) => e.id !== ev.id && e.grader === "none" && e.status !== "running" && (!mine || e.set === mine.set));
        setOthers(same);
        setOther((o) => o || same[0]?.id || "");
        setKept(p.pairwise);
      })
      .catch((e) => onError(e.message));
    return () => {
      live = false;
    };
  }, [ev.id, onError]);

  const run = () => {
    setBusy(true);
    Api.pairwise(ev.id, other, judge || undefined)
      .then((r) => setKept((k) => [r.pairwise, ...k.filter((x) => !(x.a === r.pairwise.a && x.b === r.pairwise.b))]))
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <section className="mt-4 rounded-lg border border-border/60 p-3">
      <h3 className="text-sm font-medium">Pairwise</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Nothing is graded here. Judge these outputs against another evaluation of the same questions: a model reads both, in both orders, and a win needs both orders to agree (anything else is a tie). Two calls per question.
      </p>
      {others.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={other} onValueChange={setOther} items={others.map((e) => ({ value: e.id, label: `${e.system_name} · ${new Date(e.started_at).toLocaleString()}` }))} ariaLabel="Other evaluation" />
          <Select value={judge} onValueChange={setJudge} items={[{ value: "", label: "Judge: this evaluation's model" }, ...DEFAULT_MODELS.map((m) => ({ value: m.id, label: `Judge: ${m.id}` }))]} ariaLabel="Judge" />
          <Button size="sm" variant="outline" disabled={busy || !other} onClick={run}>
            {busy ? "Judging…" : "Judge pairwise"}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No other ungraded evaluation of these questions yet: evaluate a second system on them with the grader None.</p>
      )}
      {kept.map((p) => {
        const mineA = p.a === ev.id;
        const [w, l] = mineA ? [p.a_wins, p.b_wins] : [p.b_wins, p.a_wins];
        const them = mineA ? p.b_name : p.a_name;
        const key = `${p.a}__${p.b}`;
        const split = p.per.filter((x) => x.first !== x.second).length;
        const unread = p.per.filter((x) => x.first === "unread" || x.second === "unread").length;
        return (
          <div key={key} className="mt-3 text-xs">
            <p>
              <span className="font-medium tabular-nums">
                {w} wins, {l} losses, {p.ties} ties
              </span>{" "}
              against {them} · judge {p.judge} · {usd(p.usd)}
              {split ? ` · the two orders disagreed on ${split} of ${p.per.length}, counted as ties` : ""}
              {unread ? ` · the judge gave no verdict on ${unread}` : ""}{" "}
              <button className="underline" onClick={() => setOpen(open === key ? null : key)}>
                {open === key ? "hide" : "per question"}
              </button>
            </p>
            {open === key && (
              <ul className="mt-1 space-y-0.5">
                {p.per.map((x, i) => {
                  const v = x.verdict === "tie" ? "tie" : (x.verdict === "a") === mineA ? "win" : "loss";
                  return (
                    <li key={i} className="flex gap-2" title={x.why ? `First order:\n${x.why[0]}\n\nSecond order:\n${x.why[1]}` : undefined}>
                      <span className="w-8 shrink-0 font-medium">{v}</span>
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
