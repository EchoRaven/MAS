// Record real runs of the paper reproductions for the Demos page.
//   npm run server   (with a GEMINI_API_KEY set in Settings)
//   TSX_TSCONFIG_PATH=tsconfig.server.json npx tsx scripts/record-demos.mts [paper-id…]
// Each template runs on Gemini models through the server; requests for
// approval are approved and requests for input get a short reply. The run
// (system, input, events, summary) is written to public/demos/<id>.json.
//
// --check runs the same inputs as a health check of the templates instead:
// nothing is written, every chat model is gemini-3.1-flash-lite (unless
// MAS_DEMO_MODELS says otherwise), and a table at the end says for each
// template whether it finished with an answer, and what went wrong if not
// (errors, requests for a person, running out of rounds). Run it after
// changing the engine or a template.
import fs from "node:fs";
import path from "node:path";
import { TEMPLATES } from "@/model/templates";
import type { ModelSpec, SystemDoc } from "@/model/types";
import type { RunEvent, RunRecord } from "@/run/events";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "demos");
const API = process.env.MAS_API ?? "http://127.0.0.1:5190/api";
const TOKEN = (process.env.MAS_TOKEN ?? fs.readFileSync(path.join(ROOT, ".data", "token"), "utf8")).trim();
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

/** Catalog ids -> Gemini models. Different ids get different models, which also spreads free-tier rate limits. */
// override per run with MAS_DEMO_MODELS='{"sonnet":"gemini-3.1-flash-lite",…}'
const OVERRIDE: Record<string, string> = JSON.parse(process.env.MAS_DEMO_MODELS ?? "{}");
const g = (model: string, price_in: number, price_out: number) => ({ provider: "google" as const, model, api: { key_env: "GEMINI_API_KEY" }, price_in, price_out, modalities: ["text"] });
const GEMINI: Record<string, Omit<ModelSpec, "id">> = {
  opus: g("gemini-3-flash-preview", 0.5, 3),
  sonnet: g("gemini-3.8-flash", 0.5, 3),
  haiku: g("gemini-3.5-flash-lite", 0.1, 0.4),
  gpt: g("gemini-3.1-flash-lite", 0.25, 1.5),
  local: g("gemini-flash-lite-latest", 0.1, 0.4),
  gemini: g("gemini-3.8-flash", 0.5, 3),
  embed: { kind: "embedding", provider: "google", model: "gemini-embedding-001", api: { key_env: "GEMINI_API_KEY" }, price_in: 0.15, price_out: 0, modalities: ["text"] },
};

interface DemoConfig {
  input: string;
  vars?: Record<string, unknown>;
  /** changes for the recording, applied to the template and listed on the page */
  adapt?: (doc: SystemDoc) => string[];
}

const capRounds = (doc: SystemDoc, n: number) => (doc.budget = { ...doc.budget, max_rounds: n });
const node = (doc: SystemDoc, id: string) => doc.nodes.find((n) => n.id === id)!;

