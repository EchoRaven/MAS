# Architecture

MAS Studio describes any multi-agent system as one document, runs it on one
engine, and measures it with one evaluation layer. This page is the map. The
exact rules are in [contracts.md](contracts.md) (what can be built and
imported) and [server.md](server.md) (what a run does). What 37 papers need
from these parts is in [survey.md](survey.md).

## The layers

```
 ┌───────────────────────────────────────────────────────────────────────┐
 │ Canvas · YAML · Architect agent        (three editors of one document) │
 ├───────────────────────────────────────────────────────────────────────┤
 │ SystemDoc (spec 0.2)   components · ports · edges · policies · models │  src/model/types.ts
 │ Validator · conformance (import gate) · migration                     │  src/model/validate.ts, conformance.ts
 ├───────────────────────────────────────────────────────────────────────┤
 │ Engine: scheduler of values over edges, groups, rooms, people         │  server/runtime/engine.ts
 │   Agent wrapper: stages → context → loop/harness → stages             │  server/runtime/agent/
 │   Functions: template · jsonata · js · python · llm                   │  server/runtime/functions/
 │   Resources: envs (sandbox, room, database, browser, imported)        │  server/runtime/resources/
 │              plugins (memory, knowledge, workspace, board, custom)    │
 │   Harness adapters: Claude Code, Codex, ACP, stdio, A2A, LangGraph     │  server/runtime/harness/
 │   Models: Anthropic, OpenAI-compatible, Gemini, local, mock           │  server/runtime/models/
 │   Policies · budgets · approvals · events                             │  server/runtime/runs.ts
 ├───────────────────────────────────────────────────────────────────────┤
 │ Isolation: boxes for sandboxes and agent programs (Docker; a microVM  │  server/runtime/isolation/
 │   backend fits the same interface) · egress proxy · MCP and model     │  server/hosting/
 │   gateways: the only ways out of a box                                │
 ├───────────────────────────────────────────────────────────────────────┤
 │ Evaluation: datasets → evaluations (runs) → graders → comparison      │  server/runtime/evals.ts, grading/
 └───────────────────────────────────────────────────────────────────────┘
```

Everything above the engine is data. A system is never code; code lives
inside the document as functions with one contract, so it can be read,
diffed, validated and moved between workspaces.

## The vocabulary of a system

Seven kinds of component, three kinds of data edge, and one kind of access
edge are enough for the 37 papers rebuilt so far.

| Component | Role in a MAS | Examples from the papers |
| --- | --- | --- |
| `agent` | A model in a loop with tools, wrapped in input/output stages | debaters, coder, critic, orchestrator |
| `model` | One model call, no loop; with `replicas`, N calls and the list of replies | MoA proposers, CAMEL's task specifier, Agent Forest's samples |
| `function` | Code between components: route, merge, vote, count | majority vote, ReConcile's recalibration, DyLAN's dispatch |
| `human` | A person: starts runs, approves, answers | user, fund manager approving a trade |
| `group` | A sub-system; can **iterate** (rounds until a condition) | debate rounds, test-and-fix loops, ChatDev phases |
| `env` | A place agents act: `room`, `sandbox`, `database`, `browser`, `service`, imported app, `external` | AutoGen's group chat, the code sandbox |
| `plugin` | A capability attached to agents: `memory`, `knowledge`, `workspace`, `board`, custom | Voyager's skill library, Reflexion's episodic memory |

| Edge | Meaning |
| --- | --- |
| `message` | Asynchronous post from an output port to an input port |
| `call` | Synchronous request; to the caller it is a tool (`ask_<id>`) |
| `handoff` | Passes control; `carry: full` passes the whole conversation |
| `access` | From an agent or person to an env or plugin, with one `binding` (how it reads and writes) |

Values on edges go through `filter → transform → gate → coercion`. Ports have
types (`message`, `text`, `json` with a schema, `file`, `event`, `any`), so a
mismatch is caught by the validator, not at run time.

## Inside an agent

An agent is a wrapper around a loop. The wrapper is the same whoever runs the
loop:

1. **Input stages** (`pipeline.pre`): parse, validate, transform, filter, route, redact, summarise.
2. **Context**: instructions, then whatever its access edges inject (memory, knowledge, room transcript), within a token budget.
3. **Loop**: the platform's own (`react`, `single_shot`, `plan_execute`, `reflexion`, `tree_search`, `custom`), or an external harness (Claude Code, Codex, ACP, a stdio program, an A2A or LangGraph endpoint). External harnesses get the platform's tools over MCP, so hooks, approvals and policies apply to them too.
4. **Output stages** (`pipeline.post`), with an `on_fail` policy (`retry` asks the model again).
5. **History and memory writes.**

Hooks (`before_model`, `before_tool`, `after_tool`, …) can watch or block any
step.

## A run

