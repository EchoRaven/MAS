// Magentic-One: an Orchestrator with a task ledger (outer loop) and a
// progress ledger (inner loop) directing specialist agents.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

const ORCHESTRATOR_LOOP = `// Outer loop: task ledger (facts, guesses, plan). Inner loop: progress ledger.
const team = "WebSurfer (reads web pages), FileSurfer (reads local files), Coder (writes Python), ComputerTerminal (runs code it is given). A result that needs computing counts only once ComputerTerminal has run the code and reported its output";
let ledger = await model.json("Survey the task: verified facts, facts to look up, facts to derive, educated guesses. Then a step-by-step plan for this team: " + team, { task: ctx.task });
let stalls = 0;
const max_rounds = ctx.vars.max_rounds ?? 10;
for (let round = 1; ; round++) {
  if (round > max_rounds) return model.call("You are out of rounds. Write the best final answer you can from what the team found.", { task: ctx.task, history: ctx.history });
  const progress = await model.json(
    "Update the progress ledger. Answer as JSON: is_request_satisfied (true only if the history already holds the complete answer), is_in_loop, is_progress_being_made, next_speaker (one of WebSurfer, FileSurfer, Coder, ComputerTerminal), instruction_or_question (everything that speaker needs, e.g. the full code to run)",
    { task: ctx.task, team, ledger, history: ctx.history },
  );
  if (progress.is_request_satisfied) return model.call("Write the final answer to the task, using only what the team found.", { task: ctx.task, history: ctx.history });
  stalls = progress.is_progress_being_made && !progress.is_in_loop ? 0 : stalls + 1;
  if (stalls >= 3) {
    // re-plan: update facts and guesses from what was learned, write a new plan
    ledger = await model.json("Update the facts and guesses from what was learned, then write a new plan.", { task: ctx.task, ledger, history: ctx.history });
    stalls = 0;
    continue;
  }
  emit("next: " + progress.next_speaker, progress.instruction_or_question);
  await tools.call_agent(progress.next_speaker, progress.instruction_or_question);
}`;

function build(): SystemDoc {
  const b = new Builder(
    "Magentic-One",
    "A generalist team: the Orchestrator keeps a task ledger (facts, guesses, plan) and a progress ledger, picks who acts next, and re-plans when progress stalls. Specialists browse the web, read files, write code and execute it.",
  );
  b.node("user", "human", 0, 140, { name: "User", role: "Sets the task", approves: true })
    .agent("orchestrator", 260, 130, {
      name: "Orchestrator",
      role: "Plans, tracks progress, re-plans",
      model: "opus",
      harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: ORCHESTRATOR_LOOP }, instructions: "Lead the team to complete the task." },
      hooks: { before_tool: { lang: "js", code: "// irreversible actions (purchases, sending messages) wait for the user\nif (event.tool.effect === 'irreversible') return ctx.ask_human(event);\nreturn event;" } },
    })
    .agent("websurfer", 640, -80, { name: "WebSurfer", role: "Operates a browser", model: "sonnet", tools: ["browser"], harness: { ...native(), instructions: "Navigate, click, type, scroll and read pages; report what you see." } })
    .agent("filesurfer", 640, 90, { name: "FileSurfer", role: "Reads local files", model: "sonnet", harness: { ...native(), instructions: "Open and read files of any type; navigate folders." } })
    .agent("coder", 640, 260, { name: "Coder", role: "Writes code", model: "opus", harness: { ...native(), loop: "single_shot", instructions: "Write Python or shell code that solves the step; another agent runs it." } })
    .agent("terminal", 640, 430, { name: "ComputerTerminal", role: "Runs code (no model)", tools: ["bash"], harness: { ...native(), tier: "process", runner: "custom-stdio", loop: undefined, command: "python executor.py --sandbox", instructions: "" } })
    .node("browser", "env", 1000, -70, { name: "Browser", env_kind: "browser", image: "" })
    .plugin("files", "workspace", 1000, 100, { name: "Files", scope: "system", sources: ["/task"] })
    .node("sandbox", "env", 1000, 440, { name: "Sandbox", env_kind: "sandbox", image: "python:3.12" })
    .plugin("ledger", "board", 260, 380, { name: "Ledgers", scope: "system" })
    .edge("user", "orchestrator", "message", { label: "Task" })
    .edge("orchestrator", "user", "message", { label: "Answer" });
  for (const a of ["websurfer", "filesurfer", "coder", "terminal"]) b.edge("orchestrator", a, "call");
  b.edge("websurfer", "browser", "access")
    .edge("filesurfer", "files", "access", { access: "read" })
    .edge("terminal", "sandbox", "access", { access: "read_write" })
    .edge("orchestrator", "ledger", "access", { access: "read_write" });
  b.doc.budget = { usd: 10, max_rounds: 100, wallclock_min: 60 };
  return b.doc;
}

export const magenticOne: TemplateInfo = {
  id: "paper-magentic-one",
  name: "Magentic-One",
  summary: "orchestrator ledgers · custom loop · web, file, code, terminal specialists",
  build,
  paper: { title: "Magentic-One: A Generalist Multi-Agent System for Solving Complex Tasks", authors: "Fourney et al.", year: 2024, url: "https://arxiv.org/abs/2411.04468" },
  notes: {
    mapped: [
      "The Orchestrator's outer (task ledger) and inner (progress ledger) loops are a custom agent loop, including re-planning after three stalled steps.",
      "Specialists are called agents; ComputerTerminal is a process agent that runs code without a model; the ledgers are kept on a board plugin.",
      "A before_tool hook holds irreversible actions for the user.",
    ],
    differs: [
      "WebSurfer's set-of-marks screenshots and accessibility tree are behind the browser env; they are not modelled separately.",
    ],
  },
};
