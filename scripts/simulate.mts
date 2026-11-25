// Run a game or simulation template many times on the local server and print what its runs report (their metrics).
// Run from the repository root, with the server up:
//   npx --no-install tsx scripts/simulate.mts paper-govsim --repeats 5 --on gemini --vars '{"greedy":true}' --usd 1
// It reads the server's token from .data/token (never printed) and starts an ordinary evaluation (grader none), so
// the runs can be opened and compared on the Evaluate and Compare pages afterwards.
import fs from "node:fs";
import { metricStats, type EvalRecord } from "../src/run/evals";

const args = process.argv.slice(2);
const template = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (!template) {
  console.error("usage: simulate.mts <template-id> [--repeats 5] [--on gemini_lite] [--vars '{...}'] [--usd 1] [--concurrency 2]");
  process.exit(2);
}
const base = opt("server", "http://127.0.0.1:5190");
const token = fs.readFileSync(".data/token", "utf8").trim();
const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
const body = {
  system_id: `sys_${template.replace(/-/g, "_")}`,
  cases: [{ input: "Start.", expected: "" }],
  repeats: Number(opt("repeats", "5")),
  grader: "none",
  concurrency: Number(opt("concurrency", "2")),
  on_model: opt("on", "gemini_lite"),
  // each run may spend a fraction of the whole; the whole is capped by --usd
  usd_limit: Math.max(0.05, Number(opt("usd", "1")) / 2),
  max_usd: Number(opt("usd", "1")),
  vars: JSON.parse(opt("vars", "{}")),
};
const started = await fetch(`${base}/api/evals`, { method: "POST", headers, body: JSON.stringify(body) });
if (!started.ok) {
  console.error(`could not start: ${started.status} ${await started.text()}`);
  process.exit(1);
}
const { id } = (await started.json()) as { id: string };
console.error(`${id}: ${body.repeats} runs of ${template} on ${body.on_model}${Object.keys(body.vars).length ? ` with ${JSON.stringify(body.vars)}` : ""}`);
let rec: EvalRecord;
for (;;) {
  rec = ((await (await fetch(`${base}/api/evals/${id}`, { headers })).json()) as { eval: EvalRecord }).eval;
  if (rec.status !== "running" && rec.status !== "queued") break;
  await new Promise((r) => setTimeout(r, 5000));
}
const failed = rec.cases.filter((c) => !c.output).length;
console.log(`${id} ${rec.status} · $${rec.usd.toFixed(3)}${failed ? ` · ${failed} runs without output` : ""}`);
const r = (x: number) => Math.round(x * 100) / 100;
for (const m of metricStats(rec.cases)) {
  const values = rec.cases.map((c) => c.metrics?.[m.name]).filter((v) => v !== undefined);
  console.log(`  ${m.name}: mean ${r(m.mean)} (${r(m.min)}–${r(m.max)}, ${m.n} runs) · ${values.join(", ")}`);
}
