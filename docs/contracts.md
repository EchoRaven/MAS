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
ctx = { run_id, node, edge, vars, now, tools }
```

Function nodes receive `{ <input port>: value }` when they have several
inputs. They return `{ <output port>: value }` to choose which outputs fire.

## Agent stages (the wrapper)

`pipeline.pre` runs on every incoming value before the harness sees it.
`pipeline.post` runs on every reply before it leaves a port. The available
ops are `parse_json`, `validate` (against a schema, with an `on_fail`
policy), `transform`, `filter`, `route` (returns `{ <port>: value }`),
`redact` and `summarize`.

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
