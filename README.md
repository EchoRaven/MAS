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
| Templates | Debate, coding team, research team, support triage, invoice extraction, supervisor and workers, blackboard |
| Library | Models (with API settings and a connection test), tools (with how the runtime calls them), JSON schemas, and the integration contracts |
| Settings | Server connection, API keys, and the knowledge folder |

The interfaces everything plugs into are documented in
[docs/contracts.md](docs/contracts.md).

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
