// Read-only: how many links an evaluation's outputs cite, and how many of them their own runs' web searches
// returned (sourcedLinks; the Pairwise panel on the Evaluate page shows the same). Runs from before the log kept
// 12,000 characters of a tool's result undercount what searches found.
// Run from the repository root: npx --no-install tsx scripts/sourced-links.mts <eval id> [<eval id> ...]
import fs from "node:fs";
import { sourcedLinks } from "../src/run/evals";

const D = ".data";
for (const id of process.argv.slice(2)) {
  const e = JSON.parse(fs.readFileSync(`${D}/evals/${id}.json`, "utf8"));
  let cited = 0, found = 0, outputs = 0, withSearch = 0;
  for (const c of e.cases) {
    const file = `${D}/runs/${c.run_id}/events.jsonl`;
    if (!c.output || !c.run_id || !fs.existsSync(file)) continue;
    const tools = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.type === "tool");
    const s = sourcedLinks(c.output, tools);
    outputs++;
    cited += s.cited;
    found += s.found;
    if (s.searches) withSearch++;
  }
  const per = (n: number) => (outputs ? (n / outputs).toFixed(1) : "–");
  console.log(`${e.system_name} (${id}): ${outputs} outputs, ${withSearch} with searches; links per output ${per(cited)}, of them returned by its searches ${per(found)} (${cited ? Math.round((100 * found) / cited) : 0}%)`);
}
