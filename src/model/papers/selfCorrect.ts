// Intrinsic self-correction, as "Large Language Models Cannot Self-Correct Reasoning Yet" tests it: the model answers,
// is asked to review its answer and find problems, then to improve it, for at most two rounds, with no feedback from
// outside. The paper finds the answers get worse (GPT-4 on GSM8K 95.5 → 91.5 → 89.0). One model in one conversation;
// the loop is a function, and each round's answer goes into the log so that changes can be counted.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

// the paper's GSM8K prompts (its Appendix A)
const ASK = "Can you solve the following math problem?";
const FORMAT = "Your final answer should be a single numerical number, in the form \\boxed{answer}, at the end of your response.";
const REVIEW = "Review your previous answer and find problems with your answer.";
const IMPROVE = "Based on the problems you found, improve your answer. Please reiterate your answer, with your final answer a single numerical number, in the form \\boxed{answer}.";

const LOOP = `const question = String(input?.text ?? input ?? "");
const rounds = Math.max(0, Math.min(5, Number(ctx.vars.rounds ?? 2)));
// one conversation, re-sent whole each call (the model is a stateless call)
const turns = [{ who: "User", text: ${JSON.stringify(ASK)} + " " + question + " " + ${JSON.stringify(FORMAT)} }];
const render = () => turns.map((t) => "[" + t.who + "]\\n" + t.text).join("\\n\\n") + "\\n\\n[Assistant]\\n";
// the reply alone: a model that goes on to write the user's next turn is cut there
const clean = (s) => { const m = /^\\\\s*\\\\[(?:User|Assistant)\\\\]\\\\s*$/m.exec(s); return (m ? s.slice(0, m.index) : s).trim(); };
const boxed = (s) => { const i = s.lastIndexOf("\\\\boxed{"); if (i < 0) return "?"; let d = 0, j = i + 7; for (; j < s.length; j++) { if (s[j] === "{") d++; else if (s[j] === "}") { if (d === 0) break; d--; } } return s.slice(i + 7, j).trim(); };
let answer = clean(String(await ctx.call("Model", render())));
turns.push({ who: "Assistant", text: answer });
const trail = [boxed(answer)];
for (let r = 0; r < rounds; r++) {
  turns.push({ who: "User", text: ${JSON.stringify(REVIEW)} });
  turns.push({ who: "Assistant", text: clean(String(await ctx.call("Model", render()))) });
  turns.push({ who: "User", text: ${JSON.stringify(IMPROVE)} });
  answer = clean(String(await ctx.call("Model", render())));
  turns.push({ who: "Assistant", text: answer });
  trail.push(boxed(answer));
}
ctx.log("answers by round: " + trail.join(" → "));
return answer;`;

function build(): SystemDoc {
  const b = new Builder(
    "Intrinsic self-correction",
    "One model answers, is asked to review its answer and find problems, then to improve it: two rounds (the run variable rounds), with no feedback from outside. The control from 'Large Language Models Cannot Self-Correct Reasoning Yet'; each round's answer is logged.",
  );
  b.node("asker", "human", 0, 160, { name: "Asker", role: "Asks", approves: false }).node("loop", "function", 280, 160, {
    name: "Answer, review, improve",
    join: "any",
    fn: { lang: "js", code: LOOP, timeout_ms: 900_000 },
    interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] },
  });
  b.node("model", "model", 580, 160, { name: "Model", model: "sonnet", system_prompt: "", prompt: "{{input}}", temperature: null, max_tokens: 4096, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
  b.edge("asker", "loop", "message", { label: "Question" }).edge("loop", "model", "call", { label: "Each turn" }).edge("loop", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 0.5, max_rounds: 20, wallclock_min: 15 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

export const selfCorrect: TemplateInfo = {
  id: "paper-self-correct",
  name: "Intrinsic self-correction",
  summary: "answer · review and find problems · improve · two rounds, no outside feedback",
  build,
  paper: { title: "Large Language Models Cannot Self-Correct Reasoning Yet", authors: "Huang et al.", year: 2024, url: "https://arxiv.org/abs/2310.01798" },
  notes: {
    mapped: [
      "The paper's GSM8K prompts: the question with 'Can you solve the following math problem?' and the \\boxed{} instruction, then 'Review your previous answer and find problems with your answer.', then the improve prompt; two rounds, five calls.",
      "The answer is the last improved response; every round's boxed answer goes into the run log ('answers by round: 12 → 12 → 15'), so right-to-wrong and wrong-to-right changes can be counted.",
    ],
    differs: [
      "The conversation is re-sent as text each call ([User] / [Assistant] turns) rather than as chat messages; the content is the same.",
      "Replies are capped at 4,096 tokens; the paper does not say.",
      "Only the math prompts are built in; CommonSenseQA's ask for a letter instead.",
    ],
  },
};
