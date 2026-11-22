// How an evaluation's answers moved, for systems that revise and log each step's answer ("answers by round: 12 → 12 →
// 15": intrinsic self-correction, CRITIC). Every step is graded by the evaluation's own grader, so the counts read
// answers as the score does: whether revising fixed answers or broke them.
import { useEffect, useState } from "react";
import { Api } from "@/api/client";
import { mcnemarP, type TrailStats } from "@/run/evals";

export function Trail({ id }: { id: string }) {
  const [t, setT] = useState<TrailStats | null>(null);
  useEffect(() => {
    let live = true;
    Api.evalTrail(id)
      .then((r) => live && setT(r.trail))
      .catch(() => live && setT(null));
    return () => {
      live = false;
    };
  }, [id]);
  if (!t) return null;
  const changed = t.right_to_wrong + t.wrong_to_right;
  const p = changed ? mcnemarP(t.wrong_to_right, t.right_to_wrong) : null;
  const worse = t.right_to_wrong > t.wrong_to_right;
  return (
    <section className="mt-4 rounded-lg border border-border/60 p-3 text-xs" aria-label="Answers by step">
      <h3 className="text-sm font-medium">Answers by {t.label}</h3>
      <p className="mt-1 text-muted-foreground">
        The system logged each {t.label}'s answer; each is graded here as the score is. Revising helps only if it turns more wrong answers right than right ones wrong.
      </p>
      <p className="mt-2">
        <span className="font-medium tabular-nums">
          {t.first} → {t.last}
        </span>{" "}
        right of {t.cases}, first answer to last ·{" "}
        <span className={worse ? "text-amber-700 dark:text-amber-300" : undefined}>
          {t.wrong_to_right} wrong → right, {t.right_to_wrong} right → wrong
        </span>
        {p != null ? ` · p ${p < 0.001 ? "< 0.001" : p.toFixed(p < 0.1 ? 3 : 2)}` : ""} · {t.unchanged} never changed · {t.mean_steps.toFixed(1)} {t.label}s on average
      </p>
      {t.by_step.length > 1 && (
        <p className="mt-1 tabular-nums text-muted-foreground">
          Right by {t.label}: {t.by_step.map((s) => (s.cases === t.cases ? `${s.right}` : `${s.right}/${s.cases}`)).join(" → ")}
        </p>
      )}
    </section>
  );
}
