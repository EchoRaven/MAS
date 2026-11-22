# Contracts

Everything in MAS Studio plugs together through a small set of interfaces.
This page states their rules; [components.md](components.md) shows working code
for each one.
The canvas and the YAML both edit one document, `SystemDoc` (spec 0.2,
`src/model/types.ts`); the validator (`src/model/validate.ts`) enforces the
rules below.

## Components and ports

| Kind | What it is | Ports |
| --- | --- | --- |
| `agent` | A wrapper: input stages → context → harness loop (model + tools) → output stages | editable |
| `model` | One model call. No loop, no tools. With `replicas`, N calls in parallel and the list of replies (an ensemble in one component) | editable |
| `function` | Code between components: transform, route, merge | editable |
| `human` | Approves, guides, answers | fixed `in` / `out` (message) |
| `group` | A sub-system with its own canvas | editable; inside, inputs act as sources and outputs as targets |
| `env` | Where agents act: imported app, sandbox, browser, database, service, room, external | none, used through access edges |
| `plugin` | Adds a capability to agents: memory, knowledge, workspace, board, custom | none, used through access edges |

A port is `{ id, type, schema?, required? }`. Port ids are unique across a
component's inputs and outputs.

| Type | Value |
| --- | --- |
| `message` | `{ role, content: (text \| image \| file)[], meta }` |
| `text` | string |
| `json` | JSON value; `schema` names an entry in `schemas` |
| `file` | `{ uri, mime, name }` |
| `event` | `{ type, payload }` |
| `any` | anything |

Built-in coercions, which need no transform: text→message, message→text,
json→text, json→message, file→message, message→file, event→message and
event→text. Any other pair needs a transform on the edge. So does json→json
when both ports name different schemas.

## Edges

Data edges run from an output port to an input port. `kind` sets the
interaction:

| Kind | Meaning |
| --- | --- |
| `message` | Async post |
| `call` | Request with a reply on the same edge. A cycle of calls is an error |
| `handoff` | Passes control. `carry` is `none`, `summary` or `full` |

Optional parts of a data edge:

- **`transform`:** a function that maps the value to what the target port expects
- **`filter`:** delivers only when the expression is true
- **`gate`:** a check that must pass before the edge is crossed

Access edges (`kind: access`, port `res`) run from an agent or human to an
env or plugin on the same canvas. Each carries one `binding`, which works
the same way for every resource:

```yaml
binding:
  mode: tool | auto_inject | pinned
  read:  { query: <fn>, top_k: 5, filter: "<expr>", format: <fn>, budget_tokens: 4000 }
  write: { when: agent_tool | after_turn | never, extract: <fn> }
  tools: [names]          # allowed tools of the env / plugin (empty = all)
```

## Functions

All user code uses one contract: edge transforms, function nodes, agent
stages, plugin hooks and binding query/format/extract.

```
f(input, ctx) -> output | null        # null drops the value
lang: template | jsonata | js | python | llm
```

Function nodes receive the value itself when they have one input port, and
`{ <input port>: value }` when they have several. They return
`{ <output port>: value }` to choose which outputs fire.

A value on a `message` port is `{ role, text, content, from, meta }`.
`content` mirrors `text`, and code may change either one.

### What code can use

| Language | How it runs |
| --- | --- |
| `js` | The body of `async function (input, ctx)`. A single expression without `return` also works. The names in the slot's signature are locals: `query`, `lists`, `hits`, `records`, `record`, `similar`, `turn`, `doc`, `chunk`, `source`, `event`, and for loops `model`, `tools`, `memory`, `emit` |
| `python` | The body of `def f(input, ctx):` in a fresh `python3`. `ctx` is data only |
| `jsonata` | An expression over `input`, with `$ctx` |
| `template` | `{{path}}`, `{{#each path}}…{{this.x}}…{{/each}}`, `{{#if path}}…{{else}}…{{/if}}`, and helper calls `(name arg key=value)` |
| `llm` | The code is a template prompt; the reply is the output |

