// CRITIC on math (program synthesis): the model writes Python whose variable `answer` is the result; the code runs;
// then it is shown the question, the code, the interpreter's report (Done or the error) and the output, asked "What's
// the problem with the above code?", and writes a better solution, which runs in turn. At most four corrections,
// stopping once the executed result stays the same for two revisions in a row. With the run variable tool=false the
// critic sees no execution report or output (the paper's "CRITIC w/o Tool"); the answer still comes from running it.
import { Builder, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

// the head of the authors' prompts/gsm8k/pot.md, and their critic and revision cues (src/program/critic.py)
const POT = "# Write Python Code to solve the following questions. Store your result as a variable named 'answer'.";

const LOOP = `const question = String(input?.text ?? input ?? "");
const withTool = String(ctx.vars.tool ?? "true") !== "false";
const maxIter = Math.max(0, Math.min(8, Number(ctx.vars.iterations ?? 4)));
// the code of a reply: the first python block, else the reply up to a closing fence
const codeOf = (s) => {
  const m = /\\\`\\\`\\\`(?:python|py)?[^\\n]*\\n([\\s\\S]*?)(?:\\\`\\\`\\\`|$)/.exec(s);
  return (m ? m[1] : s.split("\\\`\\\`\\\`")[0]).trim();
};
// run it: the report is Done or the error's last line, the prediction what 'answer' holds
// (a sandbox that cannot run at all is reported once and the loop ends: there is nothing to criticise against)
let noSandbox = "";
const run = async (code) => {
  let out = "";
  try {
    await ctx.tool("edit_file", { path: "main.py", content: code + "\\n\\ntry:\\n    print('__ANSWER__=' + repr(answer))\\nexcept NameError:\\n    print('__ANSWER__=None')\\n" });
    out = String(await ctx.tool("bash", { command: "timeout 10 python3 main.py 2>&1 | tail -c 3000" }));
  } catch (e) {
    noSandbox = String(e?.message ?? e);
    return { report: "the sandbox could not run the code: " + noSandbox, pred: null };
  }
  const m = /__ANSWER__=(.*)/.exec(out);
  if (m && m[1].trim() !== "None") return { report: "Done", pred: m[1].trim() };
  const lines = out.trim().split("\\n").filter(Boolean);
  const err = /Terminated|timed out/i.test(out) ? "TimeoutError: execution timeout" : lines[lines.length - 1] || "no output";
  return { report: err, pred: null };
};
let code = codeOf(String(await ctx.call("Model", ${JSON.stringify(POT)} + "\\n\\nQuestion: " + question + "\\n\\n# Python code, return answer\\n")));
let res = await run(code);
const trail = [String(res.pred)];
let same = 0;
if (noSandbox) ctx.log("no sandbox to run the code (" + noSandbox + "): no corrections");
for (let i = 0; i < (noSandbox ? 0 : maxIter); i++) {
  const shown = "Question: " + question + "\\n\\\`\\\`\\\`python\\n" + code.split("\\n").filter((l) => !/^\\s*#/.test(l)).join("\\n") + "\\n\\\`\\\`\\\`\\n" + (withTool ? "Execution: " + res.report + "\\nOutput: answer = " + res.pred + "\\n" : "") + "\\nWhat's the problem with the above code?\\n";
  const critique = String(await ctx.call("Model", shown)).split(/Here's a better solution/i)[0].trim();
  // the authors' few-shot revisions all store the result in answer; zero-shot, a model prints it instead, and a revision
  // with no answer cannot be taken, so the instruction of their program prompt is repeated before the cue
  const next = codeOf(String(await ctx.call("Model", shown + critique + "\\n\\n# Store your result as a variable named 'answer'.\\nHere's a better solution:\\n\\\`\\\`\\\`python\\n")));
  if (!next || next === code) { trail.push(String(res.pred)); same++; if (same >= 2) break; continue; }
  const r = await run(next);
  const prev = String(res.pred);
  // a revision that leaves no answer (an error, or the result printed but not stored) is not taken: the next round
  // criticises the latest code that gave one, with its own execution, as the authors' code does
  if (r.pred !== null || res.pred === null) {
    res = r;
    code = next;
  } else ctx.log("revision " + (i + 1) + " gave no answer (" + r.report + "): kept the previous code");
  same = String(res.pred) === prev ? same + 1 : 0;
  trail.push(String(res.pred));
  if (same >= 2) break;
}
ctx.log("answers by correction: " + trail.join(" → "));
return "\\\`\\\`\\\`python\\n" + code + "\\n\\\`\\\`\\\`\\n\\nAnswer: " + (res.pred ?? "none");`;

function build(): SystemDoc {
  const b = new Builder(
    "CRITIC (math)",
    "The model writes Python that stores the result in answer; it runs in a sandbox; the model is shown the code, the interpreter's report and the output, asked what is wrong with the code, and writes a better solution, which runs in turn. At most four corrections (the run variable iterations), stopping when the result stays the same twice. tool=false hides the execution from the critic.",
  );
  b.node("asker", "human", 0, 160, { name: "Asker", role: "Asks", approves: false }).node("loop", "function", 280, 160, {
    name: "Write, run, criticise, revise",
    join: "any",
    fn: { lang: "js", code: LOOP, timeout_ms: 900_000 },
    interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] },
  });
  b.node("model", "model", 580, 60, { name: "Model", model: "sonnet", system_prompt: "", prompt: "{{input}}", temperature: 0.5, max_tokens: 4096, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
  b.node("sandbox", "env", 580, 280, { name: "Sandbox", env_kind: "sandbox", image: "python:3.12" });
  b.edge("asker", "loop", "message", { label: "Question" })
    .edge("loop", "model", "call", { label: "Write · criticise · revise" })
    .edge("loop", "sandbox", "access", { access: "read_write" })
    .edge("loop", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 0.5, max_rounds: 40, wallclock_min: 15 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

export const critic: TemplateInfo = {
  id: "paper-critic",
  name: "CRITIC (math)",
  summary: "program of thought · run it · critique with the interpreter's output · revise · ≤4",
  build,
  paper: { title: "CRITIC: Large Language Models Can Self-Correct with Tool-Interactive Critiquing", authors: "Gou et al.", year: 2024, url: "https://arxiv.org/abs/2305.11738" },
  notes: {
    mapped: [
      "The program-of-thought instruction and the critic's form are the authors' (prompts/gsm8k/pot.md, src/program/critic.py): the question, the code without comments, 'Execution: Done' or the error, 'Output: answer = …', then 'What's the problem with the above code?' and 'Here's a better solution:'.",
      "At most four corrections, stopping once the executed result stays the same for two revisions in a row (the paper's rule), at temperature 0.5 as in their script. tool=false is their 'w/o Tool' ablation: the critic sees no execution report or output.",
      "Every correction's executed answer goes into the run log, so changes can be counted.",
    ],
    differs: [
      "Zero-shot: the authors prompt with few-shot examples of programs and critiques, which are not copied here. Their examples' revisions all store the result in answer; zero-shot, nine revisions in ten printed it instead and could not be taken, so the revision prompt repeats their program instruction ('Store your result as a variable named 'answer'.') before 'Here's a better solution:'.",
      "Their code runs all four corrections without the stopping rule the paper states; this follows the paper.",
      "Replies are capped at 4,096 tokens where their calls use 500 and 400, room for a reasoning model.",
    ],
  },
};
