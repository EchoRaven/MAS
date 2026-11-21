// FrugalGPT, the LLM cascade: a cheap model answers; a scorer rates how
// likely that answer is right; only below a threshold does the question go
// to a strong (dear) model. What it buys is the strong model's accuracy at
// the cheap model's price, on the questions the cheap one can do. The
// cascade is a function calling the three roles with ctx.call.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const CASCADE = `const question = String(input?.text ?? input ?? "");
const threshold = Math.max(0, Math.min(10, Number(ctx.vars.threshold ?? 8)));
const ask = "Solve the question. Show your working briefly, then end with a last line 'Answer: X'.\\n\\nQuestion:\\n" + question;
const cheap = await ctx.call("Cheap", ask);
const verdict = await ctx.call("Scorer", "Question:\\n" + question + "\\n\\nA proposed answer, with its working:\\n" + cheap + "\\n\\nCheck the working. How likely is the final answer to be exactly right? Reply with a short reason, then a last line 'Score: N' where N is 0 (surely wrong) to 10 (surely right).");
const m = /score:\\s*\\**\\s*(\\d+(?:\\.\\d+)?)/i.exec(verdict);
const score = m ? Number(m[1]) : 0;
ctx.log("cheap answer scored " + score + " (threshold " + threshold + ")" + (score >= threshold ? ": accepted" : ": passed to the strong model"));
if (score >= threshold) return cheap;
return await ctx.call("Strong", ask);`;

function build(): SystemDoc {
  const b = new Builder(
    "FrugalGPT (cascade)",
    "A cheap model answers; a scorer (the cheap model again) rates how likely the answer is right, 0 to 10; at or above the run variable threshold (8 unless set) it is accepted, below it the question goes to the strong model. Map the cheap and strong slots to the models you compare (for example haiku → a light model, opus → a strong one).",
  );
  const role = (id: string, name: string, model: string, x: number, y: number, system: string) =>
    b.node(id, "model", x, y, { name, model, system_prompt: system, prompt: "{{input}}", temperature: null, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
  b.node("asker", "human", 0, 160, { name: "Asker", role: "Poses the question", approves: false }).node("cascade", "function", 280, 160, {
    name: "Cascade",
    join: "any",
    fn: { lang: "js", code: CASCADE, timeout_ms: 1_200_000 },
    interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] },
  });
  role("cheap", "Cheap", "haiku", 580, 20, "You answer questions carefully and concisely.");
  role("scorer", "Scorer", "haiku", 580, 160, "You judge whether a proposed answer is right by checking its working. You are calibrated: a high score means you checked it and found no error.");
  role("strong", "Strong", "opus", 580, 300, "You answer questions carefully and concisely.");
  b.edge("asker", "cascade", "message", { label: "Question" })
    .edge("cascade", "cheap", "call", { label: "First try" })
    .edge("cascade", "scorer", "call", { label: "Score it" })
    .edge("cascade", "strong", "call", { label: "If doubtful" })
    .edge("cascade", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 1, max_rounds: 10, wallclock_min: 15 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  b.doc.result = { type: "text", description: "the accepted answer, ending with 'Answer: X'" };
  return b.doc;
}

export const frugalgpt: TemplateInfo = {
  id: "paper-frugalgpt",
  name: "FrugalGPT (cascade)",
  summary: "cheap model first · a scorer accepts or escalates · strong model only when in doubt",
  build,
  paper: { title: "FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance", authors: "Chen et al.", year: 2023, url: "https://arxiv.org/abs/2305.05176" },
  notes: {
    mapped: [
      "The cascade is a function: the Cheap model answers, the Scorer rates the answer 0 to 10, and below the threshold (the run variable threshold, 8 by default) the Strong model answers instead (ctx.call).",
      "Cheap and Scorer share the light model slot and Strong the dear one, so an evaluation maps them to the two models it compares.",
    ],
    differs: [
      "The paper's scorer is a small model trained on each task to predict whether an answer is right, and its cascades are learned over many APIs; here the scorer is the cheap model prompted to check the working, and the cascade has two steps.",
      "The paper also adapts prompts and caches answers to save more; this template is the cascade alone.",
    ],
  },
};
