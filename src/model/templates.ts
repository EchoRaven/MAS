import { Builder, native, type TemplateInfo } from "./builder";
import { emptySystem } from "./defaults";
import { autoLayout } from "./layout";
import { PAPER_TEMPLATES } from "./papers";
import { port } from "./ports";
import type { AgentData, SystemDoc } from "./types";

export type { TemplateInfo } from "./builder";


function debate(): SystemDoc {
  const b = new Builder("Debate with a judge", "Pro and con take turns in one room; the judge scores every three rounds. Its output wrapper parses a Verdict and the run ends once there is one.");
  b.schema({ id: "Verdict", description: "The judge's decision", json_schema: '{\n  "type": "object",\n  "required": ["winner"],\n  "properties": {\n    "winner": { "enum": ["pro", "con", null] },\n    "reason": { "type": "string" }\n  }\n}' })
    .agent("pro", 0, 0, { name: "Pro", role: "Argues for the motion", model: "sonnet", harness: { ...native(), instructions: "You argue for the motion. Each turn, answer the other side's last point with one new argument." } })
    .agent("con", 300, 0, { name: "Con", role: "Argues against the motion", model: "sonnet", harness: { ...native(), instructions: "You argue against the motion. Point out the weakest link in the pro side's case." } })
    .agent("judge", 600, 0, {
      name: "Judge",
      role: "Scores and decides when to stop",
      model: "opus",
      interface: { inputs: [port("in", "message")], outputs: [port("verdict", "json", { schema: "Verdict" })] },
      pipeline: { pre: [], post: [{ id: "p1", op: "parse_json", name: "Parse verdict", schema: "Verdict", on_fail: "retry", max_retries: 2 }] },
      harness: { ...native(), loop: "single_shot", instructions: 'Evaluate every three rounds. Reply with JSON: {"winner": "pro" | "con" | null, "reason": "..."}.' },
    })
    .room("arena", 310, 210, "arena", { policy: "round_robin" })
    .edge("pro", "arena", "access")
    .edge("con", "arena", "access")
    .edge("judge", "arena", "access");
  b.doc.budget = { usd: 2, max_rounds: 12, wallclock_min: 10 };
  // the policy below ends the run on the verdict
  b.doc.policies = [{ id: "p1", on: "output(judge.verdict)", condition: "output.winner != null", action: "terminate" }];
  return b.doc;
}

function codingTeam(): SystemDoc {
  const b = new Builder(
    "Coding team on a shared repo",
    "The planner posts tasks on the board; the coder (Claude Code) implements them in the shared repo; work reaches the reviewer (any ACP agent) only once tests pass. The reviewer's output wrapper routes to approve or changes; merging needs PM approval.",
  );
  b.schema({ id: "Review", description: "Reviewer decision", json_schema: '{\n  "type": "object",\n  "required": ["decision"],\n  "properties": {\n    "decision": { "enum": ["approve", "changes"] },\n    "comments": { "type": "array", "items": { "type": "string" } }\n  }\n}' })
    .agent("planner", 0, 0, { name: "Planner", role: "Splits work into tasks on the board", model: "opus", harness: { ...native(), loop: "plan_execute", instructions: "Break the request into independently verifiable task cards, post them on the board and assign them." } })
    .agent("coder", 300, 0, {
      name: "Coder",
      role: "Implements tasks",
      model: "opus",
      tools: ["run_tests"],
      triggers: ["on_state", "on_message"],
      harness: { ...native(), tier: "process", runner: "claude-code", loop: undefined, instructions: "Pick up the board tasks assigned to you, implement them in /work and make the tests pass.", own_memory: "disable" },
    })
    .agent("reviewer", 620, 0, {
      name: "Reviewer",
      role: "Reviews code",
      model: "sonnet",
      tools: ["merge_pr"],
      triggers: ["on_handoff"],
      interface: { inputs: [port("in", "message")], outputs: [port("approve", "json", { schema: "Review" }), port("changes", "message")] },
      pipeline: {
        pre: [],
        post: [
          { id: "p1", op: "parse_json", name: "Parse review", schema: "Review", on_fail: "retry", max_retries: 2 },
          { id: "p2", op: "route", name: "Approve or request changes", fn: { lang: "js", code: 'return input.decision === "approve" ? { approve: input } : { changes: { role: "user", content: input.comments.join("\\n") } };' } },
        ],
      },
      harness: { ...native(), tier: "process", runner: "acp", loop: undefined, command: "<launch command of any ACP-capable agent>", instructions: 'Review the change. Reply with JSON: {"decision": "approve" | "changes", "comments": [...]}.' },
    })
    .node("pm", "human", 940, 10, { name: "PM", role: "Approves merges" })
    .plugin("board", "board", 0, 230, { name: "Board" })
    .node("repo", "env", 330, 230, { name: "repo", env_kind: "sandbox", image: "node:22", egress: ["registry.npmjs.org", "github.com"] })
    .room("team", 690, 240, "team", { policy: "mention" })
    .edge("planner", "board", "access", { access: "read_write" })
    .edge("coder", "board", "access", { access: "read_write" })
    .edge("coder", "repo", "access", { access: "read_write" })
    .edge("reviewer", "repo", "access", { access: "read" })
    .edge("coder", "reviewer", "handoff", { carry: "summary", label: "Submit for review", gate: { name: "tests_pass", condition: "check: npm test", on_fail: "block", escalate_after: 3 } })
    .edge("reviewer", "coder", "message", { source_port: "changes", label: "Changes requested" })
    .edge("reviewer", "pm", "call", {
      source_port: "approve",
      label: "Request merge approval",
      transform: { lang: "template", code: "Merge approval needed.\n{{#each input.comments}}- {{this}}\n{{/each}}" },
    })
    .edge("planner", "team", "access")
    .edge("coder", "team", "access")
    .edge("reviewer", "team", "access")
    .edge("pm", "team", "access");
  b.doc.budget = { usd: 20, max_rounds: 200, wallclock_min: 120 };
  return b.doc;
}

