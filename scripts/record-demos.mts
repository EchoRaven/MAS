// Record real runs of the paper reproductions for the Demos page.
//   npm run server   (with a GEMINI_API_KEY set in Settings)
//   TSX_TSCONFIG_PATH=tsconfig.server.json npx tsx scripts/record-demos.mts [paper-id…]
// Each template runs on Gemini models through the server; requests for
// approval are approved and requests for input get a short reply. The run
// (system, input, events, summary) is written to public/demos/<id>.json.
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
  sonnet: g("gemini-2.5-flash", 0.3, 2.5),
  haiku: g("gemini-3.5-flash-lite", 0.1, 0.4),
  gpt: g("gemini-3.1-flash-lite", 0.25, 1.5),
  local: g("gemini-flash-lite-latest", 0.1, 0.4),
  gemini: g("gemini-2.5-flash", 0.3, 2.5),
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
  "paper-werewolf": {
    input: "Begin the game.",
    vars: { days: 3 },
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
      capRounds(doc, 8);
      return ["The day is cut to 8 agent turns."];
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

for (const [id, model] of Object.entries(OVERRIDE)) if (GEMINI[id]) GEMINI[id] = { ...GEMINI[id], model };

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
  const rec = await call<RunRecord>("POST", "/runs", { doc, input: cfg.input, vars: cfg.vars });
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

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(DEMOS);
for (const id of ids) {
  try {
    await record(id, DEMOS[id]);
  } catch (e) {
    console.log(`\n  failed: ${(e as Error).message}`);
  }
  writeIndex();
}
