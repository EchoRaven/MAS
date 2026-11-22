// Meta-Prompting: one model conducts. Given the question with the Meta-Expert instruction, it writes either a call to
// an expert ("Expert Mathematician:" and an instruction in triple quotes) or a final answer (">> FINAL ANSWER:" and
// the answer in triple quotes). Each expert is a fresh instance of the same model that sees only that instruction;
// its output goes back to the conductor with a prompt to verify, for at most fifteen rounds. The loop is a function
// calling the two roles; the prompts are the authors' (github.com/suzgunmirac/meta-prompting, MIT), without the
// Python expert.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

/** prompts/meta-prompting-with-no-python-expert-instruction.txt, verbatim */
export const META_EXPERT = `You are Meta-Expert, an extremely clever expert with the unique ability to collaborate with multiple experts (such as Expert Problem Solver, Expert Mathematician, Expert Essayist, etc.) to tackle any task and solve any complex problems. Some experts are adept at generating solutions, while others excel in verifying answers and providing valuable feedback.

As Meta-Expert, your role is to oversee the communication between the experts, effectively using their skills to answer a given question while applying your own critical thinking and verification abilities.

To communicate with a expert, type its name (e.g., "Expert Linguist" or "Expert Puzzle Solver"), followed by a colon ":", and then provide a detailed instruction enclosed within triple quotes. For example:

Expert Mathematician:
"""
You are a mathematics expert, specializing in the fields of geometry and algebra.
Compute the Euclidean distance between the points (-2, 5) and (3, 7).
"""

Ensure that your instructions are clear and unambiguous, and include all necessary information within the triple quotes. You can also assign personas to the experts (e.g., "You are a physicist specialized in...").

Interact with only one expert at a time, and break complex problems into smaller, solvable tasks if needed. Each interaction is treated as an isolated event, so include all relevant details in every call.

If you or an expert finds a mistake in another expert's solution, ask a new expert to review the details, compare both solutions, and give feedback. You can request an expert to redo their calculations or work, using input from other experts. Keep in mind that all experts, except yourself, have no memory! Therefore, always provide complete information in your instructions when contacting them. Since experts can sometimes make errors, seek multiple opinions or independently verify the solution if uncertain. Before providing a final answer, always consult an expert for confirmation. Ideally, obtain or verify the final solution with two independent experts. However, aim to present your final answer within 15 rounds or fewer.

Refrain from repeating the very same questions to experts. Examine their responses carefully and seek clarification if required, keeping in mind they don't recall past interactions.

Present the final answer as follows:
>> FINAL ANSWER:
"""
[final answer]
"""

For multiple-choice questions, select only one option. Each question has a unique answer, so analyze the provided information carefully to determine the most accurate and appropriate response. Please present only one solution if you come across multiple options.`;

