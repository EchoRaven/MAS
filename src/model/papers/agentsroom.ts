// Agents' Room: a story written by specialists around a shared scratchpad.
// Planning agents (conflict, characters, setting, plot) write notes; writing
// agents each write one part of the narrative arc from those notes; an
// orchestrator decides who works next and puts the story together.
import { Builder, native, type TemplateInfo } from "../builder";
import { autoLayout } from "../layout";
import type { SystemDoc } from "../types";

const PLANNERS = [
  ["conflict", "Conflict", "the central conflict: what the protagonist wants, what stands in the way, and what is at stake"],
  ["character", "Characters", "the main characters: who they are, what each wants, and how they change"],
  ["setting", "Setting", "the setting: place, time, and the details that make it vivid"],
  ["plot", "Plot", "the plot: the key events in order, from the opening to the ending"],
] as const;

const WRITERS = [
  ["exposition", "Exposition", "the opening: introduce the setting and characters and hint at the conflict"],
  ["rising", "Rising action", "the rising action: complications build and tension grows"],
  ["climax", "Climax", "the climax: the turning point where the conflict comes to a head"],
  ["falling", "Falling action", "the falling action: the consequences of the climax unfold"],
  ["resolution", "Resolution", "the resolution: how things end, and what has changed"],
] as const;

const ORCHESTRATOR = `You run a writers' room. The task is a story the user asked for.
1. Call each planning agent once, in this order: ${PLANNERS.map(([id]) => `ask_${id}`).join(", ")}. Each writes its notes to the scratchpad.
2. Then call each writing agent once, in this order: ${WRITERS.map(([id]) => `ask_${id}`).join(", ")}. Each writes its part of the story to the scratchpad.
Give each agent the user's request in your call. If a part comes back weak or inconsistent with the notes, call that agent again with what to fix.
3. Finally reply with the whole story: the five parts in order, as continuous prose, with no headings or notes.`;

function build(): SystemDoc {
  const b = new Builder(
    "Agents' Room",
    "A story written by a room of specialists. Four planning agents (conflict, characters, setting, plot) write notes to a shared scratchpad; five writing agents each write one part of the narrative arc from those notes; an orchestrator calls them in turn and assembles the story.",
  );
  b.node("user", "human", 0, 0, { name: "User", role: "Asks for a story", approves: false })
    .agent("orchestrator", 0, 0, { name: "Orchestrator", role: "Decides who works next and assembles the story", model: "opus", harness: { ...native(), loop: "react", max_steps: 16, instructions: ORCHESTRATOR } })
    .plugin("scratchpad", "workspace", 0, 0, { name: "Scratchpad", scope: "system", sources: ["/story-room"] })
    .edge("user", "orchestrator", "message", { label: "Story request" })
    .edge("orchestrator", "user", "message", { label: "Story" })
    .edge("orchestrator", "scratchpad", "access", { access: "read_write" });
  for (const [id, name, what] of PLANNERS) {
    b.agent(id, 0, 0, {
      name: `${name} planner`,
      role: `Plans ${what.split(":")[0]}`,
      model: "sonnet",
      harness: { ...native(), loop: "react", max_steps: 4, instructions: `You plan ${what}. Read what the other planners have already written in the scratchpad (list_files, read_file) and stay consistent with it. Write your notes, at most 200 words, with write_file to notes/${id}.md, then reply with a one-line summary.` },
    })
      .edge("orchestrator", id, "call")
      .edge(id, "scratchpad", "access", { access: "read_write" });
  }
  WRITERS.forEach(([id, name, what], i) => {
    b.agent(id, 0, 0, {
      name: `${name} writer`,
      role: `Writes ${what.split(":")[0]}`,
      model: "sonnet",
      harness: { ...native(), loop: "react", max_steps: 6, instructions: `You write ${what}. First read the notes (notes/*.md) and the parts already written (story/*.md) in the scratchpad, so your part follows on from them. Write your part, 150-300 words of prose, with write_file to story/${i + 1}-${id}.md, then reply with the text you wrote.` },
    })
      .edge("orchestrator", id, "call")
      .edge(id, "scratchpad", "access", { access: "read_write" });
  });
  b.doc.budget = { usd: 3, max_rounds: 60, wallclock_min: 20 };
  return autoLayout(b.doc);
}

export const agentsroom: TemplateInfo = {
  id: "paper-agents-room",
  name: "Agents' Room",
  summary: "planning and writing specialists · a shared scratchpad · an orchestrator that calls them in turn",
  build,
  paper: { title: "Agents' Room: Narrative Generation through Multi-step Collaboration", authors: "Huot et al.", year: 2024, url: "https://arxiv.org/abs/2410.02603" },
  notes: {
    mapped: [
      "The scratchpad is a workspace plugin every agent can read and write: planners leave notes in notes/, writers leave their parts in story/, and each reads what the others wrote before working.",
      "The paper's planning agents (conflict, character, setting, plot) and writing agents (one per part of Freytag's pyramid: exposition, rising action, climax, falling action, resolution) are agents reached through call edges, so to the orchestrator each one is a tool (ask_conflict, ask_climax, …).",
      "The orchestrator is a ReAct agent: it calls the agents in turn, can send one back with corrections, and assembles the five parts into the story.",
    ],
    differs: [
      "The paper studies both a fixed order and a trained orchestrator that picks the next agent; here the orchestrator is prompted with the fixed order and may repeat an agent when a part needs fixing.",
      "The paper's agents are fine-tuned on synthetic data for each role; here every role is a prompted general model.",
    ],
  },
};
