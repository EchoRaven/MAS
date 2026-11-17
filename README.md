# MAS Studio

MAS Studio is a canvas for designing multi-agent systems. You define a
system from typed components and the edges between them, and edit it either
on the canvas or as YAML. Both views edit the same document.

v0.2 runs in the browser only. Systems are saved in the browser's local
storage, and the run view is a structural simulation that never calls a
model.

## Run

```bash
export PATH=/data/common/haibotong/.tools/node/bin:$PATH
npm install
npm run dev          # http://127.0.0.1:5180
npm run build        # type-check + production build into dist/
npm test             # vitest: model, YAML, migration, importers, simulator
node scripts/import-env.mjs <dir>   # env-gen / DT / compose folder -> mas-env manifest
npm run build && npx vite preview   # serve dist/ on 127.0.0.1:5181 (the public ngrok domain points here)
```

## Pages

| Page | What it does |
| --- | --- |
| Systems | List systems, create one from a template, import or export YAML, duplicate, delete |
| Canvas | Build a system from components (agent, model call, function, human, environment, plugin, group) and connect their typed ports. Double-click a group to open its canvas, or an agent to see its internals. Envs, agents and plugins can be imported. The issues menu jumps to each problem. |
| Runs | Replay a simulated event stream on the graph: statuses, transforms, gates, approvals, spawning and cost per agent |
| Templates | Debate, coding team, research team, support triage, invoice extraction, supervisor and workers, blackboard |
| Library | Models (with API settings), tools, JSON schemas, and the integration contracts |

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
src/run/         simulate.ts (event stream + state folding)
src/components/  shared UI, copied from the EnvGen monitor (MindRoom-derived, Apache-2.0)
scripts/         import-env.mjs
examples/        envs/ and agents/ files for the import dialogs
```

## Not in v0.2

- A real runtime: actor scheduler, harness adapters, MCP tool proxy and event store
- A backend and user accounts
- Undo / redo
- Live collaboration
