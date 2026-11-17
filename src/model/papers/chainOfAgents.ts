// Chain-of-Agents: a long input is cut into chunks; workers read them in
// order, each passing on a short note of what matters for the question; a
// manager answers from the last note. No one ever holds the whole text.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

// the chain itself is plain code: split, pass the note along, hand it to the manager
const CHAIN = `const text = String(ctx.task);
const split = text.indexOf("\\n---\\n");
const question = split > 0 ? text.slice(0, split).trim() : "Summarise the document.";
const doc = split > 0 ? text.slice(split + 5) : text;
const size = ctx.vars.chunk_chars ?? 3000;
const chunks = [];
for (let i = 0; i < doc.length; i += size) chunks.push(doc.slice(i, i + size));
emit("split", chunks.length + " chunks of up to " + size + " characters");
let note = "(nothing yet)";
for (let i = 0; i < chunks.length; i++) {
  note = await tools.call_agent("Worker", "Question: " + question + "\\n\\nNotes so far:\\n" + note + "\\n\\nPart " + (i + 1) + " of " + chunks.length + ":\\n" + chunks[i]);
  emit("note after part " + (i + 1), note.slice(0, 300));
}
return await tools.call_agent("Manager", "Question: " + question + "\\n\\nNotes from reading the whole document:\\n" + note);`;

function build(): SystemDoc {
  const b = new Builder(
    "Chain-of-Agents",
    "For inputs longer than one context. The document is cut into parts; a worker reads them one after another, each time updating a short note of everything that bears on the question; the manager answers from the final note. Give the question, a line with ---, then the document.",
  );
  b.node("reader", "human", 0, 100, { name: "Reader", role: "Asks a question about a long document", approves: false })
    .agent("chain", 280, 100, { name: "Chain", role: "Splits the document and passes the note along", model: "haiku", harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: CHAIN }, instructions: "Run the chain." } })
    .agent("worker", 580, 20, {
      name: "Worker",
      role: "Reads one part",
      model: "haiku",
      // each part is read fresh: the notes carry what came before, not the worker's own history
      context: { budget_total: 20000, history_strategy: "window", history_window: 2, mask_tool_output: false },
      harness: {
        ...native(),
        loop: "single_shot",
        instructions:
          "You read one part of a long document to help answer a question. The notes are evidence for that question only — not a summary of the document. From this part, add only what bears on the question, quoting the exact sentences that answer any piece of it. Keep the evidence the earlier notes already found. Leave out everything else, however interesting. If this part says nothing about the question, return the notes unchanged. Reply with the notes only.",
      },
    })
    .agent("manager", 580, 200, { name: "Manager", role: "Answers from the notes", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Answer the question from the notes, which were taken while reading the whole document. Say so if the notes do not contain the answer." } })
    .edge("reader", "chain", "message", { label: "Question --- document" })
    .edge("chain", "reader", "message", { label: "Answer" })
    .edge("chain", "worker", "call")
    .edge("chain", "manager", "call");
  b.doc.budget = { usd: 1, max_rounds: 60, wallclock_min: 20 };
  return b.doc;
}

export const chainOfAgents: TemplateInfo = {
  id: "paper-chain-of-agents",
  name: "Chain-of-Agents",
  summary: "long input · workers read parts in sequence · a passed-on note · manager answers",
  build,
  paper: { title: "Chain of Agents: Large Language Models Collaborating on Long-Context Tasks", authors: "Zhang et al.", year: 2024, url: "https://arxiv.org/abs/2406.02818" },
  notes: {
    mapped: [
      "The chain is a custom loop: it cuts the document into parts and calls a worker on each in order, passing the communication unit (the note) from one to the next — the paper's worker chain.",
      "The worker keeps almost no history of its own (a window of two messages), so each part is read with only the note behind it, as a fresh worker in the paper would.",
      "The manager answers from the final note alone, never seeing the document.",
    ],
    differs: [
      "One worker agent reads every part in turn; the paper uses a separate worker per part. The effect is the same because the note, not the worker's memory, carries the context.",
      "Parts are cut by length in characters (3000 by default, ctx.vars.chunk_chars), not by tokens.",
    ],
  },
};
