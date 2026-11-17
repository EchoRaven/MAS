# Server and runtime

`npm run server` starts the MAS Studio server (`server/`). It stores systems,
runs them for real and streams their events. The browser app talks to it
under `/api`; the dev server (5180) and `vite preview` (5181) proxy that path
to it. Without a server the studio still works: systems stay in the browser
and runs are simulated.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAS_PORT` / `MAS_HOST` | `5190` / `127.0.0.1` | Where the API listens |
| `MAS_DATA_DIR` | `<repo>/.data` | Systems, runs, plugin state, secrets, the token |
| `MAS_TOKEN` | random, saved in `.data/token` | Bearer token that every `/api` call needs (the browser asks for it in Settings) |
| `MAS_ALLOW_LOCAL_EXEC` | off | Allow commands on the host: custom stdio / ACP harnesses, `cli` tools, env start commands, and sandboxes when Docker is missing |
| `MAS_DOCKER` | `docker` | Docker binary for sandbox envs |
| `MAS_PARALLELISM` | `4` | Component turns that run at once in a run |
| `MAS_KNOWLEDGE_DIR` | `<data>/knowledge` | Where knowledge plugins read their sources |
| `MAS_CLAUDE_BIN` / `MAS_CODEX_BIN` | `claude` / `codex` | CLIs for those harnesses |

API keys go in Settings → API keys (stored in `.data/secrets.json`,
mode 600), or in the server's environment. A system names a variable, such
as a model's `api.key_env`. The browser never receives the value.

Anyone holding the token can run code on the server: JS and Python
functions, and Docker sandboxes. Treat the token like a password.

## API

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Liveness (no token) |
| `GET/PUT/DELETE /api/systems[/:id]` | Systems (the browser syncs automatically) |
| `POST /api/validate` | Issues and conformance failures of a document |
| `POST /api/runs` `{doc \| system_id, input, mock?, force?}` | Start a run. `mock` = dry run on the test model. Validation errors refuse the run unless `force` is set |
| `GET /api/runs?system=` · `GET /api/runs/:id` | History, and one run with its events |
| `GET /api/runs/:id/events` | Server-sent events: replay, then live until the end |
| `POST /api/runs/:id/answer` `{request, approved?, text?}` | Answer an approval or a request for input |
| `POST /api/runs/:id/stop` · `DELETE /api/runs/:id` | Stop a run · delete a finished one |
| `GET/PUT/DELETE /api/secrets[/:name]` | Which secrets are set; set or remove one |
| `POST /api/models/test` `{model}` | Call a model once (chat, embedding or rerank) |
| `GET/PUT/DELETE /api/knowledge[/:path]` | The knowledge folder |
| `POST /mcp` | MCP endpoint for process harnesses (per-run token; not proxied publicly) |

## How a run executes

The scheduler is `server/runtime/engine.ts`.

- **Entry.** The input goes out from every top-level human with an outgoing
  edge or a room. Without such a human it goes to the `on_start` agents, or
  else to the first component with no incoming edge.
- **Edges.** A value goes through `filter`, then `transform`, then `gate`,
  then coercion to the target port's type. Each step emits an event.
  - Gates evaluate `expr:`, `judge: <agent>`, `check: <command in the sandbox>`
    or free text (an LLM judges it).
  - A failed gate blocks the value, requests approval, or routes it back
    (`route_back`, escalating after `escalate_after` failures).
- **Agents.** Each agent runs a turn per input. With `coalesce` (the default),
  inputs that arrive while the agent is busy are merged into one turn.
  `queue` runs them one by one; `parallel` runs them at once. A turn has
  these stages:
  1. The input stages run.
  2. Context is added: instructions, then `auto_inject` / `pinned` reads
     through each access edge's binding (query → plugin retrieval → format,
     within `budget_tokens`), then room transcripts.
  3. The loop runs.
  4. The output stages run. Failures follow `on_fail`; `retry` asks the
     model again.
  5. History is kept with the agent's strategy, and `after_turn` writes go
     to memory.
- **What an agent can call.**
  - Catalog tools.
  - Tools of connected envs and plugins, narrowed by `binding.tools`. Read-only
    edges keep only read tools.
  - `ask_<id>` for each call edge (a synchronous request; call cycles are
    refused).
  - `transfer_to_<id>` when it has more than one handoff.
  - `spawn_subagents` when it can spawn.
- **Agent safeguards.**
  - Irreversible tools, and tools matched by a `require_approval` policy, wait
    for a person.
  - A turn makes at most `3 × max_steps` model calls.
- **Functions.** A function with one input port receives the value itself; with
  several it receives `{port: value}`. `join: all` waits for every required
  port. Returning `{port: value}` with output-port keys picks the outputs that
  fire.
- **Groups.** Input ports forward to the members wired to them. A value that
  reaches an output port either starts another round (`iterate`, until
  `until` holds or `max_rounds` is reached) or leaves the group. A group that
  is the target of a call edge replies with its output.
- **Rooms.** Posting wakes the next speaker(s) by the room's policy:
  - `round_robin`: the next member in turn.
  - `mention`: whoever is `@named`.
  - `selector`: an LLM picks the next speaker.
  - `free`: every other agent.

  A person who opens a room without naming anyone reaches the first agent.
  A message containing `TERMINATE`, or a `termination` expression that holds,
  ends the conversation.
- **People.**
  - A call to a human asks them: for approval if they approve, otherwise for
    a reply.
  - A message to a human who has outgoing edges asks them to reply.
  - A message to a starter, or to a human with no outgoing edges, is the
    run's result.
- **Limits.** `budget.usd`, `budget.max_rounds` (component activations),
  `budget.wallclock_min` and each agent's `budget_usd`. A run ends when
  nothing is left to do, a limit is reached, or it is stopped.

## Agent loops (native harness)

| Loop | What it does |
| --- | --- |
| `react` | Model → tool calls → results, until it answers, up to `max_steps` |
| `single_shot` | One model call, no tools |
| `plan_execute` | Writes a plan (`planner` model), then ReAct with the plan in view. Re-plans once when the result reports failure |
| `reflexion` | ReAct, then a critique (`critic` model, `critique` prompt). Retries with the lessons up to `max_trials`, until the critic says OK |
| `tree_search` | `branches` candidate answers per level, scored by the `evaluator`. The best one is expanded, `depth` levels |
| `custom` | `loop_fn` (see [contracts](contracts.md#what-code-can-use)) |

## Harness adapters

Each agent whose loop is not the platform's own is driven by an adapter in
`server/runtime/harness/`. The platform's tools for that agent reach it
over the run's MCP endpoint, under a per-run token. These calls go through
the same hooks, approvals, policies and events as native tool calls.

| Runner | How it is driven |
| --- | --- |
| `claude-code`, `claude-agent-sdk` | `claude -p --output-format stream-json`, `--append-system-prompt` for context, `--resume` for the session, `--mcp-config` with only the platform tools allowed |
| `codex` | `codex exec --json` / `codex exec resume <id>` |
| `acp` | Agent Client Protocol over stdio (`initialize`, `session/new` with the MCP server, `session/prompt`). Permission requests are declined |
| `custom-stdio`, `openai-agents-sdk` | `harness.command`. One JSON line in: `{type: "deliver", input, context, session, mcp}`. JSON lines out: `output`, `usage`, `session`, `log`. Plain stdout is the reply |
| `a2a` | `message/send` to the card's URL; the context id carries the conversation |
| `langgraph` | `POST {url}/threads/{id}/runs/wait` with `assistant_id` (from `loop_params.assistant_id` or the agent name) |

In a dry run, these agents are run by the test model with the ReAct loop
instead.

## Models

| Provider | Path |
| --- | --- |
| `anthropic` | Official SDK, always streamed. Adaptive thinking is on by default for Claude 5 Opus / Sonnet / Fable, unless a temperature is set or `api.params.thinking` turns it off. `web_search` in the tool catalog becomes the provider's web search tool |
| `openai`, `google`, `openai_compatible`, `local` | Chat completions (`/chat/completions`, with tool calls), `/embeddings`, and `/rerank` (Cohere / Jina / TEI shapes) |
| `mock` | The built-in test model. Canned text, JSON shaped to the requested schema, and scripted replies via `api.params.script` (strings or `{tool, input}`) |

## Plugins and envs

| Component | Runtime |
| --- | --- |
| Memory | The memory policy runs on each `after_turn` write: extract → classify → merge (append, dedupe, LLM resolve) → retain (ttl, decay, cap) → consolidate (summarise, reflect, custom). Reads go through the retrieval pipeline. Records persist per scope (agent, group, end user, system). Tools: `memory_search`, `memory_write` |
| Knowledge | Sources are folders, files or URLs under the knowledge folder, indexed per run: load → chunk (recursive, fixed, headings, whole) → enrich. Search goes through the retrieval pipeline: BM25, vector (embedding model; falls back to BM25 with a warning), RRF or weighted fusion, filters, rerank (model or LLM), top-k, MMR or budget, format |
| Workspace | A folder per plugin (or per agent or group for those scopes). `list_files`, `read_file` and `write_file` are confined to it |
| Board | Tasks with owner and state: `task_list`, `task_create`, `task_update` |
| Custom plugin backends | `mcp` (tools from the server), `http` (`POST {url}/tools/{name}`, hooks at `{url}/hooks/{hook}`), `code` (a command, JSON on stdin) |
| Room env | A shared transcript (kept across runs when `history: persistent`) and speaking policies |
| Sandbox env | A Docker container per run (or kept, for other lifecycles) with `/work` mounted. No network unless `egress` is set. Tools: `bash`, `edit_file`, `run_tests`, `list_work` |
| Database env | SQLite (`image: sqlite:<path>`, or its own file). Named templates become tools; `text_to_sql` adds `ask_database`. Read-only envs only run SELECTs |
| Imported env (mas-env/1) | Health check, start (with local exec), reset per run, then its MCP tools (HTTP or stdio, with a bearer token from secrets) |

## Tests

`npm test` covers the runtime with the test model:
- human → agent → human
- a call edge used as a tool
- an approval answered by a person
- function routing
- template, JSONata and Python functions
- the round limit
- memory across runs
- the paper call counts (Mixture-of-Agents makes 7 model calls; Multiagent Debate makes 6)
- every built-in template dry-run to the end without errors
- a stdio harness listing and calling platform tools over MCP
