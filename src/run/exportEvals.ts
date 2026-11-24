// Evaluation results as text to take elsewhere: a Markdown table for a
// write-up, and a CSV of which system got each question right.
import { type EvalRecord, pairedDiff, repeatStats } from "./evals";

export interface ExportRow {
  label: string;
  setup: string;
  rec: EvalRecord;
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const money = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const cellText = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** "+4 −0 (p 0.13)": questions fixed and lost against the reference, and the exact McNemar p-value. */
export function vsText(rec: EvalRecord, ref: EvalRecord): string {
  if (rec === ref) return "reference";
  const d = pairedDiff(rec, ref);
  const p = `p ${d.p < 0.001 ? "<0.001" : d.p.toFixed(d.p < 0.01 ? 3 : 2)}`;
  if (d.runs) return `${d.runs.sys.passed}/${d.runs.sys.graded} vs ${d.runs.ref.passed}/${d.runs.ref.graded} runs (${p}, Fisher)`;
  return `+${d.fixed.length} −${d.lost.length} (p ${d.p < 0.001 ? "<0.001" : d.p.toFixed(d.p < 0.01 ? 3 : 2)})`;
}

/** One row per evaluation, as it reads on the Compare page; with a reference, each row's fixed and lost questions against it. */
export function markdownTable(rows: ExportRow[], ref?: EvalRecord): string {
  const head = ref
    ? "| System | Models · variables | Accuracy | Per repeat | vs reference | Cost | Per correct answer |\n| --- | --- | --- | --- | --- | --- | --- |"
    : "| System | Models · variables | Accuracy | Per repeat | Cost | Per correct answer |\n| --- | --- | --- | --- | --- | --- |";
  const body = rows.map(({ label, setup, rec }) => {
    const st = repeatStats(rec);
    const acc = st.mean ?? (rec.graded ? rec.passed / rec.graded : 0);
    const per = st.per.length > 1 ? st.per.map((p) => Math.round(p * 100)).join(", ") + (st.sd !== null ? ` (sd ${Math.round(st.sd * 1000) / 10})` : "") : "one run";
    return `| ${cellText(label)} | ${cellText(setup)} | ${pct(acc)} | ${per} |${ref ? ` ${vsText(rec, ref)} |` : ""} ${money(rec.usd)} | ${rec.passed ? money(rec.usd / rec.passed) : "–"} |`;
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
