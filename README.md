# MAS Studio

MAS Studio is a canvas for designing multi-agent systems. You define a
system from typed components and the edges between them, and edit it either
on the canvas or as YAML. Both views edit the same document.

The browser app works on its own: systems are kept in local storage, and
runs are structural simulations. With the server (`npm run server`) connected,
systems sync to it and runs execute for real. Runs call models, tools,
plugins, sandboxes and harness adapters, stream their events live, and wait
for people's approvals and replies. See [docs/server.md](docs/server.md).

## Run

```bash
export PATH=/data/common/haibotong/.tools/node/bin:$PATH
npm install
npm run server       # API + runtime on 127.0.0.1:5190 (token in .data/token)
npm run dev          # http://127.0.0.1:5180 (proxies /api to the server)
npm run build        # type-check + production build into dist/
npm test             # vitest: model, YAML, migration, importers, simulator, runtime
node scripts/import-env.mjs <dir>   # env-gen / DT / compose folder -> mas-env manifest
npm run build && npx vite preview   # serve dist/ on 127.0.0.1:5181 (the public ngrok domain points here)
```

## Pages

| Page | What it does |
| --- | --- |
| Systems | List systems, create one from a template, import or export YAML, duplicate, delete |
| Canvas | Build a system from components (agent, model call, function, human, environment, plugin, group) and connect their typed ports. Double-click a group to open its canvas, or an agent to see its internals. Envs, agents and plugins can be imported. The issues menu jumps to each problem. |
| Runs | Live: start a run with an input (or a dry run on the test model), watch it on the graph and in the log, answer approvals and questions, stop it, reopen past runs. Simulated: replay a generated event stream |
| Demos | Real recorded runs of the paper reproductions, replayable by anyone: the canvas animates, the log fills, and each demo shows its result, its mapping and the models it ran on. Static files under `public/demos`, recorded with `npm run record-demos` |
| Templates | Seventeen papers rebuilt from the components (see below), plus patterns: coding team, research team, support triage, invoice extraction, supervisor and workers, blackboard |
| Library | Models (with API settings and a connection test), tools (with how the runtime calls them), JSON schemas, and the integration contracts |
| Settings | Server connection, API keys, and the knowledge folder |

The interfaces everything plugs into are documented in
[docs/contracts.md](docs/contracts.md); the server and what a run does, in
[docs/server.md](docs/server.md).

## Papers rebuilt on the canvas

Each one is a template with its citation, how it maps onto the components,
and where it departs from the paper. They rebuild each paper's architecture —
who talks to whom, roles, memory, loops — not its prompts or its results.

| Paper | What it exercises |
| --- | --- |
| [ChatDev](https://arxiv.org/abs/2307.07924) | A phase per group, instructor/assistant dialogues repeating until consensus, a shared codebase |
| [MetaGPT](https://arxiv.org/abs/2308.00352) | A shared message pool; roles publish and subscribe by message type; structured documents |
| [Multiagent Debate](https://arxiv.org/abs/2305.14325) | Parallel answers, rounds of revision, a join-all function, a majority vote |
| [Generative Agents](https://arxiv.org/abs/2304.03442) | A memory stream: recency + importance + relevance retrieval, importance scoring, reflection, daily plans |
| [Mixture-of-Agents](https://arxiv.org/abs/2406.04692) | Layers of model calls with no agents, joined and aggregated |
| [Magentic-One](https://arxiv.org/abs/2411.04468) | A custom orchestrator loop with a task ledger and a progress ledger, calling specialists |
| [CAMEL](https://arxiv.org/abs/2303.17760) | Role-play between two agents until a completion token |
| [AutoGen](https://arxiv.org/abs/2308.08155) | A group chat whose manager picks the next speaker; a user proxy runs the code |
| [AgentCoder](https://arxiv.org/abs/2312.13010) | A programmer and a test designer in parallel, then a test-and-repair loop |
| [AgentVerse](https://arxiv.org/abs/2308.10848) | Experts recruited by spawning, a merged decision, execution, evaluation feedback |
| [ChatEval](https://arxiv.org/abs/2308.07201) | Referee personas debating one by one, each handed the whole discussion |
| [MapCoder](https://arxiv.org/abs/2405.11403) | Recall similar problems, a scored plan, code, and a debugging loop |
| [Voyager](https://arxiv.org/abs/2305.16291) | An automatic curriculum and a skill library that grows only with programs a critic verified |
| [Reflexion](https://arxiv.org/abs/2303.11366) | Actor, evaluator and self-reflection, with lessons kept in an episodic memory between trials |
| [DyLAN](https://arxiv.org/abs/2310.02170) | Agents in layers: a ranker keeps the best for the next layer, early stop at two-thirds agreement, importance scores |
| [TradingAgents](https://arxiv.org/abs/2412.20138) | A trading firm: parallel analysts, a bull/bear debate, a structured trade, a risk debate, a person's approval |
| [Werewolf](https://arxiv.org/abs/2309.04658) | Hidden roles: the rules are code, each player is an agent told only what its role allows |
| [MAD](https://arxiv.org/abs/2305.19118) | An angel and a devil who must disagree; a moderator ends the debate once one side is clearly right, else a judge decides after three rounds |
| [Chain-of-Agents](https://arxiv.org/abs/2406.02818) | A long input split into chunks; workers pass a note of the evidence down the chain, a manager answers from the last note |
| [ReConcile](https://arxiv.org/abs/2309.13007) | A round table of different models: answers with confidence, grouped discussion each round, stop at consensus, a confidence-weighted vote |
| [MedAgents](https://arxiv.org/abs/2311.10537) | Specialties gathered per question, parallel analyses, a summarised report, a voted consultation that revises the report until every expert agrees |

## Layout

```
src/model/       types.ts (SystemDoc), ports.ts (interfaces, scopes, type compatibility),
                 steps.ts (the step registry), pipelines.ts (retrieval / indexing / memory / DB query),
                 validate.ts, yaml.ts, migrate.ts, templates.ts, defaults.ts,
                 envspec.ts / agentspec.ts / plugins.ts (import contracts)
src/canvas/      FlowView + ops.ts (graph edits), convert.ts, edges.tsx, presets.ts, Palette,
                 ImportDialog, nodes/ (one file per node family),
                 inspector/ (one editor per file), agent/ (agent internals view)
src/pages/       systems, templates; canvas/, runs/, library/ (one folder per page)
src/run/         events.ts (the run event contract), simulate.ts (simulated stream + state folding)
src/api/         client.ts (the server API); src/store/server.ts, sync.ts (connection, system sync)
server/          index.ts (HTTP), routes/, store/ (files, secrets),
                 runtime/: engine.ts (scheduler), runs.ts, agent/ (turn, loops, stages, hooks, tools),
                 models/ (anthropic, openai, mock), functions/, resources/ (plugins, envs, retrieval),
                 harness/ (process and remote adapters), mcp/ (client), mcpProxy.ts
src/components/  shared UI, copied from the EnvGen monitor (MindRoom-derived, Apache-2.0)
scripts/         import-env.mjs
examples/        envs/ and agents/ files for the import dialogs
```

## Not yet

- User accounts (one server token for now) and live collaboration
- Undo / redo
- Graph search over a real graph store (it falls back to keyword search), and scheduled re-indexing (knowledge is indexed per run)
