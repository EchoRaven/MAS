// MedAgents: zero-shot medical reasoning by a panel. Gather the specialties
// the question needs, have each expert analyse it, summarise their analyses
// into one report, then consult: every expert votes on the report and the
// report is revised with the dissenters' advice until all agree. A final
// decision is made from the agreed report.
import { Builder, native, type TemplateInfo } from "../builder";
import { autoLayout } from "../layout";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const SEATS = ["e1", "e2", "e3"] as const;
const FALLBACK = ["Internal Medicine", "Pharmacology", "Pathology"];

// expert gathering: a model names the specialties; each expert is told which one it is
const GATHER = `const question = String(input?.text ?? input);
ctx.vars.question = question;
let domains = [];
try {
  const reply = await ctx.llm("Name the 3 medical specialties whose experts are best placed to answer this question. Reply with JSON only: {\\"domains\\": [\\"...\\", \\"...\\", \\"...\\"]}", question, "sonnet");
  domains = JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1)).domains ?? [];
} catch (e) {
  ctx.log("Could not gather specialties (" + e.message + "); using the defaults");
}
domains = domains.filter((d) => typeof d === "string" && d.trim()).slice(0, 3);
while (domains.length < 3) domains.push(${JSON.stringify(FALLBACK)}[domains.length]);
ctx.vars.domains = domains;
ctx.log("Gathered: " + domains.join(", "));
return Object.fromEntries(${JSON.stringify(SEATS)}.map((s, i) => [s, "You are an expert in " + domains[i] + ".\\n\\nQuestion:\\n" + question]));`;

// individual analyses, labelled by specialty, for the summariser
const ANALYSES = `const d = ctx.vars.domains ?? [];
return "Question:\\n" + ctx.vars.question + "\\n\\n" + ${JSON.stringify(SEATS)}.map((s, i) => "## Analysis by the " + (d[i] ?? s) + " expert\\n" + input[s]).join("\\n\\n");`;

// a consultation round: the current report goes to every expert for a vote
const CONSULT = `ctx.vars.report = String(input?.text ?? input).replace(/^REVISED REPORT:\\s*/i, "");
const d = ctx.vars.domains ?? [];
return Object.fromEntries(${JSON.stringify(SEATS)}.map((s, i) => [s, "You are an expert in " + (d[i] ?? "medicine") + ".\\n\\nQuestion:\\n" + ctx.vars.question + "\\n\\nReport:\\n" + ctx.vars.report]));`;

// count the votes: all yes ends the consultation with the report; otherwise the advice goes to the reviser
const TALLY = `const d = ctx.vars.domains ?? [];
const votes = ${JSON.stringify(SEATS)}.map((s, i) => {
  const t = String(input[s] ?? "");
  return { expert: d[i] ?? s, yes: /vote:\\s*yes/i.test(t), advice: t.replace(/vote:\\s*(yes|no)\\.?/i, "").trim() };
});
const no = votes.filter((v) => !v.yes);
ctx.log("Votes: " + votes.map((v) => v.expert + " " + (v.yes ? "yes" : "no")).join(", "));
if (!no.length) return { agreed: { role: "assistant", text: "AGREED REPORT:\\n" + ctx.vars.report, agreed: true } };
return { revise: "Question:\\n" + ctx.vars.question + "\\n\\nReport:\\n" + ctx.vars.report + "\\n\\nAdvice from the experts who disagree:\\n" + no.map((v) => "- " + v.expert + ": " + v.advice).join("\\n") };`;