const DEMOS: Record<string, DemoConfig> = {
  "paper-debate": { input: "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? End with 'Final: <answer>'." },
  "paper-moa": { input: "Explain, in one short paragraph, why the sky is blue and why sunsets are red." },
  "paper-camel": {
    input: "Develop a trading bot for the stock market",
    vars: { assistant_role: "Python Programmer", user_role: "Stock Trader" },
    adapt: (doc) => {
      const g = node(doc, "roleplay").data;
      if (g.kind === "group" && g.iterate) g.iterate.max_rounds = 6;
      return ["The role-play is capped at 6 rounds (the template allows 40) to keep the recording short."];
    },
  },
  "paper-chateval": {
    input:
      'Which answer is better, and why?\n\nQuestion: "Should a small team adopt microservices?"\n\nAnswer A: "Yes. Microservices are the modern standard: they scale, they let teams deploy independently, and every large company uses them."\n\nAnswer B: "Usually not yet. Below roughly ten engineers the operational cost — deployment, tracing, data consistency across services — outweighs the benefits. Start with a well-structured monolith and split out a service when one part genuinely needs separate scaling or a separate release cadence."',
  },
  "paper-mapcoder": {
    input: "Given a list of integers, return the length of the longest strictly increasing subsequence. Example: [10, 9, 2, 5, 3, 7, 101, 18] → 4.",
    adapt: (doc) => {
      capRounds(doc, 16);
      const g = node(doc, "repair").data;
      if (g.kind === "group" && g.iterate) g.iterate.max_rounds = 2;
      return ["The debugging loop is capped at 2 attempts (the template allows 5)."];
    },
  },
  "paper-autogen": {
    input: "Compute how many prime numbers there are below 10000, and the sum of their digits. Verify the result.",
    adapt: (doc) => {
      capRounds(doc, 12);
      return ["The chat is capped at 12 turns."];
    },
  },
  "paper-agentcoder": {
    input: "Write a function roman_to_int(s) that converts a Roman numeral string (I, V, X, L, C, D, M, with subtractive pairs like IV and IX) to an integer.",
    adapt: (doc) => {
      capRounds(doc, 16);
      const g = node(doc, "loop").data;
      if (g.kind === "group" && g.iterate) g.iterate.max_rounds = 2;
      return ["The code-and-test loop is capped at 2 rounds (the template allows 4)."];
    },
  },
  "paper-agentverse": {
    input: "Our two-person startup has three months of runway and a half-finished product. What should we do?",
    adapt: (doc) => {
      capRounds(doc, 12);
      const g = node(doc, "round").data;
      if (g.kind === "group" && g.iterate) g.iterate.max_rounds = 2;
      return ["The recruit-decide-execute-evaluate loop is capped at 2 rounds."];
    },
  },
  "paper-mad": {
    // the paper's own kind of question: a quick answer (2 m/s) that is wrong
    input: "Alice walks up a hill at 1 m/s and comes back down the same path at 3 m/s. What is her average speed for the whole trip?",
  },
  "paper-reconcile": {
    // hard enough that the seats tend to disagree at first (it is 48: 100! has 97 factors of 2, so 48 of 4, and 48 of 3)
    input: "How many trailing zeros does 100! (100 factorial) have when written in base 12?",
  },
  "paper-medagents": {
    // a USMLE-style item, the kind of question the paper evaluates on (MedQA)
    input: "A 68-year-old man with heart failure takes lisinopril and furosemide. Spironolactone is added. Two weeks later he reports muscle weakness, and his ECG shows peaked T waves. Which is the most likely cause? A) Hyponatraemia B) Hyperkalaemia C) Hypocalcaemia D) Digoxin toxicity",
  },
  "paper-autoagents": {
    input: "Write a short, accurate explainer (about 300 words) on how vaccines train the immune system, for high-school students.",
  },
  "paper-eot": {
    // a question the single agent often got wrong in our benchmark (it is 76), so the exchange has something to settle
    input: "What is the sum of the decimal digits of 2^50?",
    vars: { paradigm: "memory" },
  },
  "paper-agents-room": {
    input: "A short story (about 600 words) about a lighthouse keeper who finds a message in a bottle.",
  },
  "paper-storm": {
    // web search is a provider tool on Anthropic models only: on Gemini the expert answers from what it knows and says so
    input: "The history of the printing press",
  },
  "paper-virtual-lab": {
    input: "Propose a computational approach to design a nanobody that binds the spike protein of a newly emerged SARS-CoV-2 variant.",
  },
  "paper-chain-of-agents": {
    // the long document is this platform's own server guide; the two answers sit in different parts of it
    input:
      "What happens to a run when it goes over its budget in dollars, and how does the server deal with a model provider's rate limit?\n---\n" +
      fs.readFileSync(path.join(ROOT, "docs", "server.md"), "utf8"),
  },
  "paper-werewolf": {
    input: "Begin the game.",
    vars: { days: 4 },
  },
  "paper-tradingagents": {
    input: "Should we trade NVIDIA (NVDA) today? Use what you know up to your training cutoff.",
  },
  "paper-dylan": {
    // a question without one right answer, so the first layer disagrees and the selection shows
    // (a question everyone gets right stops after layer 1: the early stop, which the tests cover)
    input: "A team of three people is building its first web product. Which single programming language should they standardise on?",
  },
  "paper-reflexion": {
    input:
      "Write a function is_valid_parens(s) that returns True when every bracket in s — (), [] and {} — is closed in the right order, and False otherwise.\n\nTests:\nassert is_valid_parens('()[]{}')\nassert is_valid_parens('{[()]}')\nassert not is_valid_parens('(]')\nassert not is_valid_parens('([)]')\nassert not is_valid_parens('((')\nassert is_valid_parens('')\nassert is_valid_parens('a(b)c')",
  },
  "paper-voyager": {
    input: "Learn to summarise a list of numbers: build up to a function that reports its mean, median and standard deviation.",
    adapt: (doc) => {
      capRounds(doc, 24);
      const g = node(doc, "attempt").data;
      if (g.kind === "group" && g.iterate) g.iterate.max_rounds = 2;
      return ["Each task gets at most 2 attempts (the template allows 4), and the run 24 activations."];
    },
  },
  "paper-chatdev": {
    input: "A command-line tic-tac-toe game in Python for two players on one keyboard.",
    adapt: (doc) => {
      capRounds(doc, 40);
      for (const g of doc.nodes) if (g.data.kind === "group" && g.data.iterate) g.data.iterate.max_rounds = Math.min(g.data.iterate.max_rounds, 3);
      return ["Each phase is capped at 3 dialogue rounds and the run at 40 activations."];
    },
  },
  "paper-metagpt": {
    input: "A Python command-line tool that converts temperatures between Celsius and Fahrenheit, with unit tests.",
    adapt: (doc) => {
      capRounds(doc, 8);
      // each role plans and executes with up to 30 steps and pins the whole pool: left alone this recording
      // costs a dollar in re-sent context
      // QA writes the tests and runs them, so it needs a few more steps than the others
      for (const n of doc.nodes) if (n.data.kind === "agent") n.data.harness.max_steps = n.id === "qa" ? 6 : 3;
      for (const e of doc.edges) if (e.binding?.read?.budget_tokens) e.binding.read.budget_tokens = 2000;
      return ["Each role takes at most 3 steps per turn and sees 2000 tokens of the message pool, and the run is capped at 8 activations."];
    },
  },
  "paper-generative-agents": {
    input: "It is 8:00 am on February 13 in Smallville. Isabella is opening her café and mentions the Valentine's Day party she is planning.",
    adapt: (doc) => {
      capRounds(doc, 20);
      doc.termination = [...doc.termination.filter((t) => !t.startsWith("posts")), "posts >= 8"];
      return ["The day is cut to 8 messages in the town (the template has 12)."];
    },
  },
  "paper-magentic-one": {
    input: "Using Python, compute the 25th Fibonacci number and the sum of the first 100 prime numbers. Report both numbers.",
    adapt: (doc) => {
      const term = node(doc, "terminal").data;
      if (term.kind === "agent") {
        term.harness = { ...term.harness, tier: "native", runner: "native", loop: "react", command: undefined, instructions: "Run the code you are given in the sandbox with bash (python3 is installed) and report the output exactly." };
        term.model = "haiku";
      }
      const web = node(doc, "websurfer").data;
      if (web.kind === "agent") web.tools = ["fetch"];
      const orch = node(doc, "orchestrator").data;
      if (orch.kind === "agent") orch.harness.max_steps = 30;
      capRounds(doc, 30);
      return [
        "ComputerTerminal runs as a platform agent with the sandbox's bash tool (the template drives an external executor program).",
        "WebSurfer reads pages with the fetch tool (the template's browser env has no MCP server configured here).",
        "The Orchestrator takes at most 5 rounds before it must write its answer.",
      ];
    },
    vars: { max_rounds: 5 },
  },
};

