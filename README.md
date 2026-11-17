# MAS Studio

A canvas for building multi-agent systems, implementing the data model of
*Multi-Agent 平台 Spec v0*. v0 is frontend-only: systems are stored in the
browser, and the run view is a **structural simulation**. No model is called.

## Run

```bash
export PATH=/data/common/haibotong/.tools/node/bin:$PATH
npm install
npm run dev          # http://127.0.0.1:5180
npm run build        # type-check + production build into dist/
npm test             # vitest: YAML round trip, validator, simulator
```

## What is here

| Page | What it does |
| --- | --- |
| 系统 | List, create from a template, import/export YAML, duplicate, delete |
| 画布 | Drag agents, humans, rooms, envs, stores and groups onto the canvas; connect them with message / call / handoff / access edges; put gates on edges; edit everything in the right-hand inspector; switch to the YAML view and edit the same definition as text |
| 运行 | Plays back a simulated event stream on the same graph: node status, active edges, gates blocking and passing, approvals, spawning, per-agent cost |
| 模板 | Debate, coding team, research team (group + spawn), support triage |
| 模型与工具 | Per-system model catalog (prices drive cost estimates) and tool catalog |

## Layout

```
src/model/     types.ts (SystemDoc), defaults.ts (harness adapters, catalogs),
               templates.ts, validate.ts, yaml.ts
src/canvas/    FlowView (React Flow), nodes, edges, Inspector, Palette
src/run/       simulate.ts (event stream + state folding)
src/pages/     route pages
src/components shared UI, copied from the EnvGen monitor (MindRoom-derived, Apache-2.0)
```

## Not in v0

A real runtime (actor scheduler, harness adapters, MCP tool proxy, event
store), a backend and accounts, undo/redo, and live collaboration.
