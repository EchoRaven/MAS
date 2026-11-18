// The rounds of each group that repeats: when a round ran, its model calls
// and cost, why the group went on or stopped, and the value the round ended
// with (what was fed back, or what left the group).
import { useState } from "react";
import { cn } from "@/lib/utils";
import { usd } from "@/lib/format";
import type { GroupRounds, Round } from "@/run/rounds";

const OUTCOME: Record<Round["outcome"], { label: string; cls: string }> = {
  next: { label: "again", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  done: { label: "stopped", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  running: { label: "running", cls: "bg-info/15 text-info" },
};
// stopped at the round limit although a condition was set: it never held
const GAVE_UP = { label: "gave up", cls: "bg-destructive/15 text-destructive" };

/** The engine's verdict, in words: why the group went on, or why it stopped. */
function why(r: Round, g: GroupRounds): string {
  const v = r.verdict ?? "";
  if (r.outcome === "running") return "in progress";
  if (/holds/.test(v)) return "the condition holds";
  if (/until failed/.test(v)) return v.replace(/^until failed: /, "the condition could not be checked: ");
  if (/not yet/.test(v)) return "the condition does not hold yet";
  if (r.outcome === "done") return g.until ? `round limit (${g.max_rounds}) reached` : `${g.max_rounds} rounds, as set`;
  return "next round";
}

export function RoundsTable({ groups, nameOf }: { groups: GroupRounds[]; nameOf: (id: string) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const entries = new Set(g.rounds.map((r) => r.entry)).size;
        return (
          <section key={g.group} aria-label={`Rounds of ${nameOf(g.group)}`}>
            <h3 className="text-xs font-semibold">{nameOf(g.group)}</h3>
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              up to {g.max_rounds} round{g.max_rounds > 1 ? "s" : ""}
              {g.until ? (
                <>
                  , until <code className="rounded bg-secondary px-1">{g.until}</code>
                </>
              ) : (
                ", always all of them"
              )}
              {entries > 1 ? ` · entered ${entries} times` : ""}
            </p>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="w-12 py-1 font-medium">Round</th>
                  <th className="py-1 font-medium">Then</th>
                  <th className="w-12 py-1 pl-2 text-right font-medium">Calls</th>
                  <th className="w-16 py-1 pl-2 text-right font-medium">USD</th>
                  <th className="py-1 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {g.rounds.map((r) => {
                  const key = `${g.group}:${r.entry}:${r.n}`;
                  const o = r.outcome === "done" && g.until && !/holds/.test(r.verdict ?? "") ? GAVE_UP : OUTCOME[r.outcome];
                  return (
                    <tr key={key} className="border-t border-border/70 align-top">
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {entries > 1 && <span className="text-muted-foreground">{r.entry}.</span>}
                        {r.n}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className={cn("mr-1.5 rounded-full px-1.5 py-px text-[10.5px] font-medium", o.cls)}>{o.label}</span>
                        <span className="text-muted-foreground">{why(r, g)}</span>
                        {r.result && (
                          <button type="button" className="mt-1 block w-full text-left" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key} title="The value this round ended with">
                            <span className={cn("block whitespace-pre-wrap break-words rounded bg-secondary/50 px-1.5 py-1 text-[11px] text-foreground/80", open !== key && "line-clamp-2")}>{r.result}</span>
                          </button>
                        )}
                      </td>
                      <td className="py-1.5 pl-2 text-right">{r.calls}</td>
                      <td className="py-1.5 pl-2 text-right">{usd(r.usd)}</td>
                      <td className="py-1.5 pl-2 text-right whitespace-nowrap text-muted-foreground">{r.end !== null ? `${(r.end - r.start).toFixed(1)}s` : "…"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