function research(): SystemDoc {
  const b = new Builder(
    "Research team with spawning",
    "A Group with one input (the question) and one output (the report). Inside, the lead spawns searchers and the writer drafts from the knowledge base. A bare model call then writes the abstract.",
  );
  b.node("asker", "human", 0, 20, { name: "Asker", role: "Poses the research question", approves: false })
    .node("team", "group", 280, 0, { name: "Research team", budget_usd: 3, interface: { inputs: [port("question", "message", { required: true })], outputs: [port("report", "message")] } })
    .node("abstract", "model", 580, 0, { name: "Abstract writer", model: "haiku", system_prompt: "You write 3-sentence abstracts.", prompt: "Write the abstract of this report:\n\n{{input}}", interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } })
    .agent("lead", 0, 40, { name: "Lead", role: "Splits the question, spawns searchers", model: "opus", spawn: { template: "searcher", max_instances: 6 }, harness: { ...native(), loop: "plan_execute", instructions: "Split the question into 3-6 sub-questions and spawn one searcher per sub-question to search in parallel." } }, "team")
    .agent("searcher", 380, -90, { name: "Searcher (template)", role: "Researches one sub-question", model: "haiku", tools: ["web_search", "fetch"], harness: { ...native(), instructions: "Answer only the sub-question you were given, with sources." } }, "team")
    .agent("writer", 380, 150, { name: "Writer", role: "Writes the report", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Combine the search results into one sourced report." } }, "team")
    .plugin("kb", "knowledge", 410, 330, { scope: "group", sources: ["./docs"] }, "team")
    .edge("asker", "team", "message", { label: "Question" })
    .edge("team", "lead", "message")
    .edge("lead", "searcher", "call", { label: "Sub-question" })
    .edge("lead", "writer", "handoff", { carry: "full" })
    .edge("writer", "team", "message")
    .edge("writer", "kb", "access", {
      access: "read",
      binding: {
        mode: "auto_inject",
        read: { query: { lang: "template", code: "{{task.question}} {{input.text}}" }, top_k: 5, budget_tokens: 4000, format: { lang: "template", code: "{{#each results}}- {{this.text}} [{{this.source}}]\n{{/each}}" } },
        write: { when: "never" },
      },
    })
    .edge("team", "abstract", "message", { label: "Report" })
    .edge("abstract", "asker", "message", { label: "Abstract" });
  b.doc.budget = { usd: 3, max_rounds: 60, wallclock_min: 20 };
  return b.doc;
}

function support(): SystemDoc {
  const b = new Builder(
    "Support triage",
    "A function node redacts card numbers before anything reaches a model. Triage's output wrapper routes to billing or tech; refunds need human approval, formatted by an edge transform; history is remembered per end user.",
  );
  b.schema({ id: "Refund", description: "A refund request", json_schema: '{\n  "type": "object",\n  "required": ["order_id", "amount"],\n  "properties": {\n    "order_id": { "type": "string" },\n    "amount": { "type": "number" }\n  }\n}' })
    .node("customer", "human", 0, 140, { name: "Customer", role: "End user", approves: false })
    .node("redact", "function", 250, 140, { name: "Redact card numbers", fn: { lang: "js", code: 'return { ...input, content: input.content.replace(/\\b\\d{13,19}\\b/g, "[card]") };' }, interface: { inputs: [port("in", "message")], outputs: [port("out", "message")] } })
    .agent("triage", 590, 130, {
      name: "Triage",
      role: "Detects intent and routes",
      model: "haiku",
      modalities_in: ["text", "image"],
      interface: { inputs: [port("in", "message")], outputs: [port("billing", "message"), port("tech", "message")] },
      pipeline: { pre: [], post: [{ id: "p1", op: "route", name: "Route by intent", fn: { lang: "llm", code: "Answer billing or tech for this request: {{input}}", model: "haiku" } }] },
      harness: { ...native(), loop: "single_shot", instructions: "Summarise the request in one paragraph for the specialist." },
    })
    .agent("billing", 940, 0, {
      name: "Billing",
      role: "Handles billing and refunds",
      model: "sonnet",
      tools: ["issue_refund"],
      interface: { inputs: [port("in", "message")], outputs: [port("out", "message"), port("refund", "json", { schema: "Refund" })] },
      pipeline: { pre: [], post: [{ id: "p1", op: "route", name: "Reply or ask for a refund", fn: { lang: "js", code: "return input.refund ? { refund: input.refund } : { out: input };" } }] },
      harness: { ...native(), instructions: 'Verify the order before acting. To refund, reply with {"refund": {"order_id": ..., "amount": ...}}.' },
    })
    .agent("tech", 940, 270, { name: "Tech support", role: "Troubleshoots technical issues", model: "sonnet", tools: ["web_search"], harness: { ...native(), instructions: "Work through the troubleshooting playbook step by step." } })
    .node("lead", "human", 1300, 20, { name: "Support lead", role: "Approves refunds" })
    .plugin("mem", "memory", 1300, 420, { name: "User memory", scope: "end_user" })
    .edge("customer", "redact", "message")
    .edge("redact", "triage", "message")
    .edge("triage", "billing", "handoff", { source_port: "billing", carry: "summary" })
    .edge("triage", "tech", "handoff", { source_port: "tech", carry: "summary" })
    .edge("billing", "lead", "call", { source_port: "refund", label: "Refund approval", transform: { lang: "template", code: "Approve refund of ${{input.amount}} for order {{input.order_id}}?" } })
    .edge("billing", "customer", "message", { source_port: "out", label: "Reply" })
    .edge("billing", "mem", "access", {
      access: "read_write",
      binding: {
        mode: "auto_inject",
        read: { top_k: 8, filter: "scope == \"end_user\" && age_days < 90", budget_tokens: 2000 },
        write: { when: "after_turn", extract: { lang: "llm", code: "List new durable facts about the customer (orders, preferences, open issues) from this turn as JSON lines.", model: "haiku" } },
      },
    })
    .edge("tech", "mem", "access", { access: "read_write" });
  return b.doc;
}

function invoices(): SystemDoc {
  const b = new Builder(
    "Invoice extraction",
    "No agents at all: a bare model call extracts fields as JSON, a function checks the totals and routes the invoice, and a human only sees the ones that do not add up.",
  );
  b.schema({ id: "Invoice", description: "Fields pulled from an invoice", json_schema: '{\n  "type": "object",\n  "required": ["vendor", "total", "lines"],\n  "properties": {\n    "vendor": { "type": "string" },\n    "total": { "type": "number" },\n    "lines": { "type": "array", "items": { "type": "object", "properties": { "amount": { "type": "number" } } } }\n  }\n}' })
    .node("inbox", "human", 0, 60, { name: "Accounts inbox", role: "Drops invoice PDFs", approves: false })
    .node("extract", "model", 270, 50, {
      name: "Extract fields",
      model: "sonnet",
      system_prompt: "Extract invoice fields. Reply with JSON only.",
      prompt: "{{input}}",
      temperature: 0,
      interface: { inputs: [port("pdf", "file")], outputs: [port("fields", "json", { schema: "Invoice" })] },
    })
    .node("check", "function", 600, 50, {
      name: "Check totals",
      fn: { lang: "js", code: "const sum = input.lines.reduce((a, l) => a + l.amount, 0);\nreturn Math.abs(sum - input.total) < 0.01 ? { ok: input } : { mismatch: input };" },
      interface: { inputs: [port("in", "json", { schema: "Invoice" })], outputs: [port("ok", "json", { schema: "Invoice" }), port("mismatch", "json", { schema: "Invoice" })] },
    })
    .node("ledger", "env", 960, -60, {
      name: "Ledger DB",
      env_kind: "database",
      image: "postgres:16",
      lifecycle: "persistent",
      snapshot: "on_write",
      db: {
        mode: "templates",
        templates: [
          { name: "find_invoice", description: "An invoice by vendor and number", sql: "SELECT * FROM invoices WHERE vendor = :vendor AND number = :number" },
          { name: "post_invoice", description: "Record a checked invoice", sql: "INSERT INTO invoices (vendor, number, total) VALUES (:vendor, :number, :total)" },
        ],
        tables: ["invoices", "vendors"],
        read_only: false,
        row_limit: 100,
      },
    })
    .node("clerk", "human", 960, 160, { name: "Clerk", role: "Fixes mismatched invoices" })
    .edge("inbox", "extract", "message", { target_port: "pdf" })
    .edge("extract", "check", "message")
    .edge("check", "clerk", "message", { source_port: "mismatch", label: "Totals do not add up", transform: { lang: "template", code: "{{input.vendor}}: lines sum differs from total {{input.total}}" } })
    .edge("clerk", "ledger", "access", { access: "read_write" });
  b.doc.budget = { usd: 1, max_rounds: 20, wallclock_min: 10 };
  b.doc.termination = ["all_idle", "budget_exceeded"];
  return b.doc;
}

function supervisor(): SystemDoc {
  const b = new Builder(
    "Supervisor and workers",
    "Hierarchical delegation: a supervisor plans and calls three specialists. The analyst queries a database by text-to-SQL, the researcher and writer share a wiki with hybrid retrieval (the writer overrides how many hits it gets), the writer runs a reflexion loop, and the supervisor keeps a team memory with a full lifecycle.",
  );
  b.node("requester", "human", 0, 140, { name: "Requester", role: "Asks for an analysis", approves: false })
    .agent("supervisor", 260, 130, { name: "Supervisor", role: "Plans, delegates, assembles", model: "opus", harness: { ...native(), loop: "plan_execute", loop_params: { planner: "opus", replan: true, max_steps: 40 }, instructions: "Break the request down, call the right specialist for each part, then assemble one answer." } })
    .agent("researcher", 640, -60, { name: "Researcher", role: "Finds facts", model: "sonnet", tools: ["web_search", "fetch"], harness: { ...native(), instructions: "Find and cite sources for the question you are given." } })
    .agent("analyst", 640, 140, { name: "Analyst", role: "Answers with data", model: "sonnet", harness: { ...native(), instructions: "Answer with numbers from the sales database; show the query you used." } })
    .agent("writer", 640, 340, {
      name: "Writer",
      role: "Drafts and self-critiques",
      model: "sonnet",
      harness: { ...native(), loop: "reflexion", loop_params: { critic: "opus", max_trials: 3, critique: "Check every claim has a source and every number matches the analyst's." }, instructions: "Write the final report from the findings." },
      hooks: { after_model: { lang: "js", code: "// strip internal notes before the reply leaves\nreturn { ...event, text: event.text.replace(/<internal>[\\s\\S]*?<\\/internal>/g, '') };" } },
    })
    .node("sales", "env", 1010, 160, {
      name: "Sales DB",
      env_kind: "database",
      image: "postgres:16",
      lifecycle: "persistent",
      snapshot: "never",
      db: { mode: "text_to_sql", templates: [], tables: ["orders", "customers", "products"], read_only: true, row_limit: 500, model: "sonnet" },
    })
    .plugin("wiki", "knowledge", 1010, -20, { name: "Company wiki", sources: ["./wiki"] })
    .plugin("team_mem", "memory", 250, 380, { name: "Team memory", scope: "system" })
    .edge("requester", "supervisor", "message", { label: "Request" })
    .edge("supervisor", "researcher", "call", { label: "Research" })
    .edge("supervisor", "analyst", "call", { label: "Numbers" })
    .edge("supervisor", "writer", "call", { label: "Draft" })
    .edge("supervisor", "requester", "message", { label: "Answer" })
    .edge("analyst", "sales", "access", { access: "read" })
    .edge("researcher", "wiki", "access", { access: "read" })
    .edge("writer", "wiki", "access", { access: "read", binding: { mode: "auto_inject", read: { budget_tokens: 2000, retrieval: { select: { use: "top_k", params: { k: 3 } } } }, write: { when: "never" } } })
    .edge("supervisor", "team_mem", "access", { access: "read_write" });
  b.doc.budget = { usd: 8, max_rounds: 80, wallclock_min: 40 };
  return b.doc;
}

function blackboard(): SystemDoc {
  const b = new Builder(
    "Blackboard",
    "No direct messages between agents: a planner posts problems on a shared board, solvers wake on board changes and post partial solutions, a critic marks them done or reopens them. Coordination is entirely through state.",
  );
  const onState = { triggers: ["on_state"] as AgentData["triggers"] };
  b.node("owner", "human", 0, 60, { name: "Owner", role: "Brings the problem", approves: true })
    .agent("planner", 270, 50, { name: "Planner", role: "Posts sub-problems", model: "opus", harness: { ...native(), loop: "plan_execute", instructions: "Write the problem on the board as independent sub-problems." } })
    .agent("solver_a", 620, -80, { ...onState, name: "Solver A", role: "Takes open items", model: "sonnet", harness: { ...native(), instructions: "Claim one open item on the board, solve it, post the result." } })
    .agent("solver_b", 620, 120, { ...onState, name: "Solver B", role: "Takes open items", model: "haiku", harness: { ...native(), instructions: "Claim one open item on the board, solve it, post the result." } })
    .agent("critic", 620, 320, { ...onState, name: "Critic", role: "Reviews posted solutions", model: "opus", harness: { ...native(), loop: "reflexion", loop_params: { critic: "opus", max_trials: 2, critique: "Is this solution correct and complete?" }, instructions: "Mark posted solutions done, or reopen them with a reason." } })
    .plugin("board", "board", 300, 330, { name: "Blackboard", scope: "system" })
    .edge("owner", "planner", "message", { label: "Problem" })
    .edge("critic", "owner", "message", { label: "All done" })
    .edge("planner", "board", "access", { access: "read_write" })
    .edge("solver_a", "board", "access", { access: "read_write" })
    .edge("solver_b", "board", "access", { access: "read_write" })
    .edge("critic", "board", "access", { access: "read_write" });
  b.doc.budget = { usd: 5, max_rounds: 60, wallclock_min: 30 };
  return b.doc;
}

/** One agent, one call: what the papers compare their systems against. */
function baseline(): SystemDoc {
  const b = new Builder("Single agent (baseline)", "One agent answers in one model call, thinking step by step. The baseline the multi-agent papers compare against: evaluate it next to a paper system on the same cases and models.");
  b.node("asker", "human", 0, 0, { name: "Asker", role: "Asks the question", approves: false })
    .agent("solo", 340, 0, { name: "Solver", role: "Answers alone", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Think step by step, then give the answer. End with one line: Final: <the answer alone>" } })
    .edge("asker", "solo", "message", { label: "Question" })
    .edge("solo", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 0.5, max_rounds: 5, wallclock_min: 5 };
  return b.doc;
}

/**
 * One agent, one call, for open-ended writing: the baseline for story and article systems (Agents' Room, STORM).
 * The question baseline ends with an answer line ("Final: …"), which a judge of fiction reads as a flaw.
 */
function baselineWriter(): SystemDoc {
  const b = new Builder("Single writer (baseline)", "One agent writes what is asked in one model call, with no answer line. The baseline for open-ended writing systems (Agents' Room, STORM), judged pairwise against them. The run variable style adds a sentence to its instructions (for example a length, to match a system that writes more).");
  b.node("asker", "human", 0, 0, { name: "Asker", role: "Asks for a piece of writing", approves: false })
    .agent("solo", 340, 0, { name: "Writer", role: "Writes alone", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Write what is asked.{{vars.style ?? \"\"}} Reply with the piece itself only: no title unless asked, no notes, summary or commentary before or after it." } })
    .edge("asker", "solo", "message", { label: "Request" })
    .edge("solo", "asker", "message", { label: "Piece" });
  b.doc.budget = { usd: 0.5, max_rounds: 5, wallclock_min: 5 };
  b.doc.result = { type: "text", description: "the piece of writing" };
  return b.doc;
}

/**
 * One model call with the request as it is, no instructions: exactly one proposer of Mixture-of-Agents, so a
 * comparison with it measures what the layers and the aggregation add, not a difference of prompts.
 */
function baselineBare(): SystemDoc {
  const b = new Builder("Single model call (baseline)", "The request goes to one model as it is, with no instructions, and its reply is the answer: the same call a Mixture-of-Agents proposer makes. The baseline for systems built of plain model calls. The run variable style, when set, is appended to the request (for example a length, to match a system that writes more).");
  b.node("asker", "human", 0, 0, { name: "Asker", role: "Asks", approves: false })
    .node("call", "model", 340, 0, { name: "Model", model: "sonnet", system_prompt: "", prompt: "{{input}}{{vars.style}}", temperature: null, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } })
    .edge("asker", "call", "message", { label: "Request" })
    .edge("call", "asker", "message", { label: "Reply" });
  b.doc.budget = { usd: 0.5, max_rounds: 5, wallclock_min: 5 };
  return b.doc;
}

/**
 * A judge that can search: for pairwise judging (judge_system) on topics a judge model may not know. It checks the
 * claims and links the two responses disagree on before it gives its verdict.
 */
function factCheckJudge(): SystemDoc {
  const b = new Builder("Fact-checking judge", "One agent judges two responses with web search: it checks the facts and links they disagree on or that look doubtful, then gives its verdict in the form the request asks for. Use it as the judging system for pairwise judging on recent topics, where a judge model alone cannot tell a real fact from a made-up one.");
  b.node("asker", "human", 0, 0, { name: "Asker", role: "Brings the two responses", approves: false })
    .agent("judge", 340, 0, { name: "Judge", role: "Checks, then judges", model: "sonnet", tools: ["web_search", "fetch"], harness: { ...native(), loop: "react", max_steps: 8, instructions: "You judge two responses to the same request. First check, with web_search (and fetch for a page you need), the facts and links that matter most to the comparison: those the responses disagree on, and any that look doubtful or made up. Check a few, not everything. Then weigh the responses, counting what you found, and end exactly as the request asks (for example a last line 'Better: 1', 'Better: 2' or 'Better: tie')." } })
    .edge("asker", "judge", "message", { label: "Two responses" })
    .edge("judge", "asker", "message", { label: "Verdict" });
  b.doc.budget = { usd: 0.5, max_rounds: 10, wallclock_min: 10 };
  return b.doc;
}

/** One agent that searches the web, then writes: the baseline that tells a research team's gain from search's. */
function baselineWriterSearch(): SystemDoc {
  const b = new Builder("Single writer with search (baseline)", "One agent searches the web (web_search, fetch) as much as it needs, then writes what is asked, citing the pages it found. The baseline for research-and-write systems such as STORM: what one agent with the same search tool does.");
  b.node("asker", "human", 0, 0, { name: "Asker", role: "Asks for a piece of writing", approves: false })
    .agent("solo", 340, 0, { name: "Writer", role: "Searches, then writes", model: "sonnet", tools: ["web_search", "fetch"], harness: { ...native(), loop: "react", max_steps: 8, instructions: "Research the request with web_search (and fetch for a page you need in full), then write what is asked. Cite sources inline as [n] and list them at the end as References: only URLs your searches returned. Reply with the piece itself only." } })
    .edge("asker", "solo", "message", { label: "Request" })
    .edge("solo", "asker", "message", { label: "Piece" });
  b.doc.budget = { usd: 1, max_rounds: 10, wallclock_min: 10 };
  b.doc.result = { type: "text", description: "the piece of writing, with references" };
  return b.doc;
}

/**
 * One agent that can run Python: the baseline for systems with a code
 * executor (AutoGen), to tell what the team adds from what the tool adds.
 */
function baselineWithCode(): SystemDoc {
  const b = new Builder("Single agent with code (baseline)", "One agent that can run Python in a sandbox (Docker, no network) before it answers. The baseline for systems with a code executor: evaluate it next to AutoGen to see what the team adds beyond the tool.");
  b.node("asker", "human", 0, 0, { name: "Asker", role: "Asks the question", approves: false })
    .agent("solo", 340, 0, {
      name: "Solver",
      role: "Answers alone, running code when it helps",
      model: "sonnet",
      tools: ["bash"],
      harness: { ...native(), loop: "react", max_steps: 6, instructions: "When the answer needs exact computation, write a Python script and run it with bash (cat > main.py <<'EOF' … EOF, then python3 main.py), and trust its output over mental arithmetic. End with one line: Final: <the answer alone>" },
    })
    .node("sandbox", "env", 340, 220, { name: "Sandbox", env_kind: "sandbox", image: "python:3.12" })
    .edge("asker", "solo", "message", { label: "Question" })
    .edge("solo", "asker", "message", { label: "Answer" })
    .edge("solo", "sandbox", "access", { access: "read_write" });
  b.doc.budget = { usd: 0.5, max_rounds: 10, wallclock_min: 5 };
  return b.doc;
}

/**
 * Self-consistency: the same model sampled several times, majority vote.
 * The equal-compute baseline a multi-agent system should beat.
 */
function selfConsistency(): SystemDoc {
  const N = 5;
  const b = new Builder("Self-consistency (baseline)", `One model sampled ${N} times at temperature 0.8, then a majority vote over the final answers. It spends about as much as a small multi-agent system, so it is the baseline such a system has to beat, not just a single call.`);
  const ports = Array.from({ length: N }, (_, i) => port(`s${i + 1}`, "text", { required: true }));
  b.node("asker", "human", 0, 0, { name: "Asker", role: "Asks the question", approves: false })
    .node("vote", "function", 0, 0, {
      name: "Majority vote",
      join: "all",
      fn: {
        lang: "js",
        code: 'const finalOf = (t) => ((String(t).match(/Final:\\s*(.+)/) ?? [])[1] ?? String(t).trim().split("\\n").pop() ?? "").replace(/\\*\\*(.+?)\\*\\*/g, "$1").replace(/^\\*+|\\*+$/g, "").trim();\nconst norm = (a) => (/^[\\d\\s+*\\/().=,-]+$/.test(a) && /\\d\\s*[-+*/]\\s*[\\d(]|\\)\\s*[-+*/]/.test(a)) ? a.replace(/\\s+/g, "") : a.toLowerCase().replace(/(\\d),(?=\\d{3})/g, "$1").replace(/[^a-z0-9./-]+/g, " ").trim().replace(/\\.+$/, "");\nconst counts = {}, shown = {};\nfor (const t of Object.values(input)) { const f = finalOf(t); if (!f) continue; const k = norm(f); counts[k] = (counts[k] ?? 0) + 1; shown[k] ??= f; }\nconst ranked = Object.entries(counts).sort((x, y) => y[1] - x[1]);\nif (!ranked.length) return "No sample gave an answer.";\nreturn "Votes: " + ranked.map(([k, n]) => shown[k] + " ×" + n).join(", ") + "\\nFinal: " + shown[ranked[0][0]];',
      },
      interface: { inputs: ports, outputs: [port("out", "text")] },
    });
  for (let i = 1; i <= N; i++) {
    b.node(`s${i}`, "model", 0, 0, { name: `Sample ${i}`, model: "sonnet", system_prompt: "", prompt: "{{input}}\n\nThink step by step, then end with one line: Final: <the answer alone>", temperature: 0.8, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } });
    b.edge("asker", `s${i}`, "message", i === 1 ? { label: "Question" } : {}).edge(`s${i}`, "vote", "message", { target_port: `s${i}` });
  }
  b.edge("vote", "asker", "message", { label: "Answer" });
  b.doc.budget = { usd: 0.5, max_rounds: 20, wallclock_min: 5 };
  return autoLayout(b.doc);
}

export const TEMPLATES: TemplateInfo[] = [
  { id: "blank", name: "Blank system", summary: "Start from scratch", build: () => emptySystem() },
  { id: "baseline", name: "Single agent (baseline)", summary: "one agent, one call · what papers compare against", build: baseline },
  { id: "baseline-writer", name: "Single writer (baseline)", summary: "one agent, one call, no answer line · the baseline for writing systems", build: baselineWriter },
  { id: "baseline-bare", name: "Single model call (baseline)", summary: "the request as it is, one model call, no instructions · one MoA proposer", build: baselineBare },
  { id: "fact-check-judge", name: "Fact-checking judge", summary: "a judge with web search, for pairwise judging on recent topics", build: factCheckJudge },
  { id: "baseline-writer-search", name: "Single writer with search (baseline)", summary: "one agent · web search · then writes · the baseline for research-and-write systems", build: baselineWriterSearch },
  { id: "baseline-code", name: "Single agent with code (baseline)", summary: "one agent + a Python sandbox · the baseline for code-executing systems", build: baselineWithCode },
  { id: "self-consistency", name: "Self-consistency (baseline)", summary: "5 samples · majority vote · the equal-compute baseline", build: selfConsistency },
  { id: "debate", name: "Debate with a judge", summary: "room env · output wrapper parses a Verdict", build: debate },
  { id: "coding", name: "Coding team", summary: "Claude Code · gate · routed outputs · edge transform", build: codingTeam },
  { id: "research", name: "Research team", summary: "Group ports · spawn · bare model call", build: research },
  { id: "support", name: "Support triage", summary: "function node · routed handoffs · approval", build: support },
  { id: "invoices", name: "Invoice extraction", summary: "model + function only, no agents", build: invoices },
  { id: "supervisor", name: "Supervisor and workers", summary: "hierarchy · reflexion · text-to-SQL · hybrid RAG · memory lifecycle", build: supervisor },
  { id: "blackboard", name: "Blackboard", summary: "coordination through shared state only", build: blackboard },
  ...PAPER_TEMPLATES,
];

/** Everything seeded into a workspace: the patterns and the paper reproductions. */
export const SEED_TEMPLATES = TEMPLATES.filter((t) => t.id !== "blank");

/**
 * A seeded system keeps the same id in every workspace, so links to it hold
 * and a template added later can be told apart from one already seeded.
 */
export const seedId = (templateId: string) => `sys_${templateId.replace(/-/g, "_")}`;

/** A hash of a system's content: everything but its id, timestamp and seed record. */
export function contentHash(doc: SystemDoc): string {
  const { id: _id, updated_at: _u, seed: _s, ...content } = doc;
  const text = JSON.stringify(content);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + text.length.toString(36);
}

/**
 * What a system does, as a short hash: its content without its id, edit time, seed record and layout (where its
 * parts sit on a canvas). Two evaluations of the same system id with different versions ran different systems (a
 * template fixed in between), so their runs are not pooled.
 */
export function systemVersion(doc: SystemDoc): string {
  const { id: _id, updated_at: _u, seed: _s, ...content } = doc;
  const text = JSON.stringify(content, (k, v) => (k === "position" || k === "layout" ? undefined : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** A seeded copy of a template, ready to store. */
export function buildSeed(t: TemplateInfo): SystemDoc {
  const doc = { ...t.build(), id: seedId(t.id), updated_at: new Date().toISOString() };
  return { ...doc, seed: { template: t.id, hash: contentHash(doc) } };
}

/** A seeded system exactly as seeded: nobody has changed it since. */
export const isUneditedSeed = (d: SystemDoc) => !!d.seed && contentHash(d) === d.seed.hash;

/**
 * Seeded systems nobody has edited follow their template: when the template
 * changes (a fix, a better layout), the copy is rebuilt. A copy that was
 * edited is left alone. Returns the same array when nothing changed.
 */
export function refreshSeeds(docs: SystemDoc[]): SystemDoc[] {
  let changed = false;
  const out = docs.map((d) => {
    if (!d.seed || contentHash(d) !== d.seed.hash) return d;
    const t = SEED_TEMPLATES.find((x) => x.id === d.seed!.template);
    if (!t) return d;
    const fresh = buildSeed(t);
    if (fresh.seed!.hash === d.seed.hash) return d;
    changed = true;
    return fresh;
  });
  return changed ? out : docs;
}

/** Names of the templates seeded by earlier versions (0.1, Chinese UI); stored copies are replaced on upgrade. */
export const LEGACY_SEED_NAMES = ["\u8fa9\u8bba\u52a0\u88c1\u5224", "\u5171\u4eab\u4ed3\u5e93\u7684\u7f16\u7a0b\u56e2\u961f", "\u52a8\u6001\u62db\u52df\u7684\u7814\u7a76\u56e2\u961f", "\u5ba2\u670d\u5206\u8bca\u8f6c\u63a5"];
