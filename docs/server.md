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
| `MAS_ALLOW_LOCAL_EXEC` | off | Allow commands on the host: custom stdio / ACP harnesses, `cli` tools, MCP servers started as a command (plugins and envs), env start commands, and sandboxes when Docker is missing. An MCP server reached by URL needs no opt-in |
| `MAS_DOCKER` | `docker` | Docker binary for sandbox envs |
| `MAS_AGENT_RUNTIME` | `container` | Where Claude Code and Codex agents run: `container` (their own hardened container per turn; models through the model gateway, tools through the MCP gateway, no key inside) or `host` (this machine, as the server's user; also needs `MAS_ALLOW_LOCAL_EXEC=1`) |
| `MAS_CLAUDE_PKG`, `MAS_CODEX_PKG` | — | Folders where the `claude` / `codex` npm packages are installed (holding `node_modules/.bin/<cli>`); mounted read-only into the agent's container with the server's Node runtime |
| `MAS_AGENT_IMAGE` | `python:3.12-slim` | Base image for CLI agents' containers |
| `MAS_MODEL_GATEWAY_PORT` | MCP gateway port + 1 | Port of the model gateway on the internal network's gateway address |
| `MAS_PARALLELISM` | `4` | Component turns that run at once in a run |
| `MAS_RPM` | `60` | Model requests per minute per provider and key, for the whole server (all runs and evaluations together). Calls over it wait. A burst of hundreds a minute from one server looks like a stolen key to a provider and can get the account suspended. A model's `api.params.rpm` overrides it; local model servers are not limited unless they set one |
| `MAS_KNOWLEDGE_DIR` | `<data>/knowledge` | Where knowledge plugins read their sources |
| `MAS_CLAUDE_BIN` / `MAS_CODEX_BIN` | `claude` / `codex` | CLIs for those harnesses |

API keys go in Settings → API keys (stored in `.data/secrets.json`,
mode 600), or in the server's environment. A system names a variable, such
as a model's `api.key_env`. The browser never receives the value.

Anyone holding the token can run code on the server: JS and Python
functions, and Docker sandboxes. Treat the token like a password.

What agents reach is limited:
- **Web pages:** the `fetch` tool, and knowledge sources that are web pages, only reach public addresses. Each address, including every redirect, is checked, and the connection is made to the address that was checked, so a name cannot be re-pointed at this machine between the check and the request.
- **Isolation.** Everything that runs code an agent or a model wrote (sandbox
  envs, the code grader, hosted services and compose projects) runs in a
  container with no capabilities (`--cap-drop ALL`), no privilege gain, a
  seccomp profile (`server/runtime/isolation/seccomp.json`: mounts,
  namespaces, kernel modules, ptrace, BPF, keyrings, reboot and clock
  changes are refused; the host's Docker default allows every call), and
  limits on memory, CPUs and processes. Sandboxes and the grader also run as
  the server's user, not root, with a read-only root and a private `/tmp`.
  Network: none, or the declared hosts only through the egress proxy, which
  never reaches private addresses (this server, the internal network) and
  logs what it refuses. Agent programs (Claude Code, Codex) run in such a
  container per turn, on the internal network: they reach the platform's
  tools through the MCP gateway and models through the **model gateway**,
  which takes a token issued for that turn, refuses anything but model
  endpoints (no account, billing or admin paths), puts the real key from
  Settings on the request and sends it from this host. No key is ever inside
  a container; every call, allowed or refused, is written to the run's log
  (`gateway: POST anthropic/v1/messages → 200`). Sandboxes reach machines through a backend interface
  (`server/runtime/isolation`): Docker now; a Firecracker microVM backend (a
  kernel per box) fits the same interface where the server may open
  `/dev/kvm`.
- **Files:** workspace and sandbox file tools stay inside their folder, symbolic links included, and knowledge sources stay inside the knowledge folder.
- **Addresses in a system:** URLs written into a system (HTTP tools, MCP servers, remote agents) are used as given. The validator points out any that are on this machine or a private network.

## API

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Liveness (no token) |
| `GET /api/systems/:id/envs/:env/contents` | What is inside an env, read-only: a sandbox's `/work` files for a run (`?run=`, latest by default) or one agent's (`?agent=`, per-agent sandboxes), one file's text (`?path=`, first 100 KB), a database's tables with row counts and a table's first 50 rows (`?table=`), an imported env's services and tools |
| `GET/PUT/DELETE /api/systems[/:id]` | Systems (the browser syncs automatically) |
| `GET /api/systems/:id/versions` · `GET …/versions/:version` · `POST …/versions/:version/restore` | Earlier versions of a system. One is kept when a save changes the system, at most one every 5 minutes, the newest 50. A restore keeps the current version first |
| `POST /api/validate` | Issues and conformance failures of a document |
| `POST /api/runs` `{doc \| system_id, input, mock?, force?, vars?, save?}` | Start a run. `mock` = dry run on the test model. Validation errors refuse the run unless `force` is set. A `doc` is also stored as a system unless `save` is false |
| `GET /api/runs?system=` · `GET /api/runs/:id` | History, and one run with its events |
| `GET /api/runs/:id/events` | Server-sent events: replay, then live until the end |
| `POST /api/runs/:id/answer` `{request, approved?, text?}` | Answer an approval or a request for input |
| `POST /api/runs/:id/stop` · `DELETE /api/runs/:id` | Stop a run · delete a finished one |
| `POST /api/evals` `{system_id \| doc, cases: [{input, expected}] \| dataset_id + sample?: {n, seed}, grader?, concurrency?, repeats?, on_model?, model_map?, vars?, time_limit_min?, judge?, mock?}` | Evaluate a system: every case is a run, graded by `answer` (the final answer matches; an option letter matches "B. …"), `contains`, `number` (fractions and percentages too), `llm` (a judge model) or `code` (the answer's code is run with the case's tests in a throwaway Docker container: no network, 512 MB, 1 CPU, 10 s). With `dataset_id` the grader defaults to the dataset's, and the record keeps the dataset's id, version and sample |
| `GET /api/datasets` · `GET /api/datasets/:id` · `POST /api/datasets` `{name, text, format?, grader?, description?, source?, adapter?}` · `DELETE /api/datasets/:id` | Datasets: the built-in sample sets (`builtin-…`, read-only) and saved ones. `text` is questions or JSON lines; `format` is `auto`, `gsm8k` (`####` answers), `mcq` (choices and a letter), `qa`, or `custom` (a JavaScript `adapter` turns each record into `{input, expected}`). Records with `prompt`, `test` and `entry_point` (HumanEval) become code cases. The version is a hash of the cases |
| `POST /api/evals/batch` `{system_ids \| docs, …the same options}` | The same questions on up to ten systems. Each gets its own evaluation, `queued` until the ones before it end: they run one at a time, so a comparison never multiplies the request rate. Stopping a queued one stops it before it starts |
| `GET /api/evals?system=` (summaries, each with `set`: an id for its question set, the same for the same questions however they were given, and `set_name` when they came from a dataset) · `GET /api/evals/:id` · `POST /api/evals/:id/stop` · `DELETE /api/evals/:id` | Evaluations so far, one with its graded cases, stop one, delete a finished one |
| `GET/PUT/DELETE /api/secrets[/:name]` | Which secrets are set; set or remove one |
| `POST /api/models/test` `{model}` | Call a model once (chat, embedding or rerank) |
| `POST /api/models/health` `{models}` | What is known about each model without calling it: `ok`, `failing` (with the error), `no_key`, or `unknown`. A failure that waiting won't fix (a refused key, no credit, a used-up daily quota) is remembered for an hour, per key value: a new key starts clean |
| `GET/PUT/DELETE /api/knowledge[/:path]` | The knowledge folder |
| `POST /mcp` | MCP endpoint for process harnesses (per-run token; not proxied publicly) |

## How a run executes

The scheduler is `server/runtime/engine.ts`.

- **Entry.** The input goes out from every top-level human with an outgoing
  edge or a room that nothing sends to; when every such person also receives
  (a checker or approver in the flow), only the first one starts it. Without such a human it goes to the `on_start` agents, or
  else to the first component with no incoming edge.
- **Edges.** A value goes through `filter`, then `transform`, then `gate`,
  then coercion to the target port's type. Each step emits an event.
  - Gates evaluate `expr:`, `judge: <agent>`, `check: <command in the sandbox>`
    or free text (an LLM judges it).
  - A failed gate blocks the value, requests approval, or routes it back
    (`route_back`, escalating after `escalate_after` failures).
- **Agents.** Each agent runs a turn per input. With `coalesce` (the default),
  inputs that arrive while the agent is busy are merged into one turn.
  `queue` runs them one by one; `parallel` runs them at once; `interrupt` stops the turn under way and starts a new one with its message and the new ones together. A turn has
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
  `until` holds or `max_rounds` is reached) or leaves the group. With
  `iterate.over`, round n gets item n of a list picked from the group's input
  instead (try candidates in turn), and the list's length also bounds the
  rounds. A group that
  is the target of a call edge replies with its output.
- **Handoffs.** `carry: "full"` passes the whole conversation to the next
  agent: what the sender was handed, plus its own turn, each line named by its
  speaker. Along a chain of full handoffs the conversation accumulates, so the
  last agent reads all of it. `carry: "summary"` (the default) passes only the
  value on the port.
- **Rooms.** Posting wakes the next speaker(s) by the room's policy:
  - `round_robin`: the next member in turn.
  - `mention`: whoever is `@named`.
  - `selector`: an LLM picks the next speaker among the agents (never itself, never a person: a person speaks when `@named`).
  - `free`: every other agent.

  A post carries the message type its edge declares (`binding.write.tag`), and
  a member sees and is woken by a post only when its own subscription accepts
  it (`binding.read.filter`, an expression over `msg`: `from`, `from_name`,
  `text`, `cause_by`). Without a filter a member hears everything.
  A person who opens a room without naming anyone reaches the first agent.
  A message containing `TERMINATE`, or a `termination` expression that holds,
  ends the conversation. A termination expression sees `text`, `from`,
  `room` and `posts`, the number of messages this run has put in the room, so
  `posts >= 12` ends a conversation after twelve messages. So does a post after which nobody is next (the
  selector named no one, nobody was `@named`). The last message is then the
  conversation's answer.
- **People.**
  - A call to a human asks them: for approval if they approve, otherwise for
    a reply.
  - A message to a human who has outgoing edges asks them to reply.
  - A message to a starter, or to a human with no outgoing edges, is the
    run's result.
- **Policies.** Each has a trigger (`on`), a condition (an expression; empty = always) and an action:
  - `tool`: checked before every tool call, with `tool`, `args`, `effect` and `agent`. Actions: `block`, `require_approval`, `notify`.
  - `usage`: checked after every model call, with `usd`, `tokens`, `node`, `node_usd` and `model`. Actions: `terminate` (the run ends with the policy as its reason) and `notify` (warns once per run).
  - `output`, `output(<component>)` or `output(<component>.<port>)`: checked for every value a component sends on, with `output`, `text`, `node` and `port`. Actions:
    - `terminate`: that value becomes the run's answer, and the run ends.
    - `block`: the value is not sent on.
    - `require_approval`: a person lets it through, or not.
    - `notify`.

  The validator warns about a policy the runtime would never act on.
- **Ending.** A run ends when nothing is left to do or at a limit. Beyond that:
  - With "Agents can end the run" (`agents_can_finish` in `termination`), every agent has a `finish` tool; calling it ends the run with its answer as the result.
  - The expressions in `termination` end room conversations.
  - A policy on an output can end the run on a value.

  Once a run is stopping, nothing more is delivered.
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
| `openai`, `google`, `openai_compatible`, `local` | Chat completions (`/chat/completions`, with tool calls; calls without tools are streamed, so a model that thinks for minutes is not cut off by the HTTP client's 300-second wait for headers), `/embeddings`, and `/rerank` (Cohere / Jina / TEI shapes). Provider extras on a tool call (Gemini's `thought_signature`) are sent back with it. Rate limits wait as long as the provider asks (`Retry-After`, Gemini's `retryDelay`); overloads back off; exhausted credit or a daily quota fails at once |
| `mock` | The built-in test model. Canned text, JSON shaped to the requested schema, and scripted replies via `api.params.script` (strings or `{tool, input}`) |

## Plugins and envs

| Component | Runtime |
| --- | --- |
| Memory | The memory policy runs on each `after_turn` write: extract → classify → merge (append, dedupe, LLM resolve) → retain (ttl, decay, cap) → consolidate (summarise, reflect, custom). Reads go through the retrieval pipeline. Records persist per scope (agent, group, end user, system). Tools: `memory_search`, `memory_write` |
| Knowledge | Sources are folders, files or URLs under the knowledge folder, indexed per run: load → chunk (recursive, fixed, headings, whole) → enrich. Search goes through the retrieval pipeline: BM25, vector (embedding model; falls back to BM25 with a warning), RRF or weighted fusion, filters, rerank (model or LLM), top-k, MMR or budget, format |
| Workspace | A folder per plugin (or per agent or group for those scopes). `list_files`, `read_file` and `write_file` are confined to it. Workspaces that name the same first source share one folder, so copies of a plugin in different groups see the same files; the source `/work` is the folder a sandbox env mounts at `/work`, so one agent can write code and another run it |
| Board | Tasks with owner and state: `task_list`, `task_create`, `task_update` |
| Custom plugin backends | `mcp` (tools from the server; `examples/mcp/notes-server.mjs` is a minimal stdio server to start from), `http` (`POST {url}/tools/{name}`, hooks at `{url}/hooks/{hook}`), `code` (a command, JSON on stdin) |
| Room env | A shared transcript (kept across runs when `history: persistent`) and speaking policies |
| Sandbox env | A box per run (or kept, for other lifecycles) with `/work` mounted, from an isolation backend (Docker today; see Isolation above). No network unless `egress` lists hosts, and then only those, through the egress proxy. `share: per_agent` gives each connected agent its own box and `/work`; shared (the default) is one for all. Tools: `bash`, `edit_file`, `run_tests` (pytest when installed, else a plain-assert runner; see [contracts](contracts.md#sandbox-tools)), `list_work` |
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

The test model checks structure, not behaviour on real models. For that,
check every paper template against real models on its demo input:

```bash
TSX_TSCONFIG_PATH=tsconfig.server.json npx --no-install tsx scripts/record-demos.mts --check [paper-id…]
```

It writes nothing, runs every chat model as gemini-3.1-flash-lite, and ends
with a table: whether each template finished with an answer on its own, and
otherwise why (errors, a request for a person, a limit reached). The whole
set costs well under a dollar. To check behaviour on a benchmark, run the
template on a dataset sample on the Evaluate page and read "Why cases
failed".
