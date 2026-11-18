// The rounds of iterating groups, folded from a run's events: when each round
// ran, what it cost, the value it ended with, and why the group went on or
// stopped. Sixteen of the 26 paper templates are a group that repeats (debate
// rounds, consensus loops, test-and-fix loops), and these are the hardest part
// of a run to read from the message log alone.
import type { SystemDoc } from "@/model/types";
import type { RunEvent } from "./events";

export interface Round {
  /** which time the group was entered (Voyager enters its attempt loop once per task); rounds restart at 1 each time */
  entry: number;
  n: number;
  start: number;
  end: number | null;
  calls: number;
  usd: number;
  /** the last value a member sent to the group's output in this round: what was fed back, or what left */
  result: string | null;
  /** why the group went on after this round, or stopped: the engine's own words */
  verdict: string | null;
  /** went on to another round, stopped (the condition held or the limit was reached), or still running */
  outcome: "next" | "done" | "running";
}

export interface GroupRounds {
  group: string;
  max_rounds: number;
  until: string | null;
  rounds: Round[];
}

/** Every component inside a group, at any depth. */
function membersOf(doc: SystemDoc, g: string): Set<string> {
  const out = new Set<string>();
  let frontier = [g];
  while (frontier.length) {
    const next: string[] = [];
    for (const n of doc.nodes) if (n.parent && frontier.includes(n.parent) && !out.has(n.id)) (out.add(n.id), next.push(n.id));
    frontier = next;
  }
  return out;
}

export function roundsOf(events: RunEvent[], doc: SystemDoc): GroupRounds[] {
  const groups = doc.nodes.filter((n) => n.data.kind === "group" && n.data.iterate);
  return groups
    .map((g) => {
      const it = (g.data as { iterate: { max_rounds: number; until?: string } }).iterate;
      const members = membersOf(doc, g.id);
      const rounds: Round[] = [];
      let cur: Round | null = null;
      let entry = 0;
      const open = (n: number, t: number) => {
        cur = { entry, n, start: t, end: null, calls: 0, usd: 0, result: null, verdict: null, outcome: "running" };
        rounds.push(cur);
      };
      for (const e of events) {
        if (e.type === "message" && e.to === g.id) {
          // into the group from outside starts it; from a member, it is the round's value
          if (members.has(e.from)) {
            if (cur) (cur as Round).result = e.text;
          } else if (!cur || (cur as Round).outcome === "done") {
            entry++;
            open(1, e.t);
          }
        } else if (e.type === "transform" && e.at === g.id) {
          const m = /^round (\d+) of/.exec(e.label);
          if (m && cur) {
            Object.assign(cur as Round, { end: e.t, verdict: e.detail, outcome: "next" });
            open(Number(m[1]), e.t);
          } else if (e.label === "rounds done" && cur) {
            Object.assign(cur as Round, { end: e.t, verdict: e.detail, outcome: "done" });
          }
        } else if (e.type === "usage" && cur && members.has(e.node)) {
          (cur as Round).calls++;
          (cur as Round).usd += e.usd;
        }
      }
      return { group: g.id, max_rounds: it.max_rounds, until: it.until || null, rounds };
    })
    .filter((g) => g.rounds.length > 0);
}