1. **Entry.** The input reaches the first speaker: a person's outgoing edge, a room, an `on_start` agent, or the first component.
2. **Scheduling.** Each value is delivered along its edges; agents take turns per input (`coalesce`, `queue`, `parallel` or `interrupt` when busy); functions wait for their inputs (`join: any | all`); groups repeat while `iterate.until` is false; rooms wake speakers by policy (`round_robin`, `mention`, `selector`, `free`).
3. **Events.** Every step emits an event (messages, tool calls, usage, transforms, approvals); the run page replays them, and they are stored as the run's record.
4. **Limits and policies.** Budget in dollars, rounds and minutes, per-agent budgets, and policies on tools, usage and outputs can block, ask a person, or end the run.
5. **Result.** A value that reaches the person who started the run, the last word of a room conversation, an agent's `finish`, or a policy that ends the run on a value. A system that declares its result type (`result: {type: code}`, say) has the answer checked at the end.

The run's original input stays visible to every function as `ctx.run_input`,
so a step deep in a pipeline can still see the task.

## Evaluation

```
dataset (versioned cases) ──► evaluation: one run per case × repeats ──► grader ──► compare
   GSM8K, MCQ, HumanEval,         same models for every system              answer · number · contains
   custom adapter                 (on_model / model_map), rate-limited      llm judge · code (Docker)
```

- **Datasets** are first-class: built-in sets, saved sets, a version per
  content hash, seeded samples. Formats are read as they come (GSM8K `####`,
  multiple choice, HumanEval records) or through a small JavaScript adapter.
- **Evaluations** run every case as an ordinary run, which can be opened and
  replayed. Several systems can be queued on the same questions; they run one
  after another, so a comparison never multiplies the request rate. An
  evaluation can put every model of a system on another one (`on_model`,
  `model_map`, where `node:<id>` serves one node apart from the slot it
  shares), set run variables (`vars`: ensemble size, debate rounds), and
  give each run a longer time limit (`time_limit_min`) for a slower model.
- **Graders** are rules (`answer`, `number`, `contains`), an LLM judge,
  `code`, which runs the answer with the problem's tests in a throwaway
  container, or `none` for open-ended tasks (stories, articles,
  instructions).
- **Open-ended outputs are judged pairwise.** Two evaluations of the same
  questions are read side by side by a judge model, or by a judging system
  such as ChatEval's panel (`judge_system`). Each question is judged in both
  orders, and a win needs both orders to agree. Each judge's verdicts are kept
  in their own file. Beside every judgement go the two sides' **shape** (mean
  words, headings, list items), because a judge rewards length and structure,
  and their **sourced links**: the share of cited links that the run's own
  `web_search` and `fetch` returned, a check a judge cannot make on recent
  facts.
- **Baselines** are templates: one model call with the request as it is
  (the control for systems of plain calls), one writer, one writer with
  search, one agent with code, and self-consistency. A baseline's prompt can
  create a gain on its own: Mixture-of-Agents beat the writer baseline 31–9
  and lost 14–19 to a plain call.
- **Evaluations look after their own answers.** A case a provider failed in
  passing (a 5xx, a dropped stream) runs once more at the end; Retry reruns
  the cases with no known answer (errors, no output, outputs the old log cut
  short); misses graded by rule record which member had the right answer
  (`reached`); and Check misses with the judge gives a second opinion on the
  wrong answers without changing a grade.
- **Compare** groups evaluations by their questions (a hash of the cases), and
  shows accuracy with its 95% interval, each repeat's score and spread, the
  questions fixed and lost against a reference with McNemar's p, misses a
  member had and lost, cost per correct answer, a chart of accuracy against
  cost with the cost frontier named, and a question-by-question grid. Runs
  of one setup started separately pool into one row; an evaluation with
  cases whose answer is not known says so, with a link to retry them.
  Open-ended sets list their pairwise judgements, with shape and links.
- **Invalid evaluations** (a setup bug found after they ran) are marked with
  the reason. They are kept and listed, but left out of comparisons and pooled
  runs by default.

## Storage and server

- One Node process (`server/index.ts`) on `127.0.0.1:5190`, with a bearer
  token in `.data/token`. The browser app talks only to this API.
- Systems, runs, evaluations, datasets, knowledge and plugin state are files
  under `.data/`. Systems keep a version history; deleted seeded systems are
  remembered so they are not re-seeded.
- Secrets are stored apart from documents and scrubbed from run events. A
  document only names the environment variable that holds a key.
- Model requests are capped per provider and key (`MAS_RPM`, 60 a minute by
  default) across the whole server. A model can add a lower limit of its own
  (`api.params.rpm`, kept out of the request), for quotas such as free-tier
  Gemma's.
- Hosted services (`.data/hosted/`) are projects uploaded or cloned, built
  into Docker images and run isolated (no network unless declared, no
  published ports, unprivileged); components reach them, or remote servers,
  through one `endpoint` ([hosting.md](hosting.md)).
- Everything that runs code an agent or a model wrote runs in a box: not
  root, no capabilities, no privilege gain, a seccomp profile of our own, a
  read-only root, limits. A box has no network, or reaches its declared hosts
  through the egress proxy; agent programs (Claude Code, Codex) reach the
  platform's tools through the MCP gateway and models through the model
  gateway, which puts the key on the request outside the box. Every
  connection, allowed or refused, is in the run's log. Sandboxes are shared by
  the agents connected to them, or one per agent (`share: per_agent`).
- Chat replies are streamed from the provider and put back together (text,
  tool calls, usage), so a model that thinks for minutes is not cut off by the
  HTTP client's wait for headers.