const CHECK = process.argv.includes("--check");
// a check is about structure, not quality: the cheapest model everywhere, so all templates can be checked often
if (CHECK && !process.env.MAS_DEMO_MODELS) for (const id of Object.keys(GEMINI)) if (GEMINI[id].kind !== "embedding") GEMINI[id] = { ...GEMINI[id], model: "gemini-3.1-flash-lite", price_in: 0.25, price_out: 1.5 };
for (const [id, model] of Object.entries(OVERRIDE)) if (GEMINI[id]) GEMINI[id] = { ...GEMINI[id], model };

interface CheckRow { id: string; status: string; reason: string; answer: boolean; errors: string[]; asked: number; calls: number; usd: number; seconds: number }
const checks: CheckRow[] = [];

function onGemini(doc: SystemDoc): Record<string, string> {
  const used: Record<string, string> = {};
  doc.models = doc.models
    .filter((m) => GEMINI[m.id])
    .map((m) => {
      used[m.id] = GEMINI[m.id].model;
      return { id: m.id, ...GEMINI[m.id] };
    });
  for (const n of doc.nodes) if (n.data.kind === "env" && /^python:3\.12$/.test(n.data.image)) n.data.image = "python:3.12-slim";
  return used;
}

async function call<T>(method: string, p: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function record(id: string, cfg: DemoConfig) {
  const tpl = TEMPLATES.find((t) => t.id === id);
  if (!tpl) throw new Error(`no template ${id}`);
  const doc = tpl.build();
  doc.id = `demo_${id.replace(/^paper-/, "").replace(/-/g, "_")}`;
  const models = onGemini(doc);
  const changes = cfg.adapt?.(doc) ?? [];
  console.log(`\n▶ ${tpl.name}: ${cfg.input.slice(0, 70)}`);
  // save: false — a recording should not leave a copy of the system in the workspace
  const rec = await call<RunRecord>("POST", "/runs", { doc, input: cfg.input, vars: cfg.vars, save: false });
  const answered = new Set<string>();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const g = await call<{ run: RunRecord; events: RunEvent[]; active: boolean }>("GET", `/runs/${rec.id}`);
    for (const e of g.events) {
      if (e.type !== "human_request" || answered.has(e.request.id)) continue;
      answered.add(e.request.id);
      await call("POST", `/runs/${rec.id}/answer`, { request: e.request.id, approved: true, text: e.request.kind === "input" ? "Sounds good, please continue." : "" });
    }
    process.stdout.write(`\r  ${g.events.length} events, $${g.run.usd.toFixed(4)}   `);
    if (g.active) continue;
    const out = { id, name: tpl.name, input: cfg.input, vars: cfg.vars ?? {}, models, changes, recorded_at: new Date().toISOString(), run: g.run, system: doc, events: g.events };
    const calls = g.events.filter((e) => e.type === "usage").length;
    const errors = g.events.filter((e) => e.type === "log" && e.level === "error").map((e) => (e as { text: string }).text);
    // a called agent that failed (the provider refused) shows up as a tool error, not a run error: that is not a clean demo either
    for (const e of g.events) if (e.type === "tool" && e.error && /^Error: (google|openai|anthropic|openai_compatible|local) \d{3}\b/.test(String((e as { result?: string }).result))) errors.push(`${(e as { tool: string }).tool}: ${String((e as { result?: string }).result).slice(7, 160)}`);
    const answer = g.events.some((e) => e.type === "output" && String((e as { text?: string }).text ?? "").trim().length > 0);
    const last = g.events[g.events.length - 1] as { t?: number } | undefined;
    if (CHECK) {
      checks.push({ id, status: g.run.status, reason: String(g.run.reason ?? ""), answer, errors, asked: answered.size, calls, usd: g.run.usd, seconds: Math.round(last?.t ?? 0) });
      console.log(`\n  ${g.run.status} (${g.run.reason}) · ${answer ? "answered" : "NO ANSWER"} · ${calls} calls · $${g.run.usd.toFixed(4)}${errors.length ? `\n  errors: ${errors.join(" | ").slice(0, 300)}` : ""}`);
      return;
    }
    // only clean runs replace a recording
    if (!errors.length && g.run.status === "finished") {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(out));
    } else console.log("\n  not saved: the run had errors");
    console.log(`\n  ${g.run.status} (${g.run.reason}) · ${calls} model calls · ${g.run.tokens} tokens · $${g.run.usd.toFixed(4)}${errors.length ? `\n  errors: ${errors.join(" | ").slice(0, 400)}` : ""}`);
    return;
  }
}

