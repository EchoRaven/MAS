// Generative Agents in a town: six residents, each starting somewhere of their own, act in a hosted town
// (examples/hosted/town-mcp) through its tools. A function runs the day as the paper's game clock does: every
// resident takes a turn, then the clock moves on an hour, from 08:00 to 19:00. Isabella plans a Valentine's Day party
// at Hobbs Cafe at 17:00 and no one else is told; at the end the town reports who heard of it and who came, the
// paper's information diffusion and party attendance.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const RESIDENTS: { id: string; name: string; start: string; seed: string }[] = [
  { id: "isabella", name: "Isabella", start: "cafe", seed: "You run Hobbs Cafe. You are planning a Valentine's Day party at the cafe today from 5pm to 7pm and want as many people as possible to come." },
  { id: "maria", name: "Maria", start: "college", seed: "You are a student at Oak Hill College who likes meeting friends at the cafe." },
  { id: "klaus", name: "Klaus", start: "library", seed: "You are a student writing a research paper on gentrification; you spend time in the library and walk in the park." },
  { id: "tom", name: "Tom", start: "store", seed: "You run the Harvey Oak Supply Store and chat with customers." },
  { id: "ayesha", name: "Ayesha", start: "houses", seed: "You are a writer who lives on the residential street and takes walks in the park." },
  { id: "carlos", name: "Carlos", start: "park", seed: "You are a poet who spends the day in the park and drops by the cafe." },
  // six more for the larger town, mostly starting away from the cafe
  { id: "sam", name: "Sam", start: "houses", seed: "You are a retired shopkeeper who lives on the residential street and is thinking of running for mayor." },
  { id: "jennifer", name: "Jennifer", start: "library", seed: "You are the town librarian; you spend the day at the library desk." },
  { id: "eddy", name: "Eddy", start: "college", seed: "You are a music student at Oak Hill College who practises composition between classes." },
  { id: "wolfgang", name: "Wolfgang", start: "college", seed: "You are a professor at Oak Hill College who lectures in the morning and reads in the afternoon." },
  { id: "abigail", name: "Abigail", start: "houses", seed: "You are an animator who works from home on the residential street." },
  { id: "rajiv", name: "Rajiv", start: "store", seed: "You are a painter who buys supplies at the store and paints outdoors." },
];

const day = (rs: typeof RESIDENTS) => `const T = (name, args) => ctx.tool(name, args ?? {});
const R = ${JSON.stringify(rs.map((r) => ({ name: r.name, start: r.start })))};
const step = Math.max(10, Math.min(120, Number(ctx.vars.step ?? 60)));
const until = String(ctx.vars.until ?? "19:00");
// no town to act in (not hosted on this server, or a dry run): say what is missing instead of failing the run
try {
  await T("reset", { driven: true });
} catch (e) {
  const why = String(e?.message ?? e);
  ctx.log("no town: " + why);
  return "The town is not available (" + why + "). Host examples/hosted/town-mcp under the name town (Connections), then run the day again.";
}
for (const r of R) await T("enter", { who: r.name, place: r.start });
for (let i = 0; i < 48; i++) {
  const now = String(await T("time")).trim();
  if (now >= until) break;
  for (const r of R) {
    await ctx.call(r.name, "It is " + now + " in town. Take your turn as " + r.name + ": look around, then do what you would at this hour (move, say something to whoever is there, or wait). At most three actions; reply with one line on what you did.");
  }
  await T("advance", { minutes: step });
}
const party = JSON.parse(String(await T("report", { keyword: "party", place: "cafe", from: "17:00", to: "19:00" })));
const heard = party.keyword.heard_by_others.filter((w) => w !== "Isabella");
const came = party.place.there.filter((w) => w !== "Isabella");
const others = R.length - 1;
// the paper's measure: ask each resident at the end of the day (interview=false skips it)
const knows = [];
if (String(ctx.vars.interview ?? "true") !== "false") {
  for (const r of R) {
    if (r.name === "Isabella") continue;
    const a = String(await ctx.call(r.name, "The day is over; an interviewer asks you, without any tools: do you know of a party happening today? If you do, say who is hosting it, where and when. Reply in one line starting with Yes or No."));
    if (/^\\W*yes\\b/i.test(a.trim()) && /isabella|hobbs|cafe|café/i.test(a)) knows.push(r.name);
  }
}
ctx.log("heard of the party: " + heard.length + " of " + others + " (" + heard.join(", ") + "); knew it when asked: " + knows.length + " (" + knows.join(", ") + "); at the cafe 17:00-19:00: " + came.length + " (" + came.join(", ") + ")");
return "Heard of the party: " + heard.length + " of " + others + (heard.length ? " (" + heard.join(", ") + ")" : "") + ". Knew of it when asked: " + knows.length + (knows.length ? " (" + knows.join(", ") + ")" : "") + ". At Hobbs Cafe from 17:00 to 19:00: " + came.length + (came.length ? " (" + came.join(", ") + ")" : "") + ".\\nAnswer: " + knows.length;`;

