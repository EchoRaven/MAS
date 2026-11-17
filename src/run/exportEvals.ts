// Evaluation results as text to take elsewhere: a Markdown table for a
// write-up, and a CSV of which system got each question right.
import { type EvalRecord, repeatStats } from "./evals";

export interface ExportRow {
  label: string;
  setup: string;
  rec: EvalRecord;
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const money = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const cellText = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** One row per evaluation, as it reads on the Compare page. */
export function markdownTable(rows: ExportRow[]): string {
  const head = "| System | Models · variables | Accuracy | Per repeat | Cost | Per correct answer |\n| --- | --- | --- | --- | --- | --- |";
  const body = rows.map(({ label, setup, rec }) => {
    const st = repeatStats(rec);
    const acc = st.mean ?? (rec.graded ? rec.passed / rec.graded : 0);
    const per = st.per.length > 1 ? st.per.map((p) => Math.round(p * 100)).join(", ") + (st.sd !== null ? ` (sd ${Math.round(st.sd * 1000) / 10})` : "") : "one run";
    return `| ${cellText(label)} | ${cellText(setup)} | ${pct(acc)} | ${per} | ${money(rec.usd)} | ${rec.passed ? money(rec.usd / rec.passed) : "–"} |`;
  });
  return [head, ...body].join("\n");
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Questions down, evaluations across; each cell is the share of that question's runs that passed (1, 0, 0.67…). */
export function csvGrid(rows: ExportRow[]): string {
  const first = rows[0]?.rec;
  if (!first) return "";
  const questions = [...new Map(first.cases.map((c, i) => [c.case ?? i, { input: c.input, expected: c.expected }])).values()];
  const head = ["#", "question", "expected", ...rows.map((r) => `${r.label} (${r.setup})`)];
  const lines = questions.map((q, i) => [
    i + 1,
    q.input,
    q.expected,
    ...rows.map(({ rec }) => {
      const cs = rec.cases.filter((c) => c.input === q.input && c.pass !== undefined);
      return cs.length ? Math.round((cs.filter((c) => c.pass).length / cs.length) * 100) / 100 : "";
    }),
  ]);
  return [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\n") + "\n";
}
