// LLM Discussion: creativity by group brainstorming. Agents with distinct roles answer a creative task, then read each
// other's ideas and build on them over rounds (initiation, discussion, convergence), and the final ideas are gathered.
// The phases are a function calling the roles with ctx.call.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const ROLES: [string, string, string][] = [
  ["engineer", "Engineer", "You are a practical engineer: you think about what an object is made of, its shape, weight and strength, and what it could do because of them."],
  ["artist", "Artist", "You are an artist and designer: you look for unusual, playful and aesthetic uses, and you like surprising combinations."],
  ["futurist", "Futurist", "You are a futurist: you imagine uses in settings far from the everyday, in other times, places and technologies."],
  ["caretaker", "Community organiser", "You are a community organiser: you think about how an object could help people, children, animals or a neighbourhood."],
];

const PHASES = `const task = String(input?.text ?? input ?? "");
const rounds = Math.max(1, Math.min(5, Number(ctx.vars.rounds ?? 3)));
const roles = ${JSON.stringify(ROLES.map(([, name]) => name))};
let ideas = {};
// initiation: each role answers on its own (the roles of a round work at the same time)
const firsts = await Promise.all(roles.map((r) => ctx.call(r, "Task: " + task + "\\n\\nGive your ideas as a numbered list, one short line each.")));
roles.forEach((r, i) => (ideas[r] = String(firsts[i])));
// discussion and convergence: each reads the others' lists and builds on them
for (let k = 1; k < rounds; k++) {
  const last = k === rounds - 1;
  const next = {};
  await Promise.all(roles.map(async (r) => {
    const others = roles.filter((o) => o !== r).map((o) => o + ":\\n" + ideas[o]).join("\\n\\n");
    next[r] = String(await ctx.call(r, "Task: " + task + "\\n\\nYour ideas so far:\\n" + ideas[r] + "\\n\\nThe other members' ideas:\\n" + others + "\\n\\n" + (last ? "This is the last round: give your final list, the best and most original ideas you have now, numbered, one short line each." : "Build on the others: combine, extend or push their ideas further, and add new ones of your own. Give your updated list, numbered, one short line each.")));
  }));
  ideas = next;
}
const all = roles.map((r) => r + ":\\n" + ideas[r]).join("\\n\\n");
return String(await ctx.call("Collector", "Task: " + task + "\\n\\nThe group's final ideas:\\n" + all + "\\n\\nMerge them into one numbered list: keep every distinct idea once, drop repeats, one short line each. Reply with the list only."));`;

function build(): SystemDoc {
  const b = new Builder(
    "LLM Discussion",
    "Creativity by group brainstorming: four agents with different roles answer a creative task, then read each other's ideas and build on them over rounds (the run variable rounds, 3 unless set: initiation, discussion, convergence); a collector merges their final lists.",
  );
  b.node("asker", "human", 0, 200, { name: "Asker", role: "Poses the creative task", approves: false }).node("phases", "function", 280, 200, {
    name: "Discussion",
    join: "any",
    fn: { lang: "js", code: PHASES, timeout_ms: 1_800_000 },
    interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] },
  });
  ROLES.forEach(([id, name, persona], i) =>
    b.node(id, "model", 600, i * 110, { name, model: "sonnet", system_prompt: persona, prompt: "{{input}}", temperature: null, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } }),
  );
  b.node("collector", "model", 600, ROLES.length * 110, { name: "Collector", model: "sonnet", system_prompt: "", prompt: "{{input}}", temperature: null, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
  b.edge("asker", "phases", "message", { label: "Task" });
  for (const [id] of ROLES) b.edge("phases", id, "call");
  b.edge("phases", "collector", "call", { label: "Merge" }).edge("phases", "asker", "message", { label: "Ideas" });
  b.doc.budget = { usd: 2, max_rounds: 40, wallclock_min: 20 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

export const llmDiscussion: TemplateInfo = {
  id: "paper-llm-discussion",
  name: "LLM Discussion",
  summary: "role-played agents brainstorm in rounds · initiation, discussion, convergence · ideas merged",
  build,
  paper: { title: "LLM Discussion: Enhancing the Creativity of Large Language Models via Discussion Framework and Role-Play", authors: "Lu et al.", year: 2024, url: "https://arxiv.org/abs/2405.06373" },
  notes: {
    mapped: [
      "Four agents with distinct roles answer the task on their own (initiation), then read each other's lists and build on them, and in the last round give their final lists (convergence); a function runs the phases with ctx.call.",
      "The number of rounds is the run variable rounds (3 by default).",
    ],
    differs: [
      "The roles here (engineer, artist, futurist, community organiser) are this template's own; the paper assigns roles with backgrounds and personalities, some drawn from the Six Thinking Hats.",
      "A collector merges the final lists into one answer so that it can be judged against a single response; the paper's way of putting the final answer together may differ.",
    ],
  },
};
