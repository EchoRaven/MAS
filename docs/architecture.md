# Architecture

MAS Studio describes any multi-agent system as one document, runs it on one
engine, and measures it with one evaluation layer. This page is the map. The
exact rules are in [contracts.md](contracts.md) (what can be built and
imported) and [server.md](server.md) (what a run does). What 27 papers need
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
 │ Evaluation: datasets → evaluations (runs) → graders → comparison      │  server/runtime/evals.ts, grading/
 └───────────────────────────────────────────────────────────────────────┘
```

Everything above the engine is data. A system is never code; code lives
inside the document as functions with one contract, so it can be read,
diffed, validated and moved between workspaces.

## The vocabulary of a system

Seven kinds of component, three kinds of data edge, and one kind of access
edge are enough for the 27 papers rebuilt so far.

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
5. **Result.** A value that reaches the person who started the run, the last word of a room conversation, an agent's `finish`, or a policy that ends the run on a value.

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
  after another, so a comparison never multiplies the request rate.
- **Graders** are rules (`answer`, `number`, `contains`), an LLM judge, or
  `code`, which runs the answer with the problem's tests in a throwaway
  container.
- **Compare** groups evaluations by their questions (a hash of the cases), and
  shows accuracy, each repeat's score and spread, cost per correct answer, and
  a question-by-question grid.

## Storage and server

- One Node process (`server/index.ts`) on `127.0.0.1:5190`, with a bearer
  token in `.data/token`. The browser app talks only to this API.
- Systems, runs, evaluations, datasets, knowledge and plugin state are files
  under `.data/`. Systems keep a version history; deleted seeded systems are
  remembered so they are not re-seeded.
- Secrets are stored apart from documents and scrubbed from run events. A
  document only names the environment variable that holds a key.
- Model requests are capped per provider and key (`MAS_RPM`, 60 a minute by
  default) across the whole server.
