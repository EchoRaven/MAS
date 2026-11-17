// ChatDev: a chat chain of phases, each a two-agent dialogue between an
// instructor and an assistant, sharing one codebase.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

const CONSENSUS = 'output.text.includes("<INFO>")';

function phase(b: Builder, id: string, x: number, name: string, instructor: [string, string], assistant: [string, string], rounds: number) {
  b.group(id, x, 0, { name, iterate: { max_rounds: rounds, until: CONSENSUS, feed: "output" } })
    .agent(`${id}_i`, 0, 0, { name: instructor[0], role: "Instructor", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: instructor[1] } }, id)
    .agent(`${id}_a`, 320, 0, { name: assistant[0], role: "Assistant", model: "sonnet", harness: { ...native(), instructions: `${assistant[1]} Before answering, ask the instructor for any detail you need (communicative dehallucination). End with <INFO> and the result once you both agree.` } }, id)
    .edge(id, `${id}_i`, "message")
    .edge(`${id}_i`, `${id}_a`, "message")
    .edge(`${id}_a`, id, "message");
}

function build(): SystemDoc {
  const b = new Builder(
    "ChatDev",
    "A chat chain: each phase is a dialogue between an instructor and an assistant that repeats until they reach consensus (<INFO>) or a turn limit, and hands its result to the next phase. Programmers share one codebase; tests run in a sandbox.",
  );
  b.node("client", "human", -280, 30, { name: "Client", role: "Gives the software idea", approves: false });
  phase(b, "design", 0, "Demand analysis", ["CEO", "Decide with the CPO what product modality fits the request."], ["CPO", "Propose the product modality and core features."], 6);
  phase(b, "coding", 380, "Coding", ["CTO", "Turn the design into a concrete architecture and ask the programmer to implement it file by file."], ["Programmer", "Write the complete code into the repository."], 10);
  phase(b, "review", 760, "Code review", ["Reviewer", "Review the code in the repository and list concrete defects."], ["Programmer", "Fix every defect the reviewer lists."], 3);
  phase(b, "testing", 1140, "Testing", ["Tester", "Run the program in the sandbox and report the errors."], ["Programmer", "Fix the errors until the program runs."], 3);
  b.plugin("repo", "workspace", 480, 260, { name: "Codebase", scope: "system", sources: ["/project"] })
    .node("sandbox", "env", 960, 260, { name: "Test sandbox", env_kind: "sandbox", image: "python:3.12" })
    .edge("client", "design", "message", { label: "Task" })
    .edge("design", "coding", "handoff", { carry: "summary", label: "Design" })
    .edge("coding", "review", "handoff", { carry: "summary" })
    .edge("review", "testing", "handoff", { carry: "summary" })
    .edge("testing", "client", "message", { label: "Software" });
  // groups keep their members on their own canvas; the shared codebase and sandbox sit inside the phases that use them
  for (const [phaseId, res] of [["coding", "repo"], ["review", "repo"], ["testing", "repo"], ["testing", "sandbox"]] as const) {
    const copy = `${res}_${phaseId}`;
    const src = b.doc.nodes.find((n) => n.id === res)!;
    b.doc.nodes.push({ id: copy, position: { x: 160, y: 220 }, parent: phaseId, data: structuredClone(src.data) });
    b.edge(`${phaseId}_a`, copy, "access", { access: "read_write" });
  }
  b.doc.nodes = b.doc.nodes.filter((n) => n.id !== "repo" && n.id !== "sandbox");
  b.doc.budget = { usd: 5, max_rounds: 120, wallclock_min: 60 };
  return b.doc;
}

export const chatdev: TemplateInfo = {
  id: "paper-chatdev",
  name: "ChatDev",
  summary: "chat chain · instructor/assistant dialogues · consensus loops",
  build,
  paper: { title: "ChatDev: Communicative Agents for Software Development", authors: "Qian et al.", year: 2023, url: "https://arxiv.org/abs/2307.07924" },
  notes: {
    mapped: [
      "Each phase of the chat chain is a Group whose members are the instructor and the assistant.",
      "Group iteration repeats the dialogue until the assistant's reply contains <INFO> (consensus) or the phase's turn limit.",
      "Phases hand off to each other with a summary; the codebase is a workspace plugin; tests run in a sandbox env.",
      "Communicative dehallucination is in the assistant's instructions (ask before answering).",
    ],
    differs: [
      "The paper's documentation phase and its art/GUI options are left out.",
      "A component belongs to one group, so the Programmer appears once per phase and each phase gets its own copy of the codebase plugin pointing at the same storage, rather than one agent and one store reused across phases.",
    ],
  },
};
