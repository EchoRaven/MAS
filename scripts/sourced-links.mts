// Read-only: how many links an article cites, and how many of them its own run's web searches returned.
// A judge model cannot check recent facts or links; this can: a link no search returned was written from memory
// or made up. Runs from before the log kept 12,000 characters of a tool's result undercount what searches found.
// Run from the repository root: npx --no-install tsx scripts/sourced-links.mts <eval id> [<eval id> ...]
import fs from "node:fs";

const D = ".data";
const urls = (s: string) => new Set((s.match(/https?:\/\/[^\s)\]>"'|,]+/g) ?? []).map((u) => u.replace(/[.;:]+$/, "")));

for (const id of process.argv.slice(2)) {
  const e = JSON.parse(fs.readFileSync(`${D}/evals/${id}.json`, "utf8"));
  let cited = 0, found = 0, articles = 0, withSearch = 0;
  for (const c of e.cases) {
    if (!c.output || !c.run_id || !fs.existsSync(`${D}/runs/${c.run_id}/events.jsonl`)) continue;
    const searched = new Set<string>();
    let searches = 0;
    for (const l of fs.readFileSync(`${D}/runs/${c.run_id}/events.jsonl`, "utf8").split("\n").filter(Boolean)) {
      const x = JSON.parse(l);
      if (x.type === "tool" && (x.tool === "web_search" || x.tool === "fetch")) {
        searches++;
        for (const u of urls(String(x.result ?? ""))) searched.add(u);
        if (x.tool === "fetch") for (const u of urls(String(x.args ?? ""))) searched.add(u);
      }
    }
    const mine = urls(c.output);
    articles++;
    if (searches) withSearch++;
    cited += mine.size;
    found += [...mine].filter((u) => searched.has(u)).length;
  }
  const per = (n: number) => (articles ? (n / articles).toFixed(1) : "–");
  console.log(`${e.system_name} (${id}): ${articles} articles, ${withSearch} with searches; links per article ${per(cited)}, of them returned by its searches ${per(found)} (${cited ? Math.round((100 * found) / cited) : 0}%)`);
}
