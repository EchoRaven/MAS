# Contracts

Everything in MAS Studio plugs together through a small set of interfaces.
The canvas and the YAML both edit one document, `SystemDoc` (spec 0.2,
`src/model/types.ts`); the validator (`src/model/validate.ts`) enforces the
rules below.

## Components and ports

| Kind | What it is | Ports |
| --- | --- | --- |
| `agent` | A wrapper: input stages → context → harness loop (model + tools) → output stages | editable |
| `model` | One model call. No loop, no tools | editable |
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
scope: agent | group | end_user | system
backend: { kind: builtin | mcp | http | code, url, command, config }
tools: [{ name, description, effect: pure | read | write | irreversible }]
hooks:
  before_turn: <fn>   # ctx -> text added to the context, or null
  after_turn:  <fn>   # turn -> records to store, or null
  on_start:    <fn>
```

The `memory`, `knowledge`, `workspace` and `board` presets fill in these
fields for you. Switching a plugin to `custom` keeps its current values and
makes them all editable.

## Models

Each model entry has `api: { base_url, key_env, headers, params }`. API keys
are never stored in the document; `key_env` only names the environment
variable that holds the key.

## Migration

Documents from spec 0.1, stored or imported, are upgraded by
`src/model/migrate.ts`:

- Rooms become `env` nodes with `env_kind: room`.
- Stores become plugins.
- Agent context sources become access-edge bindings.
- A group's `entry` and `output_from` become edges on the group's ports.
- Edges that crossed a group boundary are routed through the group's ports.
