// Read-only: how judges of the same pairs agree. For every pair judged by the reference judge (the latest
// judgement by it), each other judge of that pair is compared question by question: how often its verdict (a, b or
// tie) is the reference's, and how often its own two readings (a first, b first) agree. Without human labels, a
// stronger model's verdicts stand in for the truth; that is the caveat.
// Run from the repository root: npx --no-install tsx scripts/judge-agreement.mts [reference judge, default gemini]
import fs from "node:fs";
import path from "node:path";
import type { PairwiseResult } from "../src/run/evals";

const ref = process.argv[2] ?? "gemini";
const dir = path.join(".data", "state", "_pairwise");
const all = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as PairwiseResult);
// the latest judgement of each pair by each judge
const latest = new Map<string, PairwiseResult>();
for (const p of all.sort((x, y) => x.at.localeCompare(y.at))) latest.set(`${p.a}|${p.b}|${p.judge}`, p);

const tally = new Map<string, { n: number; agree: number; consistent: number; read: number; unread: number; usd: number }>();
for (const p of latest.values()) {
  if (p.judge === ref) continue;
  const r = latest.get(`${p.a}|${p.b}|${ref}`);
  if (!r) continue;
  const t = tally.get(p.judge) ?? { n: 0, agree: 0, consistent: 0, read: 0, unread: 0, usd: 0 };
  const verdict = new Map(r.per.map((x) => [x.input, x.verdict]));
  for (const x of p.per) {
    if (!verdict.has(x.input)) continue;
    t.n++;
    if (x.verdict === verdict.get(x.input)) t.agree++;
    if (x.first === "unread" || x.second === "unread") t.unread++;
    else {
      t.read++;
      if (x.first === x.second) t.consistent++;
    }
  }
  t.usd += p.usd;
  tally.set(p.judge, t);
}
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");
console.log(`reference: ${ref}`);
for (const [judge, t] of [...tally.entries()].sort((a, b) => b[1].n - a[1].n))
  console.log(`${judge}: ${t.n} questions; agrees with the reference ${pct(t.agree, t.n)}; its two orders agree ${pct(t.consistent, t.read)}; no verdict ${t.unread}; $${t.usd.toFixed(3)}`);