function build(): SystemDoc {
  const b = new Builder(
    "MedAgents",
    "A medical question goes to a panel. The specialties it needs are gathered; each expert analyses the question; a summariser writes one report from the analyses; in consultation every expert votes on the report and it is revised with the dissenters' advice until all agree. A decision maker answers from the agreed report.",
  );
  const expertPrompt = "Analyse the question from your specialty: the key facts, what they point to, and how each option (if any) fits or fails. Be concise.";
  const reviewPrompt = "Read the report as an expert in your specialty. If you agree with it, reply 'Vote: yes'. If not, reply 'Vote: no' and say in one or two sentences what should change.";
  b.node("asker", "human", 0, 0, { name: "Clinician", role: "Asks a medical question", approves: false })
    .node("gather", "function", 0, 0, {
      name: "Gather experts",
      fn: { lang: "js", code: GATHER },
      interface: { inputs: [port("in", "message")], outputs: SEATS.map((s) => port(s, "text")) },
    })
    .node("analyses", "function", 0, 0, {
      name: "Collect analyses",
      join: "all",
      fn: { lang: "js", code: ANALYSES },
      interface: { inputs: SEATS.map((s) => port(s, "text", { required: true })), outputs: [port("out", "text")] },
    })
    .agent("summariser", 0, 0, { name: "Summariser", role: "Writes one report from the analyses", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Summarise the experts' analyses into one report: the key knowledge each brings, where they agree, and the answer the report supports. Keep it under 250 words." } })
    .group("consult", 0, 0, {
      name: "Consultation",
      iterate: { max_rounds: 3, until: "output.agreed", feed: "output" },
      interface: { inputs: [port("draft", "message")], outputs: [port("agreed", "message")] },
    })
    .node("consult_fn", "function", 0, 0, { name: "Ask for votes", fn: { lang: "js", code: CONSULT }, interface: { inputs: [port("in", "message")], outputs: SEATS.map((s) => port(s, "text")) } }, "consult")
    .node("tally", "function", 0, 0, {
      name: "Count the votes",
      join: "all",
      fn: { lang: "js", code: TALLY },
      interface: { inputs: SEATS.map((s) => port(s, "text", { required: true })), outputs: [port("agreed", "message"), port("revise", "text")] },
    }, "consult")
    .agent("reviser", 0, 0, { name: "Reviser", role: "Revises the report with the experts' advice", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Revise the report to address the advice. Reply with the revised report only, starting with 'REVISED REPORT:'." } }, "consult")
    .agent("decider", 0, 0, { name: "Decision maker", role: "Answers from the agreed report", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Answer the question from the report: one sentence of why, then a last line 'Answer: X', where X is only the option letter when the question has options, else the answer itself. The last line is the result." } });
  SEATS.forEach((s, i) => {
    b.agent(s, 0, 0, { name: `Expert ${i + 1}`, role: "Analyses from the specialty it is given", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: expertPrompt } });
    b.agent(`r${i + 1}`, 0, 0, { name: `Expert ${i + 1} (review)`, role: "Votes on the report", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: reviewPrompt } }, "consult");
    b.edge("gather", s, "message", { source_port: s })
      .edge(s, "analyses", "message", { target_port: s })
      .edge("consult_fn", `r${i + 1}`, "message", { source_port: s })
      .edge(`r${i + 1}`, "tally", "message", { target_port: s });
  });
  b.edge("asker", "gather", "message", { label: "Question" })
    .edge("analyses", "summariser", "message")
    .edge("summariser", "consult", "message", { label: "Report" })
    .edge("consult", "consult_fn", "message")
    .edge("tally", "consult", "message", { source_port: "agreed" })
    .edge("tally", "reviser", "message", { source_port: "revise" })
    .edge("reviser", "consult", "message")
    .edge("consult", "decider", "message", { label: "Agreed report" })
    .edge("decider", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 40, wallclock_min: 15 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  // positions come from the layout, not by hand
  return autoLayout(b.doc);
}

export const medagents: TemplateInfo = {
  id: "paper-medagents",
  name: "MedAgents",
  summary: "expert gathering · individual analyses · report · voted consultation until agreement · decision",
  build,
  paper: { title: "MedAgents: Large Language Models as Collaborators for Zero-shot Medical Reasoning", authors: "Tang et al.", year: 2023, url: "https://arxiv.org/abs/2311.10537" },
  notes: {
    mapped: [
      "Expert gathering is a function that asks a model (ctx.llm) which three specialties the question needs and tells each expert agent which one it is, so the panel changes per question.",
      "Individual analyses run in parallel; a join-all function labels them by specialty for the summariser, whose report is the paper's report summarisation.",
      "Collaborative consultation is a Group. Each round every expert votes on the current report; a function counts the votes. All yes leaves the group with the report (until: output.agreed); otherwise the dissenters' advice goes to a reviser, and the revised report is the next round's input (feed: output). At most 3 rounds.",
      "A decision maker answers from the agreed report.",
    ],
    differs: [
      "The paper gathers separate experts for the question and for the options; here one set of three covers both.",
      "In the paper the same experts analyse and later vote; here the voters are separate agents told the same specialty, since an agent's output always goes the same way on the canvas.",
      "If the panel never agrees in 3 rounds, the last revised report goes to the decision maker unreviewed.",
    ],
  },
};