function build(n = 6): SystemDoc {
  const rs = RESIDENTS.slice(0, n);
  const b = new Builder(
    n === 6 ? "Generative Agents (town)" : `Generative Agents (town, ${n} residents)`,
    (n === 6 ? "Six" : String(n)) + " residents act in a hosted town (the service named town: examples/hosted/town-mcp), each starting in a place of their own. Every hour from 08:00 to 19:00 each takes a turn through the town's tools; what is said is heard only where it is said. Isabella plans a party at Hobbs Cafe at 17:00; at the end the town reports who heard of it and who came.",
  );
  b.node("asker", "human", 0, 160, { name: "Narrator", role: "Starts the day", approves: false }).node("day", "function", 260, 160, {
    name: "The day",
    join: "any",
    fn: { lang: "js", code: day(rs), timeout_ms: 3_600_000 },
    interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] },
  });
  b.node("town", "env", 260, 420, {
    name: "Town",
    env_kind: "service",
    lifecycle: "per_run",
    manifest: {
      contract: "mas-env/1",
      id: "town",
      name: "Town",
      source: { format: "mas-env" },
      kind: "service",
      runtime: { services: [] },
      lifecycle: { health: "/health" },
      exposes: { mcp: { transport: "http", auth: "none", tools: ["look", "move", "say", "wait", "time", "enter", "report", "advance", "reset"], endpoint: { hosted: { service: "town" } } }, http: [] },
    },
  } as never);
  rs.forEach((r, i) => {
    b.agent(r.id, 600, i * 110, {
      name: r.name,
      role: r.seed,
      model: "sonnet",
      harness: {
        ...native(),
        loop: "react",
        instructions: `You are ${r.name}. ${r.seed} You live in a small town and act in it only through its tools (look, move, say, wait), always with who="${r.name}". Talk with the people you meet as you naturally would.`,
      },
    });
    // residents get only what a person in town can do; reset, enter, advance and report are the day's alone
    b.edge("day", r.id, "call", { label: "Your turn" }).edge(r.id, "town", "access", { access: "read_write", binding: { mode: "tool", tools: ["look", "move", "say", "wait"] } } as never);
  });
  b.edge("asker", "day", "message", { label: "Begin" }).edge("day", "town", "access", { access: "read_write" }).edge("day", "asker", "message", { label: "What happened" });
  b.doc.budget = { usd: n > 6 ? 2 : 1, max_rounds: 400 * Math.ceil(n / 6), wallclock_min: 60 * Math.ceil(n / 6) };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

export const generativeTown: TemplateInfo = {
  id: "paper-generative-agents-town",
  name: "Generative Agents (town)",
  summary: "six residents in a hosted town · a day in hourly steps · who heard of the party, who came",
  build: () => build(6),
  paper: { title: "Generative Agents: Interactive Simulacra of Human Behavior", authors: "Park et al.", year: 2023, url: "https://arxiv.org/abs/2304.03442" },
  notes: {
    mapped: [
      "The town is a hosted service (examples/hosted/town-mcp, hosted under the name town): six places, speech heard only where it is said or found there soon after, and a clock that moves only between steps, as the paper's game clock does.",
      "A function runs the day: each resident takes a turn every hour from 08:00 to 19:00 (run variables step and until), then the town reports who heard of the party besides Isabella and who was at Hobbs Cafe from 17:00 to 19:00: the paper's information diffusion and party attendance.",
      "Only Isabella knows of the party at the start, as in the paper's seeded scenario. Residents can only look, move, say and wait; resetting, entering, moving the clock and the report belong to the function running the day.",
    ],
    differs: [
      "Six residents rather than twenty-five, over one day in hourly steps rather than ten-minute ones.",
      "No memory stream, reflection or planning: each resident remembers through its own conversation over the day. This tests the town and the spreading of news, not the agent architecture of the room-based template.",
      "Two counts of who knew: who was present when the party was spoken of (exposure, from the town's record), and who says so when asked at the end of the day (Yes, naming Isabella or the cafe), the paper's interviews. The interview is a call in the same conversation, so a resident answers from what it saw that day.",
    ],
  },
};

export const generativeTown12: TemplateInfo = {
  ...generativeTown,
  id: "paper-generative-agents-town-12",
  name: "Generative Agents (town, 12 residents)",
  summary: "the town with twelve residents, most starting away from the cafe · who heard of the party, who came",
  build: () => build(12),
};
