// AutoGen: conversable agents in a group chat; a manager picks who speaks
// next, and a user proxy executes the code the others write.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

function build(): SystemDoc {
  const b = new Builder(
    "AutoGen group chat",
    "A planner, a coder and a critic talk in one group chat. A manager reads the conversation and picks the next speaker; the user proxy runs every code block it is shown in a sandbox and posts the output. The chat ends when someone says TERMINATE.",
  );
  b.node("user", "human", 0, 120, { name: "User", role: "Gives the task", approves: false })
    .room("chat", 420, 300, "group chat", { policy: "selector", selector: "manager", history: "since_join" })
    .agent("manager", 420, 520, { name: "Manager", role: "Chooses the next speaker", model: "haiku", harness: { ...native(), loop: "single_shot", instructions: "You manage a group chat. You only choose who speaks next." } })
    .agent("planner", 260, 0, { name: "Planner", role: "Breaks the task into steps", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Suggest a short plan. Revise it when the critic or the code output shows a problem. Do not write code." } })
    .agent("coder", 580, 0, { name: "Coder", role: "Writes Python in code blocks", model: "opus", harness: { ...native(), loop: "single_shot", instructions: "Write complete Python in one ```python block that prints its results. Fix it when the executor reports an error. When the task is solved and verified, reply TERMINATE." } })
    .agent("critic", 900, 120, { name: "Critic", role: "Checks plans and results", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Check the plan, the code and its output for mistakes. Say what must change, or say the result is verified." } })
    .agent("executor", 900, 380, {
      name: "User proxy",
      role: "Executes code blocks",
      model: "haiku",
      tools: ["bash"],
      harness: { ...native(), loop: "react", max_steps: 4, instructions: "When the last message contains a ```python block, save it to main.py with bash (cat > main.py <<'EOF' … EOF), run python3 main.py, and post exactly the output. Otherwise say there is no code to run." },
    })
    .node("sandbox", "env", 1220, 380, { name: "Sandbox", env_kind: "sandbox", image: "python:3.12" })
    .edge("user", "chat", "access", { access: "read_write", binding: { mode: "tool", write: { when: "agent_tool" } } });
  for (const id of ["planner", "coder", "critic", "executor"]) b.edge(id, "chat", "access", { access: "read_write" });
  b.edge("manager", "chat", "access", { access: "read" }).edge("executor", "sandbox", "access", { access: "read_write" });
  b.doc.budget = { usd: 3, max_rounds: 30, wallclock_min: 20 };
  b.doc.termination = ['text.includes("TERMINATE")'];
  return b.doc;
}

export const autogen: TemplateInfo = {
  id: "paper-autogen",
  name: "AutoGen group chat",
  summary: "conversable agents · manager-selected speakers · code execution",
  build,
  paper: { title: "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation", authors: "Wu et al.", year: 2023, url: "https://arxiv.org/abs/2308.08155" },
  notes: {
    mapped: [
      "The group chat is a room env with the selector policy; the GroupChatManager is the selector agent, which reads the transcript and names the next speaker (never itself).",
      "Every participant pins the shared transcript into its context, as in AutoGen's broadcast of all messages.",
      "The UserProxyAgent's code execution is an agent with the sandbox's bash tool; TERMINATE in a message ends the chat.",
    ],
    differs: [
      "AutoGen's user proxy runs code without a model call; here a small model extracts the code block and runs it with bash.",
      "Human input mode (ALWAYS / TERMINATE / NEVER) is not modelled; the user only opens the chat.",
    ],
  },
};