function writeIndex() {
  const files = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => f.endsWith(".json") && f !== "index.json") : [];
  const index = files.map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
    const calls = d.events.filter((e: RunEvent) => e.type === "usage").length;
    const last = d.events[d.events.length - 1];
    return { id: d.id, name: d.name, input: d.input, status: d.run.status, reason: d.run.reason, calls, tokens: d.run.tokens, usd: d.run.usd, seconds: last?.t ?? 0, recorded_at: d.recorded_at };
  });
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ids = args.length ? args : Object.keys(DEMOS);
for (const id of ids) {
  try {
    await record(id, DEMOS[id]);
  } catch (e) {
    console.log(`\n  failed: ${(e as Error).message}`);
    if (CHECK) checks.push({ id, status: "failed", reason: (e as Error).message.slice(0, 80), answer: false, errors: [], asked: 0, calls: 0, usd: 0, seconds: 0 });
  }
  if (!CHECK) writeIndex();
}
if (CHECK) {
  // a template is healthy when it finishes on its own with an answer, no errors, and without hitting a limit
  const limited = (c: CheckRow) => /limit|budget|round/i.test(c.reason);
  const ok = (c: CheckRow) => c.status === "finished" && c.answer && !c.errors.length && !limited(c);
  console.log("\n\ntemplate                     result  calls     cost   time  notes");
  for (const c of checks) {
    const notes = [!c.answer && "no answer", c.errors.length && `${c.errors.length} error(s): ${c.errors[0].slice(0, 60)}`, c.asked && `asked a person ${c.asked}x`, c.status !== "finished" && c.status, limited(c) && c.reason].filter(Boolean).join("; ");
    console.log(`${c.id.padEnd(28)} ${(ok(c) ? "ok" : "CHECK").padEnd(7)} ${String(c.calls).padStart(5)} ${("$" + c.usd.toFixed(3)).padStart(8)} ${String(c.seconds).padStart(5)}s  ${notes}`);
  }
  const bad = checks.filter((c) => !ok(c)).length;
  console.log(`\n${checks.length - bad} of ${checks.length} healthy; $${checks.reduce((n, c) => n + c.usd, 0).toFixed(3)} in all`);
}
