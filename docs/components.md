# Writing components: code at every interface

[contracts.md](contracts.md) states the rules for each interface. This page
shows them in use: one working example for every place where your code, or
someone else's, plugs into a system. Every example matches what the runtime
sends and expects (`server/runtime/`).

| You want to… | Write | Section |
| --- | --- | --- |
| Route, vote, merge, count between components | a function node | [1](#1-function-nodes) |
| Reshape or block a value on its way | an edge transform, filter or gate | [2](#2-edges-transform-filter-gate) |
| Run N samples and vote | `replicas` on a model, and a function | [3](#3-ensembles-replicas-and-a-vote) |
| Watch or veto an agent's steps | an agent hook | [4](#4-agent-hooks) |
| Write the agent's loop yourself | a custom loop | [5](#5-a-custom-agent-loop) |
| Bring an agent written in any language | a program on stdio | [6](#6-an-external-agent-program-mas-agent1) |
| Give agents a capability backed by your service | a plugin with an HTTP or code backend | [7](#7-a-plugin-backend-mas-plugin1) |
| Give agents one tool | a catalog tool | [8](#8-a-catalog-tool) |
| Read a benchmark in its own format | a dataset adapter | [9](#9-a-dataset-adapter) |
| Say what a run returns, and sweep settings | `result`, run variables | [10](#10-declared-results-and-run-variables) |
| Run your server here, or reach one elsewhere | a hosted service, or a remote endpoint | [11](#11-hosting-your-server-or-reaching-one) |

All code that runs inside the platform has the same contract,
`f(input, ctx) → output | null` (null drops the value), in `js`, `python`,
`jsonata`, `template` or `llm`. `ctx` always has `run_id`, `run_input` (what
the run started with), `node`, `vars` (shared by the run, writable), `now`,
`llm(prompt, data?, model?)` and `log(text)`.

## 1. Function nodes

A function with one input port receives the value; with several it receives
`{ port: value }`. With `join: all` it waits until every required port has
a value. It returns a value for its single output, or `{ port: value }` to
choose which outputs fire.

A majority vote over three debaters (three input ports, `join: all`):

```js
// input: { a1: "…Final: 42", a2: "…Final: 41", a3: "…Final: 42" }
const finalOf = (t) => (String(t).match(/Final:\s*(.+)/) ?? [])[1]?.trim() ?? String(t).trim().split("\n").pop();
const counts = {};
for (const t of Object.values(input)) counts[finalOf(t)] = (counts[finalOf(t)] ?? 0) + 1;
const [best] = Object.entries(counts).sort((x, y) => y[1] - x[1]);
return `Final: ${best[0]}`;
```

Routing to one of two outputs (ports `urgent` and `normal`):

```js
return input.priority >= 3 ? { urgent: input } : { normal: input };
```

A function connected to an env or plugin by an access edge can call its tools
with `ctx.tool(name, args)`: an actor with no model. Magentic-One's
ComputerTerminal runs the code it is given this way:

```js
const [, lang, code] = [...text.matchAll(/```(python|sh)?[^\n]*\n([\s\S]*?)```/g)].pop();
await ctx.tool("edit_file", { path: "main.py", content: code });
return await ctx.tool("bash", { command: "python3 main.py" });
```

A read-only access edge gives read-only tools; each call is a tool event in the
run, like an agent's.

State across rounds goes in `ctx.vars` (DyLAN keeps its agents' importance
scores there):

```js
ctx.vars.seen = (ctx.vars.seen ?? 0) + 1;
return { round: ctx.vars.seen, answers: input };
```

A function deep in a pipeline that needs the original task reads
`ctx.run_input` (MapCoder's plan edge does: `Problem:\n{{run_input}}\n\nPlan:\n{{input.plan}}`).

## 2. Edges: transform, filter, gate

On every data edge a value goes through **filter → transform → gate →
coercion** to the target port's type.

- **Filter**, an expression over the value (`text`, `input` and its fields):
  `text.includes("REFUND")`, `input.score >= 0.8`. False drops it.
- **Transform**, any function language. A template that adds context:

  ```
  Answers from the previous round:
  {{#each input.answers}}- {{this.text}}
  {{/each}}
  ```

- **Gate**, a check that must pass before the value crosses: `expr:
  input.tests_passed`, `judge: <agent id>` (the agent decides), `check: <a
  command run in the sandbox>`, or plain text that an LLM judges. On failure
  the value is blocked, sent to a person for approval, or routed back
  (`route_back`, escalating after `escalate_after` failures).

## 3. Ensembles: `replicas` and a vote

One model component sampled N times sends the list of replies; a function
votes. N can come from the run, so one system is evaluated at several sizes:

```yaml
- kind: model
  model: sonnet
  prompt: "{{input}}\n\nThink step by step, then end with: Final: <answer>"
  replicas: "{{vars.n ?? 10}}"        # 10 unless the run sets n
  interface: { outputs: [{ id: out, type: json }] }   # the list
```

```js
// the vote: input is the list of replies
const counts = {};
for (const t of input) { const f = (String(t).match(/Final:\s*(.+)/) ?? [])[1]?.trim(); if (f) counts[f] = (counts[f] ?? 0) + 1; }
return "Final: " + Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0];
```

The same form sets a group's rounds: `iterate: { max_rounds: "{{vars.rounds
?? 2}}" }`.

A group can also take its rounds from a list: `iterate.over` is an expression
over the group's input that gives a list, and round n receives item n instead
of the last output. The group stops when `until` holds, at `max_rounds`, or
when the list runs out. MapCoder uses it to try its plans best first, with
its debugging loop as a group inside:

```ts
iterate: {
  max_rounds: 3,
  over: "input.plans.slice().sort((a, b) => b.confidence - a.confidence)",
  until: 'output.text.includes("ALL TESTS PASSED")',
}
```

An expression that fails or gives no list is reported in the run, and the
whole input is then the only item.

## 4. Agent hooks

`agent.hooks` holds code for points in a turn; each is `f(event, ctx) →
event | null`, and returning `null` from a `before_*` hook blocks the step.

| Hook | `event` |
| --- | --- |
| `on_start` | `{ input }` |
| `before_model` | `{ system, messages }`; return only what changes (`{ system }`) |
| `after_model` | `{ text, stop }` |
| `before_tool` | `{ tool: { name, effect, source }, args }` |
| `after_tool` | `{ tool, args, result }` |
| `on_error` | `{ where, tool, error }` |
| `on_finish` | `{ input, output }` |

Holding irreversible actions for a person (Magentic-One's guard):

```js
// before_tool
if (event.tool.effect !== "irreversible") return event;
return await ctx.ask_human(event); // the event if approved, null (blocked) if not
```

Keeping a tool's output short before the model reads it:

```js
// after_tool
return { ...event, result: String(event.result).slice(0, 4000) };
```

Hooks run for external harnesses too (Claude Code, Codex, ACP, stdio
programs): their tool calls reach the platform over MCP and pass the same
hooks, approvals and policies.

## 5. A custom agent loop

`harness.loop: custom` with `loop_fn`, `async (ctx, { model, tools, memory,
emit }) => output`. `ctx` adds `task`, `history`, `messages`, `system` and
`react(extra?)` (the platform's own ReAct loop, to fall back on).

```js
// plan, run one search per step, answer from the notes
const plan = await model.json(`List at most 3 search queries as {"queries": [...]} for: ${ctx.task}`);
const notes = [];
for (const q of plan.queries ?? []) notes.push(await tools.call("web_search", { query: q }));
await memory.write(`Searched: ${(plan.queries ?? []).join("; ")}`);
return await model("Answer the task from these notes, citing them.", { task: ctx.task, notes });
```

`model(prompt, data?)` and `model.call(…)` return text, `model.json(…)` parsed
JSON; `tools.list()`, `tools.call(name, args)` and `tools.call_agent(name,
instruction)` reach the agent's tools and the agents it may call;
`memory.search(query)` and `memory.write(text)` its memory. Werewolf's
moderator and Chain-of-Agents' chain are custom loops.

## 6. An external agent program (`mas-agent/1`)

Any program can be an agent. With `harness.runner: custom-stdio` and
`harness.command`, the platform starts it once per turn and writes one JSON
line to its stdin:

```json
{"type": "deliver", "input": "…", "context": "…", "session": "…or null", "run_id": "…", "agent": "…",
 "mcp": {"url": "http://127.0.0.1:5190/mcp/…", "token": "…"}}
```

It answers with JSON lines on stdout: `{"type": "output", "text": …}` (the
reply), `{"type": "log", "text": …}`, `{"type": "usage", "tokens_in": …,
"tokens_out": …, "usd": …}` and `{"type": "session", "id": …}` (sent back as
`session` next turn). A program that prints plain text is a one-shot
command: its stdout is the reply. The platform's tools for this agent are at
`mcp.url` (also `$MAS_MCP_URL`, with `$MAS_MCP_TOKEN`), under the same hooks
and policies as native tools.

A complete agent in Python:

```python
#!/usr/bin/env python3
import json, sys
msg = json.loads(sys.stdin.readline())
turns = int(msg.get("session") or 0) + 1
print(json.dumps({"type": "log", "text": f"turn {turns}"}), flush=True)
print(json.dumps({"type": "output", "text": f"I read: {msg['input'][:200]}"}), flush=True)
print(json.dumps({"type": "session", "id": str(turns)}), flush=True)
```

Run this way the program is a command on the server, which needs
`MAS_ALLOW_LOCAL_EXEC=1`. Hosted instead (section 11, `expose: { kind:
agent-stdio }`, and `harness.endpoint: { hosted: { service } }`), it runs in
its own container per turn and reaches the platform's MCP at the gateway
address in `mcp.url`; `examples/hosted/tool-lister-agent` is one. Other
ways in: a Claude Code subagent `.md`, an A2A agent card, `langgraph.json`,
Codex or an ACP agent (see contracts.md).

## 7. A plugin backend (`mas-plugin/1`)

A plugin gives the agents connected to it tools and hooks, backed by your
service:

```yaml
contract: mas-plugin/1
name: CRM lookup
scope: agent | group | end_user | system
backend: { kind: http, url: https://crm.example/mas, config: { auth_env: CRM_TOKEN } }   # sent as a bearer token
tools:
  - { name: find_customer, description: Look a customer up by email, effect: read }
```

The platform calls:

| Call | Request body | Your reply |
| --- | --- | --- |
| `POST {url}/tools/{name}` | the tool's arguments | text: the tool result (non-2xx is an error) |
| `POST {url}/hooks/before_turn` | `{ agent, input, run_id }` | text added to the agent's context, or empty; 404 = no such hook |
| `POST {url}/hooks/after_turn` | `{ agent, input, output, run_id }` | anything (records what it needs) |

With `backend.kind: code`, `command` runs once per tool call with `{ tool,
args, plugin, run_id }` as JSON on stdin; its stdout is the result. With
`kind: mcp`, the plugin's tools are an MCP server's
(`examples/mcp/notes-server.mjs` is a minimal one). A secret goes by name
(`config.auth_env`, a secret set in Settings), never in the file.

## 8. A catalog tool

```yaml
id: lookup_order
description: Find an order by its number
adapter: http                 # POST {url} with the arguments as JSON; the reply is the result
url: https://shop.example/tools/lookup_order
effect: read                  # pure | read | write | irreversible
input_schema: '{"type":"object","properties":{"number":{"type":"string"}},"required":["number"]}'
```

`adapter: cli` runs `command` with the arguments as JSON on stdin; `adapter:
code` runs `fn(args, ctx)`; `adapter: mcp` calls the tool of that name on the
server at `url`. The effect decides what read-only access edges allow and
which tools wait for approval.

## 9. A dataset adapter

Benchmarks in a known shape need no code: GSM8K (`####`), multiple choice
(`choices` and an answer letter or index), HumanEval (`prompt`, `test`,
`entry_point`), and question/answer fields under the usual names. For
anything else, `format: custom` and an adapter run once per JSON line:

```js
// a record such as {"q": "…", "solutions": [{"final": "12"}], "meta": {…}}
return { input: record.q, expected: record.solutions[0].final };
```

`POST /api/datasets { name, text, format: "custom", adapter, grader, source }`;
the adapter has 2 seconds per record. Graders: `answer`, `number`, `math`
(LaTeX, the MATH benchmark's normalisation), `contains`, `llm`, `code`.

## 10. Declared results and run variables

```yaml
result: { type: code }        # text | number | code | json | choice
```

Every finished run's answer is checked against it; evaluations flag answers
of the wrong kind before their grade. Run variables are set per run or per
evaluation (`vars`) and read as `ctx.vars` in code, `{{vars.x}}` in
templates, `{{vars.x ?? default}}` in `replicas` and `max_rounds`, and
`{{vars.x}}` or `{{vars.x ?? default}}` in an agent's instructions (MapCoder:
"write {{vars.k ?? 3}} plans", with `max_rounds: "{{vars.k ?? 3}}"` on the
group that tries them). In instructions, only these two forms are filled; a
variable the run does not set and that has no default stays as written. The
Run and Evaluate pages list every variable a system reads as a hint.

## 11. Hosting your server, or reaching one

Any of the servers in sections 6–8 can run on this server: upload the project
on the Connections page (or `POST /api/hosted`), with a `mas-host.yaml`:

```yaml
start: python server.py
expose: { kind: mcp-stdio }     # or { kind: http, port: 8000, health: /health }
egress: []                      # no network
```

then point the component at it:

```yaml
backend: { kind: mcp, endpoint: { hosted: { service: svc_notes_mcp_e6f792 } } }
# the same server elsewhere:
backend: { kind: mcp, endpoint: { remote: { url: https://notes.example/mcp, bearer_env: NOTES_TOKEN } } }
```

`examples/hosted/` has a complete MCP server on stdio and a complete HTTP
plugin backend, both without dependencies. [hosting.md](hosting.md) has the
manifest, the isolation and the API.