`ctx` always has:
- `run_id`, `run_input` (the text the run was started with, so a step deep in a pipeline can still see the original task), `node`, `edge`
- `vars`: shared by the whole run, writable
- `now`: milliseconds
- `llm(prompt, data?, model?)`
- `log(text)`
- `state`: `get(key)`, `set(key, value)`, `all()`: the system's own JSON store, kept across runs (at most 1 MB; `GET/DELETE /api/systems/:id/state`)

A function component also has:
- `tool(name, args)`: a tool of an env or plugin it is connected to by an access edge, run with no model (read-only access gives read-only tools); each call is a tool event in the run
- `call(name, text)`: ask a model, agent or function it is connected to by a call edge (by name or id) and get its reply; each call and reply is a message in the run. The function's own return goes along its message edges only, never to what it calls (MACM's loop calls its Thinker, Judge and Executor this way)

Where it applies, `ctx` also has:

| Where | What `ctx` adds |
| --- | --- |
| Plugin hooks | `search(query, k)`, `list(dir)`, `tasks()`, `self` |
| Memory steps | `retrieve(query)` |
| Agent hooks | `ask_human(event)`, which returns the event if approved and `null` otherwise. `event.tool` is `{ name, effect, source }` |
| Custom loops | `task`, `history`, `messages`, `system`, `react(extra?)` |

The `model`, `tools` and `memory` that custom loops receive:

| Name | What it offers |
| --- | --- |
| `model` | `model(prompt, data?)`, `model.call(prompt or messages, data?)` → text, `model.json(prompt, data?)` → parsed JSON |
| `tools` | `tools.list()`, `tools.call(name, args)`, `tools.call_agent(name or id, instruction)` |
| `memory` | `memory.search(query)`, `memory.write(text)` |

## Agent stages (the wrapper)

`pipeline.pre` runs on every incoming value before the harness sees it.
`pipeline.post` runs on every reply before it leaves a port. The available
ops are `parse_json`, `validate` (against a schema, with an `on_fail`
policy), `transform`, `filter`, `route` (returns `{ <port>: value }`),
`redact` and `summarize`.

## The step registry

Every configurable stage in the framework is a **slot** in `src/model/steps.ts`. Each slot offers presets, and each preset declares its parameters (number, text, bool, select, model of a given kind, list, prompt). Every slot also offers `custom`, a function. A configured stage is stored as:

```yaml
{ use: <preset id> | custom, params: { ... }, fn: <FunctionSpec, custom only> }
```

The inspector draws its forms from these declarations. To offer a new method everywhere, add a preset to `STEP_CATALOG`.

| Pipeline | Slots, in order | Lives on |
| --- | --- | --- |
| Retrieval | rewrite → search (several, run together as hybrid search) → fuse → filter (several) → rerank → select → format | `plugin.spec.retrieval`; per-agent overrides in `binding.read.retrieval` |
| Indexing | load → chunk → embed → enrich, re-indexed on a schedule | `plugin.spec.index` |
| Memory lifecycle | extract → classify → merge → retain, plus consolidate | `plugin.spec.memory` |
| Agent loop | react · plan_execute · reflexion · tree_search · single_shot · custom | `agent.harness.loop`, `loop_params`, `loop_fn` |

What a custom step receives and must return:

| Slot | Signature |
| --- | --- |
| rewrite | `(input, ctx) => string \| string[]` |
| search | `async (query, ctx) => [{ id, text, score, source, meta }]` |
| fuse | `(lists, ctx) => hits` |
| filter / select | `(hits, ctx) => hits` |
| rerank | `async (query, hits, ctx) => hits` |
| format | `(hits, ctx) => string` |
| load | `async (source, ctx) => docs` |
| chunk | `(doc, ctx) => chunks` |
| embed | `async (texts, ctx) => vectors` |
| enrich | `async (chunk, ctx) => meta` |
| extract | `async (turn, ctx) => records` |
| classify | `async (record, ctx) => type` |
| merge | `async (record, similar, ctx) => { action, record }` |
| retain | `(record, ctx) => keep?` |
| consolidate | `async (records, ctx) => records` |
| loop | `async (ctx, { model, tools, memory, emit }) => output` |