const LOOP = `const question = String(input?.text ?? input ?? "");
const META = ${JSON.stringify(META_EXPERT)};
const SUFFIX = "\\n\\nLet's first come up with a list of experts you may want to consult for this problem and then immediately start solving it.";
const FEEDBACK = "Based on the information given, what are the most logical next steps or conclusions? Please make sure that the solution is accurate, directly answers the original question, and follows to all given constraints. Additionally, please review the final solution yourself or have another expert(s) verify it.";
const ERROR = "If you have determined the final answer, please present it using the format below:\\n\\n>> FINAL ANSWER:\\n\\"\\"\\"\\n[final answer]\\n\\"\\"\\"";
const rounds = Math.max(1, Math.min(30, Number(ctx.vars.rounds ?? 15)));
// the conversation so far, as alternating turns; the conductor reads it whole each round (it is a stateless call)
const turns = [{ who: "User", text: META + "\\n\\nQuestion: " + question + SUFFIX }];
const render = () => turns.map((t) => (t.who === "User" ? "[User]\\n" : "[Meta-Expert]\\n") + t.text).join("\\n\\n") + "\\n\\n[Meta-Expert]\\n";
let last = "";
for (let r = 0; r < rounds; r++) {
  if (r === rounds - 1) turns[turns.length - 1].text += "\\n\\nThis is the last round; so, please present your final answer.";
  last = String(await ctx.call("Meta-Expert", render()));
  turns.push({ who: "Meta", text: "ROUND " + (r + 1) + ":\\n\\n" + last });
  const fin = /(?:>>\\s*)?FINAL ANSWER:\\s*"""([\\s\\S]*?)"""/.exec(last) || /(?:>>\\s*)?FINAL ANSWER:\\s*([^\\n]+)/.exec(last);
  if (fin) {
    ctx.log("final answer in round " + (r + 1));
    return "Answer: " + fin[1].trim();
  }
  const call = /Expert ((?:\\w+ ?){1,5}):\\s*\\n\\s*"""([\\s\\S]*?)"""/.exec(last);
  if (call) {
    const name = "Expert " + call[1].trim();
    ctx.log("round " + (r + 1) + ": " + name);
    const said = String(await ctx.call("Expert", call[2].trim()));
    turns.push({ who: "User", text: name + "'s output:\\n\\"\\"\\"\\n" + said + "\\n\\"\\"\\"\\n\\n" + FEEDBACK });
  } else {
    turns.push({ who: "User", text: ERROR });
  }
}
ctx.log("no final answer in " + rounds + " rounds: the last message is the answer");
return last;`;

function build(): SystemDoc {
  const b = new Builder(
    "Meta-Prompting",
    "One model conducts: with the Meta-Expert instruction it either calls an expert by name with an instruction in triple quotes, or gives the final answer. Each expert is a fresh call to the same model that sees only that instruction, and its output goes back to the conductor with a prompt to verify. At most fifteen rounds (the run variable rounds).",
  );
  b.node("asker", "human", 0, 160, { name: "Asker", role: "Asks", approves: false }).node("loop", "function", 280, 160, {
    name: "Conductor loop",
    join: "any",
    fn: { lang: "js", code: LOOP, timeout_ms: 1_800_000 },
    interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] },
  });
  const sys = "You are an AI assistant that helps people find information.";
  b.node("meta", "model", 580, 60, { name: "Meta-Expert", model: "sonnet", system_prompt: sys, prompt: "{{input}}", temperature: 0.1, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
  b.node("expert", "model", 580, 260, { name: "Expert", model: "sonnet", system_prompt: sys, prompt: "{{input}}", temperature: 0.1, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
  b.edge("asker", "loop", "message", { label: "Question" })
    .edge("loop", "meta", "call", { label: "Next step" })
    .edge("loop", "expert", "call", { label: "Ask an expert" })
    .edge("loop", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 2, max_rounds: 40, wallclock_min: 30 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

export const metaPrompting: TemplateInfo = {
  id: "paper-meta-prompting",
  name: "Meta-Prompting",
  summary: "one model conducts · calls fresh instances of itself as experts · verifies · ≤15 rounds",
  build,
  paper: { title: "Meta-Prompting: Enhancing Language Models with Task-Agnostic Scaffolding", authors: "Suzgun & Kalai", year: 2024, url: "https://arxiv.org/abs/2401.12954" },
  notes: {
    mapped: [
      "The Meta-Expert instruction, the suffix asking for a list of experts, the feedback after each expert's output, the reminder when a message has neither a call nor an answer, and the last-round note are the authors' text (their repository, MIT).",
      "Each expert is a fresh call to the same model with only the conductor's instruction, as in the paper: experts have no memory. The conductor and the experts use the generic system message of the authors' configuration and temperature 0.1.",
      "The final answer is the text in triple quotes after '>> FINAL ANSWER:', returned as 'Answer: …' for the graders.",
    ],
    differs: [
      "No Python expert: this is the paper's 'Meta −Py' setting. Its large gains (Game of 24, word sorting at 99.6%) came with the interpreter.",
      "The conductor is a stateless call that reads the whole conversation, rendered as [User] / [Meta-Expert] turns, each round, rather than a chat with message history. The content is the same.",
      "The authors' code caps each reply at 1,024 tokens; the models here use their own limits.",
    ],
  },
};
