// Generative Agents: believable agents in a shared town, each with a memory
// stream retrieved by recency + importance + relevance, periodic reflection
// and daily plans.
import { Builder, native, type TemplateInfo } from "../builder";
import { defaultPlugin } from "../plugins";
import type { SystemDoc } from "../types";

function memoryStream() {
  const p = defaultPlugin("memory");
  p.name = "Memory stream";
  p.spec.scope = "agent"; // one plugin, a private stream per agent
  p.spec.retrieval = {
    rewrite: { use: "none", params: {} },
    search: [{ use: "vector", params: { embedding: "embed", k: 100, metric: "cosine" } }],
    // score = recency + importance + relevance, each normalised to [0, 1], equal weights
    fuse: {
      use: "custom",
      fn: {
        lang: "js",
        code: [
          "const hours = (h) => (ctx.now - h.meta.last_accessed) / 3.6e6;",
          "const norm = (xs) => { const lo = Math.min(...xs), hi = Math.max(...xs); return xs.map((x) => (hi > lo ? (x - lo) / (hi - lo) : 1)); };",
          "const hits = lists.flat();",
          "const rec = norm(hits.map((h) => Math.pow(0.995, hours(h))));",
          "const imp = norm(hits.map((h) => h.meta.importance));",
          "const rel = norm(hits.map((h) => h.score));",
          "return hits.map((h, i) => ({ ...h, score: rec[i] + imp[i] + rel[i] })).sort((a, b) => b.score - a.score);",
        ].join("\n"),
      },
    },
    filters: [],
    rerank: { use: "none", params: {} },
    select: { use: "top_k", params: { k: 10 } },
    format: { use: "bullets", params: {} },
  };
  p.spec.memory = {
    extract: { use: "whole_turn", params: {} }, // every observation goes into the stream
    // importance: the model rates each memory 1-10 (mundane to poignant)
    classify: { use: "custom", fn: { lang: "llm", code: "On a scale of 1 to 10, where 1 is purely mundane (brushing teeth) and 10 is extremely poignant (a break-up), rate the likely poignancy of this memory. Reply with the number only.\n\nMemory: {{input.text}}", model: "haiku" } },
    merge: { use: "append", params: {} },
    retain: { use: "forever", params: {} },
    // reflection when the importance of recent memories adds up past a threshold
    consolidate: {
      use: "custom",
      fn: {
        lang: "js",
        code: [
          "const since = records.filter((r) => r.meta.created > ctx.vars.last_reflection);",
          "if (since.reduce((s, r) => s + r.meta.importance, 0) < 150) return records;",
          "const questions = await ctx.llm('Given only the statements below, what are 3 most salient high-level questions we can answer about the subjects?', since.slice(-100));",
          "const insights = (await ctx.llm('What 5 high-level insights can you infer from these statements? One per line.', await ctx.retrieve(questions))).split('\\n').filter(Boolean);",
          "ctx.vars.last_reflection = ctx.now;",
          "return [...records, ...insights.map((text) => ({ text, type: 'reflection', meta: { importance: 8, created: ctx.now } }))];",
        ].join("\n"),
      },
    },
  };
  return p;
}

function build(): SystemDoc {
  const b = new Builder(
    "Generative Agents",
    "Three residents of a small town share one environment. Each has a private memory stream: observations are stored with an importance score, retrieved by recency + importance + relevance, and periodically reflected into higher-level insights; each day starts with a plan.",
  );
  const resident = (id: string, x: number, name: string, seed: string) =>
    b.agent(id, x, 0, {
      name,
      role: seed,
      model: "sonnet",
      triggers: ["on_schedule", "on_state", "on_message"],
      harness: { ...native(), instructions: `You are ${name}. ${seed} Act in the town; react to what you observe.` },
      hooks: {
        on_start: { lang: "llm", code: "Write {{agent.name}}'s plan for today in broad strokes (5-8 items), then decompose the next hour into 5-15 minute actions.", model: "sonnet" },
        after_tool: { lang: "js", code: "// observations of the world are what the memory stream records\nctx.observe(event.result);\nreturn event;" },
      },
    });
  resident("isabella", 0, "Isabella", "Owns the café and is planning a Valentine's Day party.");
  resident("klaus", 340, "Klaus", "A student writing a research paper on gentrification.");
  resident("maria", 680, "Maria", "A student who has a crush on Klaus.");
  b.room("town", 340, 260, "Smallville", { policy: "free", history: "since_join" });
  b.doc.nodes.push({ id: "memory", position: { x: 700, y: 260 }, data: memoryStream() });
  for (const id of ["isabella", "klaus", "maria"]) {
    b.edge(id, "town", "access");
    b.edge(id, "memory", "access", { access: "read_write", binding: { mode: "auto_inject", read: { budget_tokens: 3000 }, write: { when: "after_turn" } } });
  }
  b.doc.budget = { usd: 10, max_rounds: 200, wallclock_min: 120 };
  b.doc.termination = ["budget_exceeded", "max_rounds"];
  return b.doc;
}

export const generativeAgents: TemplateInfo = {
  id: "paper-generative-agents",
  name: "Generative Agents",
  summary: "memory stream · recency + importance + relevance · reflection · planning",
  build,
  paper: { title: "Generative Agents: Interactive Simulacra of Human Behavior", authors: "Park et al.", year: 2023, url: "https://arxiv.org/abs/2304.03442" },
  notes: {
    mapped: [
      "The memory stream is one memory plugin with per-agent scope. Its retrieval fuses recency (0.995 decay per hour), importance and relevance with equal weights in a custom fuse step.",
      "Importance is a custom classify step (an LLM rates each memory 1-10); reflection is a custom consolidate step triggered when recent importance sums past 150.",
      "Planning is an on_start hook whose plan stays in the agent's context; observations are written by an after_tool hook (ctx.observe); the town is a shared room env.",
    ],
    differs: [
      "The town's spatial world (sandbox map, objects, movement) is a room env here; the paper's environment tree is not modelled.",
      "Agents act in turns of conversation in the room rather than on a game clock; the day plan from on_start stays in each agent's context for the run.",
    ],
  },
};