Model parameters must name a catalog model of the right kind. A model's `kind` is `chat` (the default), `embedding` or `rerank`.

## Agent hooks

`agent.hooks` can hold code for any of these points in a turn:

- `on_start`
- `before_model` and `after_model`
- `before_tool` and `after_tool`
- `on_error`
- `on_finish`

A hook has the signature `f(event, ctx) -> event | null`. Returning `null`
from a `before_*` hook blocks the action. If a harness exposes no step hooks
(Claude Code, ACP, custom programs), the tool hooks still run at the platform
boundary. Every platform tool reaches those harnesses through the run's MCP
endpoint, and each call goes through the hooks, approvals and policies.

## Database environments

An `env.db` entry controls how agents may query a database:

| `mode` | What agents can do |
| --- | --- |
| `templates` | Run the named parameterised queries. Each one becomes a tool, and its `:params` become the tool's arguments. |
| `text_to_sql` | Ask a model to write SQL. The model sees only the tables in `tables`. |
| `tools` | Use the env's own MCP tools. |
| `custom` | Send the request to `fn`, which receives the connection. |

`read_only` and `row_limit` are enforced on the connection itself, not inside the query.

## Editing any definition directly

Every component and edge has an "Edit as YAML" view in the inspector, which covers everything the forms do not. Applying it replaces the definition, as long as the component's `kind` stays the same (and, for an edge, its ends are existing components).

## Conformance: the gate for every import

Nothing joins a system unless it meets its contract. Every importer first converts its source format to the contract, then checks it against a named list of rules (`src/model/conformance.ts`):

- An **error** rule that fails blocks the import.
- A **warning** rule that fails is shown but does not block.

This applies to:

- importing a component from the canvas
- importing a whole system YAML, which is refused if any component fails

| Contract | Error rules (all must pass) | Warning rules |
| --- | --- | --- |
| `mas-agent/1` | **Identity:** has a name.<br>**Harness:** known adapter, tier matches the adapter, launch command for process harnesses, endpoint URL for remote ones, `path:attr` for LangGraph.<br>**Capabilities:** declared with valid values.<br>**Interface:** at least one input and one output; ports are lowercase identifiers, unique, of a known type.<br>**Code:** known modalities, valid stages, hooks and loop. | JSON schemas it names exist in the system; tools it names are in the catalog |
| `mas-plugin/1` | **Identity:** has a name.<br>**Scope and backend:** valid scope; backend with what it needs (an HTTP URL, an MCP URL or command, a code command).<br>**Tools:** identifier names, unique, with a declared effect.<br>**Code:** valid hooks; valid pipeline steps (known method, or custom with code).<br>**Purpose:** provides tools, hooks or a pipeline. | Every tool has a description |
| `mas-env/1` | **Identity:** id, name, a known kind.<br>**Lifecycle:** a health check.<br>**Exposes:** an MCP server or an HTTP base; HTTP bases are URLs; MCP transport with a URL or start command; unique tool names.<br>**Secrets:** none in the manifest. | Has a reset; says how to start; lists its MCP tools; an OAuth MCP server has a login route |
| `mas-function/1` | **Identity:** has a name.<br>**Code:** supported language, not empty.<br>**Interface:** valid, as for agents.<br>**Join:** `join` is `any` or `all`. | With `join: all`, the awaited inputs are marked required; with several outputs, the code returns `{ <output>: value }` |

Built-in templates are held to the same contracts; a test fails if any of their components does not conform.

### `mas-function/1`

```yaml
contract: mas-function/1
name: Route by priority
join: any                  # any | all (wait for every required input)
interface:
  inputs:  [{ id: ticket, type: json }]
  outputs: [{ id: urgent, type: json }, { id: normal, type: json }]
fn: { lang: js, code: "return input.priority >= 3 ? { urgent: input } : { normal: input };" }
```

A bare source file can be imported too. The language comes from the extension:

| Extension | Language |
| --- | --- |
| `.js`, `.mjs`, `.ts` | js |
| `.py` | python |
| `.jsonata` | jsonata |
| `.hbs` | template |
| `.prompt` | llm |

A bare file gets the default interface (`in` → `out`). It is checked like any other function.

## Bringing in outside code: every entry point

Everything from outside joins through one of these. Each has a contract, and
each is checked before it joins.

| You have | Bring it in as | Contract | What it must provide |
| --- | --- | --- | --- |
| An agent program (any language) | `agent` with a harness adapter | `mas-agent/1` | A protocol (`stdio-jsonl`, `acp`, `a2a`, `claude-code`, `codex`, LangGraph), a launch command or URL, an interface (ports) |
| A Claude Code subagent, A2A card, `langgraph.json` | `agent` | `mas-agent/1` (converted) | The file as it is |
| A web app, API or MCP server with state | `env` | `mas-env/1` | A health check, an MCP server or HTTP base, ideally a reset |
| A capability shared by agents (memory, search, a CRM) | `plugin` | `mas-plugin/1` | A backend (`mcp`, `http`, `code`), tools with declared effects, optional hooks |
| A piece of code between components | `function` | `mas-function/1` | `f(input, ctx) -> output`, in `js`, `python`, `jsonata`, `template` or `llm` |
| A single tool | catalog tool | [Catalog tools](#catalog-tools) | An adapter (`mcp`, `http`, `cli`, `code`), an argument schema, an effect |
| A model endpoint | catalog model | [Models](#models) | An OpenAI-compatible, Anthropic or Gemini endpoint; the key stays in an env var |
| A benchmark | dataset | [Datasets](#datasets) | JSON lines or text in a known format, or a JavaScript adapter |
| A whole system | system YAML | `SystemDoc` 0.2 | Every component passes its contract |
| A server, as code (an MCP server, a backend) | a hosted service | `mas-host.yaml` ([hosting.md](hosting.md)) | An archive or git URL, a start command, what it exposes (`mcp-stdio`, `mcp-http`, `http`); runs in Docker here |
| A server somewhere else | a remote endpoint | `endpoint: { remote: { url, bearer_env?, headers? } }` | A URL; auth as a secret name or headers |

The rules are the same for all of them:

- **Nothing runs on trust.** Importers convert to the contract first, then the
  conformance rules decide; an error blocks the import.
- **Secrets are never in the file.** Documents name the environment variable
  that holds a key.
- **Effects are declared.** Every tool says whether it is `pure`, `read`,
  `write` or `irreversible`, so policies and read-only access can apply to
  code the platform did not write.
- **Outside harnesses use the platform's tools through MCP.** Hooks,
  approvals, policies and events apply to them as to native agents.
- **Where an outside server is, is one endpoint.** Plugin backends, catalog
  tools and imported envs' MCP servers take `endpoint: { remote: … } | {
  hosted: … }`, so the same component can use a server elsewhere or one
  hosted on this server ([hosting.md](hosting.md)).

## Import contracts

Each contract has its own importer in `src/model/`.

### `mas-agent/1` (`agentspec.ts`)

```yaml
contract: mas-agent/1
name: My agent
harness:
  protocol: stdio-jsonl | acp | a2a | claude-code | codex
  command: ./my_agent --json        # or url: for a2a
  capabilities: { context_control: none, tool_injection: [mcp] }
interface: { inputs: [...], outputs: [...] }
instructions: ...
```

Other formats it accepts:

- Claude Code subagent `.md`: frontmatter plus the prompt body. Maps to the `claude-code` adapter.
- A2A Agent Card JSON. Maps to the `a2a` adapter, with the card's `url`.
- `langgraph.json`. Maps to the `langgraph` adapter.

Messages in the stdio-jsonl protocol, one JSON object per line:

- platform → agent: `{"type":"deliver","port":"in","message":{...},"context":{...},"tools":[...]}`
- agent → platform: `status`, `tool_call`, `output` (`{"port":"out","value":...}`) and `usage`

### `mas-env/1` (`envspec.ts`, `scripts/import-env.mjs`)

| Field | Required | Contents |
| --- | --- | --- |
| `lifecycle` | yes; `health` must be present | `start`, `stop`, `health`, `reset`, `init_tenant` |
| `exposes` | yes; at least one entry in `http` or `mcp` | `http: [{ name, base }]`, `mcp: { transport, url \| start, auth, env, tools }` |
| `runtime` | no | `{ compose, variant: build \| hub, network: host \| bridge, services }` |
| `auth` | no | `{ mode, login, test_users: [{ email, password_env }] }`. Passwords are never stored, only the env var that holds them |
| `state` | no | `{ seed, snapshots }` |
| `tasks` | no | `{ dir, judge }` |

The canvas import dialog accepts a manifest, a DT `registry.yaml` or a
compose file. For a whole folder, run the script:

```bash
node scripts/import-env.mjs <env-gen delivery dir | DT dt_arena/envs/<env> | compose dir> [-o env.mas.yaml]
```

It reads the folder without writing to it. It collects:

- the compose services and ports
- the FastMCP tools (from `@mcp.tool` functions)
- the reset, init-tenant and login routes the backend serves
- seed files and snapshots

For env-gen deliveries it also overrides the MCP server's `API_BASE_URL`
with the port the compose stack publishes.

### `mas-plugin/1` (`plugins.ts`)

```yaml
contract: mas-plugin/1
name: CRM lookup
scope: agent | group | end_user | run | system   # run: empty at the start of every run; system: shared by all runs, kept
backend: { kind: builtin | mcp | http | code, url, command, config }
tools: [{ name, description, effect: pure | read | write | irreversible }]
hooks:
  before_turn: <fn>   # ctx -> text added to the context, or null
  after_turn:  <fn>   # turn -> records to store, or null
  on_start:    <fn>
```

A task's scratchpad (notes, drafts, a codebase, a ledger) takes scope `run`.
With `system` every run of the system shares one folder, kept between runs, so
evaluation cases that run at the same time, and later ones, read each other's
files. Agents' Room's stories mixed for this reason until the scope existed.
`system` is for what should carry over, such as Reflexion's lessons or Voyager's
skills.

The `memory`, `knowledge`, `workspace` and `board` presets fill in these
fields for you. Switching a plugin to `custom` keeps its current values and
makes them all editable.

## Ensembles: `replicas`

A model component can sample its call several times per input:

```yaml
kind: model
replicas: 10                 # or "{{vars.n}}", or "{{vars.n ?? 10}}" (a run variable, with a default)
interface: { outputs: [{ id: out, type: json }] }   # the list of replies
```

The calls run in parallel (each through the server's rate limit) and the
output is a JSON array of the replies, for a function to vote on or merge.
`replicas` is 1–50; 1 or absent is a plain call. A group's `iterate.max_rounds`
takes the same forms (1–100), so a debate's rounds can be swept the same way. Reading it from a run
variable lets an evaluation sweep the ensemble size (`vars: {n: 5}`) without
changing the system. The validator warns when the output port is not `json`
or `any`, and the simulator counts N calls in its estimates.

A group's `iterate.over` (an expression, for example `input.plans`) makes
each round take the next item of a list picked from the group's input; the
rounds are then at most the list's length. See
[components.md](components.md#3-ensembles-replicas-and-a-vote).

## Catalog tools

A tool in the system's catalog (`tools`) that agents list by id:

```yaml
id: lookup_order
description: Find an order by its number
adapter: http | mcp | cli | code | builtin
effect: pure | read | write | irreversible
input_schema: '{"type":"object","properties":{"number":{"type":"string"}},"required":["number"]}'
url: https://…            # http: POST the arguments as JSON · mcp: the server that has this tool
command: ./lookup         # cli: arguments as JSON on stdin, stdout is the result
fn: <FunctionSpec>        # code: fn(args, ctx)
needs_env: database       # optional: served by a connected env of this kind instead
```

`cli` tools run on the host only with `MAS_ALLOW_LOCAL_EXEC=1`; otherwise give
them a sandbox env.

## Sandbox tools

A sandbox env (Docker, `/work` mounted, no network unless `egress` lists
hosts) gives the agents connected to it:

| Tool | Contract |
| --- | --- |
| `bash` | `{command}` → `exit <code>\n<output>` (cwd `/work`, 2 min) |
| `edit_file` | `{path, content?}`: write `content`, or read when it is left out |
| `run_tests` | `{command?}` → `exit <code>\n<last lines>`. Without a command it finds `test*.py`, `*_test.py` or `tests/*.py` and runs pytest if the image has it, else calls every `test_*` function in them (plain `assert`s); `npm test` for a `package.json`. The exit code is the tests' |
| `list_work` | the files under `/work` |

The run's input, as it was given, is in `/work/input.txt` (in each agent's
folder with `share: per_agent`). When the input is long (over 2,000
characters), an agent connected to the sandbox is told so with its turn,
to read the file in its code instead of copying the text into a command: a
note in the `bash` tool's description alone was ignored in 27 runs of 27,
each pasting a 44,000-character ledger into a heredoc.

Templates that write tests use plain `test_*` functions with `assert`, so they
run in any Python image.

## Results of a run

What a run returns is the value that reaches the person who started it, the
last message of a room conversation (on `TERMINATE`, a `termination`
expression, or when nobody is next), an agent's `finish` answer, or the value
an output policy ends the run on. Graders read that text:

- **Answers:** the last `Answer:` / `Final:` line, else the last line;
  `\boxed{…}` wins for numbers; a trailing `TERMINATE` is not the answer.
- **Code:** the last ```` ```python ```` block, else the whole reply. A coding
  system's last message has to contain the code, not a report about it.

A system can declare what its runs return:

```yaml
result: { type: text | number | code | json | choice, choices: [buy, sell, hold], description: … }
```

Each finished run's answer is checked against it. The check is stored on the
run (`result_check: {type, ok, why}`) and logged as a warning when it fails.
Evaluations mark such cases (`result_ok: false`) and group them first under
"Why cases failed", since the wrong kind of answer is a bug in the system,
not a wrong answer.

A case that gave no output because a provider failed in passing (a 5xx,
overloaded, a dropped stream, a 429) runs once more after the others; the
record counts them (`auto_retried`) and a second failure stands. Account
errors (a bad key, no credit) are not retried: three in a row stop the
evaluation.

On a miss graded by rule (answer, number, math), the evaluation also reads
the messages the run's members (model and agent components) sent and records
which of them marked the right answer on the way (`reached: [names]`; empty
when none did). Only marked answers count (a "Final:" or "Answer:" line, a
`\boxed{}`), each message's last one, and a list (a component's replicas)
item by item, even where the log cut it short at 6000 characters. Such
misses group as "a member had it, the team lost it": the team found the
answer and its way of combining lost it, which a better aggregator could
fix; the other misses nobody found. A system that calls its models from
inside a function (MacNet) logs no member messages, so nothing is found
there. Regrading an evaluation by rule checks again from the runs' logs,
which fills `reached` in for evaluations from before it was recorded; Compare
shows each one's count ("Had it, lost": 3 of 9). The Evaluate page warns before a run when the declared
type does not fit the grader (a system that returns a number, graded by
running code). `choice` without `choices` means an option letter.

## Open-ended tasks: grader `none` and pairwise judging

An evaluation with grader `none` runs every question and keeps the outputs
without grading them: for tasks with no single right answer (an article, a
story). Two such evaluations of the same questions are compared with
`POST /api/evals/pairwise`: a model reads both outputs for each question and
says which is better, once with each first, so that a preference for the
first or the second response cancels out; a question counts as a win only
when both orders agree, and as a tie otherwise. This is how the writing
papers (STORM, Agents' Room) report their results.

A judge rewards length and structure, so a win over a plain model call should
also hold at matched length. The Evaluate page's length-matched control is an
ordinary evaluation of "Single model call (baseline)" on the same questions
(the same dataset and sample, or the same cases), with grader `none` and the
run variable `style` set to `"\n\nAim for about N words."`, N being the
judged evaluation's mean words rounded to ten. Judgements name each side by
its setup (system, models and run variables), so the control shows as such.

## Datasets

A dataset is a list of cases `{input, expected}` with a name, a source
(`origin`, `license`, `citation`), a default grader and a version (a hash of
the cases). `POST /api/datasets` takes the raw text and a `format`:

| Format | Each record | Becomes |
| --- | --- | --- |
| `auto` | any of the below, or `question \| answer` lines, CSV with question/answer columns | detected per record |
| `gsm8k` | `{question, answer}` with the final answer after `####` | the number after `####` |
| `mcq` | a question with `choices` or `options` (a list of 2–10) and `answer` as a letter or an index | lettered options; the expected letter |
| `qa` | `{input \| question \| prompt \| problem, expected \| answer \| target \| label}` | as given |
| HumanEval | `{prompt, test, entry_point}` | a code case (below), graded with `code` |
| `custom` | anything | `adapter(record) → {input, expected}`, JavaScript, 2 s per record |

Evaluations take `dataset_id` and an optional `sample: {n, seed}`; the same
seed always draws the same cases, in their original order.

## Graders

| Grader | Passes when |
| --- | --- |
| `answer` | the final answer equals the expected one (normalised); an option letter matches "B. …" |
| `number` | the number in the final answer equals the expected one (fractions; a percentage matches either 40 or 0.4) |
| `contains` | the whole output contains the expected text |
| `llm` | a judge model says the output gives the expected answer |
| `code` | the code passes the case's tests in a fresh container (below) |

A code case's `expected` is JSON:

```json
{"kind": "code", "prompt": "<signature and docstring>", "test": "def check(candidate): …", "entry_point": "f"}
```

The grader takes the last Python block of the answer. If it defines
`entry_point`, it gets the prompt's imports in front; if it is only a body, it
goes under the prompt. Then it runs `test` and `check(entry_point)` in
`python:3.12-slim` with no network, 512 MB, one CPU, 128 processes, a
read-only file system, for 10 seconds.

## Models

Each model entry has `api: { base_url, key_env, headers, params }`. API keys
are never stored in the document; `key_env` only names the environment
variable that holds the key.

A call that fails in passing is asked for again by the runtime, not the
system: a 429 or an overload waits as long as the provider says (Gemini's
`retryDelay`, `Retry-After`) or backs off; a stream the provider cuts off
halfway ("terminated", a reset) is asked for again up to three times; and a
reply with nothing in it (no text, no tool call, 0 output tokens, not stopped
at the token limit: gemma after 11 minutes on a hard question) once more.
A call whose component sets no `max_tokens` is limited to 32,768 output
tokens (`MAS_MAX_OUTPUT`): of 44,436 calls, 99.9% replied in under 3,100,
and the replies over 32,000 were all repetition loops with no answer (most
ran to 65,536 tokens, the cost of about a hundred answers). The limit was
16,384 at first, which cut off an agent writing a program with a long
input pasted in. A reply that stops at the limit is logged as such (an
error when nothing usable is left), and an evaluation groups those cases
under "no output: reply cut at the output limit". A model can set its own
default in `api.params.max_output` (a number, or `null` for none; the
provider never sees it). A model that thinks before it answers spends its
thinking from the same allowance, so gemma's entry has `null`: no platform
limit on top of the provider's (stored systems get it by migration). On a
few of the hardest questions gemma's thinking still runs past the
provider's own maximum and leaves no answer, with or without our limit:
that is the model's failure, and it stays a miss. (This was first blamed on
the default limit; removing it changed nothing.)
Replies are streamed, so a model that thinks for minutes is not cut off
waiting for headers. Requests per minute are capped per provider (`MAS_RPM`, 60
by default).

## Migration

Documents from spec 0.1, stored or imported, are upgraded by
`src/model/migrate.ts`:

- Rooms become `env` nodes with `env_kind: room`.
- Stores become plugins.
- Agent context sources become access-edge bindings.
- A group's `entry` and `output_from` become edges on the group's ports.
- Edges that crossed a group boundary are routed through the group's ports.
