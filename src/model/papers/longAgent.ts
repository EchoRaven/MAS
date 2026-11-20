// LongAgent: a leader splits a long document among members who read their
// parts at the same time and report what bears on the question; the leader
// puts the reports together. Map and reduce, where Chain-of-Agents relays one
// note from part to part. The split and the parallel calls are a function
// calling the two roles with ctx.call.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const TEAM = `const text = String(input?.text ?? input ?? "");
const split = text.indexOf("\\n---\\n");
const question = split > 0 ? text.slice(0, split).trim() : "Summarise the document.";
const doc = split > 0 ? text.slice(split + 5) : text;
const size = Math.max(500, Number(ctx.vars.chunk_chars ?? 6000) || 6000);
// cut at line ends, so that no record is split between two members
const parts = [];
let cur = "";
for (const line of doc.split("\\n")) {
  if (cur && cur.length + line.length + 1 > size) { parts.push(cur); cur = ""; }
  cur += (cur ? "\\n" : "") + line;
}
if (cur) parts.push(cur);
ctx.log(parts.length + " parts of up to " + size + " characters, read at the same time");
// every member reads its own part at once
const reports = await Promise.all(parts.map((p, i) => ctx.call("Member", "Question: " + question + "\\n\\nYou have part " + (i + 1) + " of " + parts.length + " of the document; other members have the rest. Report only what in YOUR part bears on the question, quoting each relevant line exactly as written. If nothing does, reply: NOTHING.\\n\\nYour part:\\n" + p)));
const heard = reports.map((r, i) => "## Member " + (i + 1) + " (part " + (i + 1) + ")\\n" + r).join("\\n\\n");
return await ctx.call("Leader", "Question: " + question + "\\n\\nYour members each read one part of the document (the parts do not overlap) and reported what bears on the question:\\n\\n" + heard + "\\n\\nAnswer the question from their reports. Show the working, then end with a last line 'Answer: X'.");`;

function build(): SystemDoc {
  const b = new Builder(
    "LongAgent",
    "For inputs longer than one context. A leader cuts the document into parts (6,000 characters unless the run variable chunk_chars says otherwise); a member reads each part, all at the same time, and reports the lines that bear on the question; the leader answers from the reports. Give the question, a line with ---, then the document.",
  );
  const role = (id: string, name: string, x: number, y: number, system: string) =>
    b.node(id, "model", x, y, { name, model: "sonnet", system_prompt: system, prompt: "{{input}}", temperature: null, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
  b.node("reader", "human", 0, 100, { name: "Reader", role: "Asks a question about a long document", approves: false }).node("team", "function", 280, 100, {
    name: "Leader's split",
    join: "any",
    fn: { lang: "js", code: TEAM, timeout_ms: 1_200_000 },
    interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] },
  });
  role("member", "Member", 580, 20, "You are a member of a team reading a long document together. You read one part and report, exactly, what in it bears on the question; you do not guess about the parts you have not seen.");
  role("leader", "Leader", 580, 200, "You lead a team that read a long document in parts. You answer the question from your members' reports, carefully, and say if they do not contain the answer.");
  b.edge("reader", "team", "message", { label: "Question --- document" })
    .edge("team", "member", "call", { label: "One part each" })
    .edge("team", "leader", "call", { label: "Reports" })
    .edge("team", "reader", "message", { label: "Answer" });
  // every call is a turn: one per part and the leader's
  b.doc.budget = { usd: 2, max_rounds: 80, wallclock_min: 20 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  b.doc.result = { type: "text", description: "the leader's answer, ending with 'Answer: X'" };
  return b.doc;
}

export const longAgent: TemplateInfo = {
  id: "paper-longagent",
  name: "LongAgent",
  summary: "long input · members read parts at the same time · the leader puts their reports together",
  build,
  paper: { title: "LongAgent: Scaling Language Models to 128k Context through Multi-Agent Collaboration", authors: "Zhao et al.", year: 2024, url: "https://arxiv.org/abs/2402.11550" },
  notes: {
    mapped: [
      "The leader's split is a function: it cuts the document at line ends into parts and calls a Member model on each, all at once (ctx.call); the Leader model answers from the members' reports.",
      "Each member reports only the lines of its own part that bear on the question, quoted exactly, so the leader works from evidence rather than from summaries.",
    ],
    differs: [
      "The paper's leader directs members over several rounds and resolves conflicting answers by having members share what they found; here one round, since members reading separate parts of an aggregation question cannot contradict each other.",
      "The paper's members are fine-tuned 7B models; here every role is the same general model.",
    ],
  },
};
