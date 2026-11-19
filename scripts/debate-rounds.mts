// Read-only: does debate add anything over a vote on its own first round? (Choi et al. 2025, "Debate or Vote")
// Run from the repository root: npx --no-install tsx scripts/debate-rounds.mts (reads .data, writes nothing).
import fs from "node:fs";
import { finalAnswer, gradeByRule, type Grader } from "../src/run/evals";
const D = ".data";
const norm = (a: string) => a.toLowerCase().replace(/<\/?answer>/g, "").replace(/\*+/g, "").replace(/(\d),(?=\d{3})/g, "$1").replace(/\\text\{[^}]*\}/g, "").replace(/[^a-z0-9./\\{}^-]+/g, " ").trim();
for (const f of fs.readdirSync(`${D}/evals`)) {
  const e = JSON.parse(fs.readFileSync(`${D}/evals/${f}`, "utf8"));
  if (e.mock || !/^Multiagent debate/.test(e.system_name) || !["number", "math", "answer"].includes(e.grader) || e.status !== "finished") continue;
  const g = e.grader as Grader;
  let n = 0, v1 = 0, fin = 0, up = 0, down = 0;
  const acc: number[][] = [];
  for (const c of e.cases) {
    if (c.pass === undefined || !c.run_id || !fs.existsSync(`${D}/runs/${c.run_id}/events.jsonl`)) continue;
    const sys = JSON.parse(fs.readFileSync(`${D}/runs/${c.run_id}/system.json`, "utf8"));
    const debaters = sys.nodes.filter((x: any) => x.data.kind === "agent" || x.data.kind === "model").map((x: any) => x.id);
    const by = new Map<string, string[]>();
    for (const l of fs.readFileSync(`${D}/runs/${c.run_id}/events.jsonl`, "utf8").split("\n").filter(Boolean)) {
      const x = JSON.parse(l);
      if (x.type === "message" && debaters.includes(x.from)) by.set(x.from, [...(by.get(x.from) ?? []), x.text]);
    }
    if (by.size < 2) continue;
    const rounds = Math.max(...[...by.values()].map((v) => v.length));
    const ok = (t: string) => gradeByRule(g, t, c.expected, c.input).pass;
    for (let r = 0; r < rounds; r++) {
      const ts = [...by.values()].map((v) => v[r]).filter(Boolean);
      (acc[r] ??= []).push(ts.filter(ok).length / ts.length);
    }
    // the vote over the first round: the most common final answer (first given wins a tie)
    const first = [...by.values()].map((v) => v[0]);
    const counts = new Map<string, { n: number; t: string }>();
    for (const t of first) { const k = norm(finalAnswer(t)); const o = counts.get(k); counts.set(k, { n: (o?.n ?? 0) + 1, t: o?.t ?? t }); }
    const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    const vote = ok(top.t);
    n++; v1 += +vote; fin += +!!c.pass;
    if (!vote && c.pass) up++;
    if (vote && !c.pass) down++;
  }
  if (!n) continue;
  const mean = (a: number[]) => (a.reduce((s, x) => s + x, 0) / a.length * 100).toFixed(0) + "%";
  console.log(`${e.id} ${e.system_name} | ${e.on_model ?? JSON.stringify(e.model_map ?? {})} | ${e.dataset?.name ?? e.set_name ?? ""} | vars ${JSON.stringify(e.vars ?? {})}\n   cases ${n}: round-1 vote ${v1}, debate final ${fin}; debate turned a wrong vote right ${up}, a right one wrong ${down}; debater accuracy by round ${acc.map(mean).join(" → ")}`);
}
