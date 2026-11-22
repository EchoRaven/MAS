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
| Systems | Every system in one list: create one from a template or by describing it to the Architect, import or export YAML, duplicate, delete. Built-in systems nobody has edited follow fixes to their template; deleting a system reaches every browser |
| Canvas | Build a system from components (agent, model call, function, human, environment, plugin, group) and connect their typed ports. Double-click a group to open its canvas, or an agent to see its internals. **Architect** designs or changes the system from a description; **Tidy** lays it out; **History** restores an earlier version. Env and plugin nodes show their tools, network, lifecycle and who uses them; their inspector shows what is inside (a sandbox's files per run, a database's tables) and **Try it** calls each tool by hand on a throwaway copy. Group nodes show their loop settings. The issues menu jumps to each problem; a paper system's panel cites the paper and says how it maps and where it differs |
| Runs | Live: start a run with an input and optional run variables (or a dry run on the test model), watch it on the graph and in the log (envs show their machine, last command and refused connections; repeating groups their round), answer approvals and questions, stop it, reopen past runs; for groups that repeat, a Rounds tab shows each round's cost, the value it ended with, and why the group went on, stopped or gave up. A warning shows first when a model it uses has no key or a refused one. Simulated: replay a generated event stream |
| Evaluate | Run a system over a dataset (built in, saved, or questions you paste or load from CSV / JSON lines; GSM8K, multiple choice and HumanEval records are read as they come), on a seeded sample if you like, graded by number, final answer, containment, an LLM judge, or by running the code against its tests in Docker. Repeats show the spread; a system can be run on other models (all on one, or per model), and other systems can be queued on the same questions. Failures are grouped by reason, so a systematic problem shows as one large group; every answer is checked for an answer line ("Answer: …"), and a system whose model has no key is refused before it starts. Code evaluations can be regraded by running the stored answers again. **Datasets** lists every dataset with its source, license, grader and version, and shows its first questions. **Compare** puts evaluations of the same questions side by side, question by question, with each accuracy's 95% interval, each system's questions fixed and lost against a reference and McNemar's p, a chart of accuracy against cost naming the cost frontier, runs of one setup pooled into one row, a model filter, and questions flagged as broken left out; it exports a Markdown table or CSV. A provider's passing failure is run again on its own, Retry reruns cases with no known answer, and Check misses with the judge flags right answers a grader marked wrong. Open-ended tasks (grader None) are compared **pairwise**, in both orders, by a judge model or a judging system (ChatEval's panel, or a fact-checking judge that searches), or scored one output at a time to take the order away. Judging runs in the background with its progress shown. Each judgement shows a sign test's p, each side's shape (words, headings, lists), the share of its links that its own searches returned, and how often the judge picked the response shown first. Compare lists the judgements by set and pools those of the same two setups across runs. An evaluation found to have run under a setup bug can be marked invalid with the reason |
| Demos | Real recorded runs of the paper reproductions, replayable by anyone: the canvas animates, the log fills, and each demo shows its result, its mapping and the models it ran on. Static files under `public/demos`, recorded with `npm run record-demos` |
| Templates | Thirty-six papers rebuilt from the components (see below), two baselines (a single agent, and self-consistency) and patterns: coding team, research team, support triage, invoice extraction, supervisor and workers, blackboard |
| Library | Models (with API settings and a connection test), tools (with how the runtime calls them), JSON schemas, and the integration contracts |
| Connections | Host a project here (an archive or a git URL, built and run in Docker, isolated) as an MCP server or HTTP backend, and test any endpoint, hosted or remote, before a component uses it. See [docs/hosting.md](docs/hosting.md) |
| Settings | Server connection, API keys, model status (which models work, why one fails, a test button for each), and the knowledge folder |

The interfaces everything plugs into are documented in
[docs/contracts.md](docs/contracts.md); the server and what a run does, in
[docs/server.md](docs/server.md). How to write code for each interface, with examples, is
[docs/components.md](docs/components.md). The overall map is
[docs/architecture.md](docs/architecture.md), and what the rebuilt papers have
in common, and which interfaces they needed, is [docs/survey.md](docs/survey.md).

Everything that runs code an agent or a model wrote runs isolated: sandboxes,
the code grader, hosted services, and Claude Code / Codex agents run in
containers that are not root, have no capabilities and a seccomp profile, and
reach nothing but the hosts they declare (through an egress proxy) and this
server's gateways; a model gateway puts API keys on requests outside the
container, so none is ever inside one. Every connection, allowed or refused,
is in the run's log. See [docs/server.md](docs/server.md).

## What the reproductions found so far

Measured on this platform, every system on the same model and questions
(details in [docs/benchmarks.md](docs/benchmarks.md), patterns in
[docs/survey.md](docs/survey.md)):

- **Tools matter more than talk.** Questions no discussion fixed were solved
  every time once one agent could run code, and a single agent with the same
  sandbox scored as well as AutoGen's five-agent chat; on long ledgers one
  agent running code over the input totals 39 of 40, where the best
  discussion system reaches 14.5.
- **Voting is the bar to beat, where errors scatter.** Self-consistency and
  Agent Forest (one model, several samples, a vote) match Multiagent Debate
  and ReConcile within a question on computation and math, at a fraction of
  the cost. Not on a long input: five whole readings of a ledger each skip
  different orders, and their vote (6.5 of 20) does worse than one reading
  (9) and far worse than reading in parts (14).
- **Neither a weaker nor a stronger model makes discussion pay.** On Hard
  computation, debate and voting add 2–4 questions in 30 on
  gemini-3.1-flash-lite; on the stronger gemini-3.8-flash debate adds
  nothing (26, 26 against one agent's 26, 27); on the weaker gemma-4-26b they add nothing (two runs each: one agent 25.5,
  debate and voting 25.5, ReConcile 26.5, SPP 24.5), and one agent with a code runner solves all 30 in a sixth of
  the time. (An earlier report here of a 7–8 question gain on gemma came
  from a log that cut gemma's long answers off before their final line;
  fixed, and those cases run again.) On GSM8K and MATH-500 the strong model is
  near the ceiling and nothing shows. On MMLU nothing shows even on gemma
  (89.5 → 90 over two runs): debate corrects slips that differ between agents, not knowledge
  that all copies of a model lack.
- **The coding systems do not beat one agent on HumanEval** with a current
  small model (two runs each): single agent 47.5 of 50, with a code runner
  48.5, AgentCoder, MapCoder and Reflexion 48, at 12–28 times the cost.
- **On one 30-question set, every paper system side by side:** those that run
  code solve all 30 (Magentic-One, AutoGen); those that exchange or vote on
  answers gain 2–4 over one agent's 19 (EoT 22.3 over three runs, ReConcile 22, DyLAN 22;
  p ≈ 0.02 for the best); those built on roles and long pipelines are no better
  than one agent (AgentVerse 19.5, MoA 18, MedAgents 16), and role-play is
  worse (CAMEL 13, ChatEval 12.5, AutoAgents 14: p ≈ 0.01 over two runs each;
  MAD 14, p 0.05).
- **Reading a long input in parts beats reading it whole**: on generated
  ledgers of ~44,000 characters, Chain-of-Agents finds a customer's total
  in 14 of 20 against one agent's 9 (p 0.03), at three times the cost, and
  LongAgent (members reading the parts at once) 13.5 at a third of that.
  Splitting helps to gather, not to find: asked for one order's amount, a
  single line, one agent finds all 40, even at ~45,000 tokens.
- **Layered calls gain on open-ended answers, given a strong aggregator**:
  Mixture-of-Agents with gemini-3.8-flash aggregating beats gemini-3.8-flash
  alone on twenty open-ended instructions, 31–0 over two runs, 22–6 with
  lengths matched, and 17–0 under a judge from another model family, at six
  times the cost. Different models are not needed (gemini-3.8-flash in every
  slot also wins 17–0), but the strong model must propose as well as
  aggregate: with flash-lite proposing and gemini-3.8-flash aggregating it
  gains nothing (12–10) at five times the cost. Choosing the most consistent
  of five samples instead of merging them (Universal Self-Consistency) gains
  nothing either (12–7), and loses 0–15 to MoA. On exact computation MoA gains
  nothing.
- **Self-criticism gains as much, with one model**: Self-Refine on
  gemini-3.8-flash (answer, critique, revise) beats the model alone 25–2 on
  open-ended instructions over two runs and 20–8 at matched length. The gain
  is all on the answers the critic chose to revise (19–0), at two thirds of
  Mixture-of-Agents' cost. Unlike Mixture-of-Agents it gains on the weaker
  flash-lite too (21–2).
- **On open-ended answers, merging, self-criticism and debate gain alike**:
  on gemini-3.8-flash, Mixture-of-Agents, Self-Refine and Multiagent Debate
  (each debater revising after reading the others) each beat the model alone
  by 20–26 to 6–8 with lengths matched. They differ in cost: $0.20, $0.31 and
  $0.48 for twenty instructions. On exact computation none of them helped.
- **A baseline's prompt can make a gain**: Mixture-of-Agents wins 31–9 on
  open-ended instructions against a one-call writer told to give the piece
  only, which holds with lengths matched, and loses 14–19 to one plain call of
  the same model (one of its own proposers), at nine times the cost. The
  writer's prompt had taken away the headings and lists the judge rewards.
- **A judging panel agrees with a stronger judge no more than one call does**:
  ChatEval's three debating referees, as a pairwise judge on 70 story and
  article questions, match gemini-3.8-flash on 47 against one flash-lite
  call's 45 (p 0.79), at ten times the cost. The debate is steadier when the
  answers swap places (80% against 71%).
- **A research team writes no better than one researcher**: STORM
  (perspectives, interviews with a searching expert, outline, article) wins 7
  and loses 12 against one agent with the same web search on ten recent
  topics, at 12 times the cost. Half or more of its links came from no search,
  checked against each run's own searches.
- **A writers' room loses to one writer on short stories**: Agents' Room
  (planners and section writers sharing a scratchpad) loses 0–10 and 0–9 to
  a single call, judged pairwise in both orders by two judges, at 15 times the
  cost. Stories of about 2,000 words, closer to the paper's setting, give the
  same result (0–9). Its parts repeat and run long. First a shared scratchpad mixed
  stories together, and an answer-line baseline lost points on fiction.
  Both are fixed (the plugin scope `run`, the Single writer baseline).
- **A simulated discussion does as well as a real one**: one model playing
  several personas in a single call (Solo Performance Prompting) matches
  Multiagent Debate on both models (on gemma 25 and 26, both just below one
  agent's 27).
- **More debaters, a little more each; different methods, more**: on Hard
  computation (flash-lite), 2, 3 and 5 debaters score 20, 21 and 22.5
  against one agent's 19; three debaters each reasoning a different way
  score 23 (p 0.02) at 70% of five's cost, while three all told to reason
  step by step stay at 21.5.
- **Where debate gains, the exchange does it, not the vote**: on flash-lite
  a vote over the debaters' first answers is where one agent is, and the
  rounds turn nine wrong verdicts right and none wrong; on gemma neither
  the vote nor the rounds gain anything (qualifying "Debate or Vote", Choi
  et al. 2025).
- **Mixing models mostly reaches the best member, not beyond it**: ReConcile
  with one seat per model ties its strongest model alone, at four times the
  cost; Mixture-of-Agents with three models scored 28 and 27 against its
  best model's 26 and 27 (not significant), and the best model in every
  slot (Self-MoA) 26 and 26.
- **One round of discussion is all that pays**, and three samples are about as
  good as twenty.
- **A measured gain has to survive an audit of its baseline.** The
  platform's first large gain from discussion (gemma, debate +8 over one
  agent) came from a log that cut the single agent's long answers off;
  other scores moved when a provider's 503s, a grader's misreadings
  (intervals, sums in another order, a number met in a long document) or a
  single lucky run were fixed. Every number above has had its misses
  checked by an LLM judge and its unknown answers run again, and the
  differences it reports rest on two runs or more on both sides.
- **Most "failures" of a rebuilt system were the rebuild**: wrong outputs, a
  missing input, a test step that could never pass, a grader that misread
  right answers. Each became a platform interface or check (declared results,
  failure reasons, a template health check, graders validated on model
  outputs).

## Papers rebuilt on the canvas

Each one is a template with its citation, how it maps onto the components,
and where it departs from the paper. They rebuild each paper's architecture —
who talks to whom, roles, memory, loops — not its prompts or its results.

Results of running these systems against a single agent and self-consistency on the same model: [docs/benchmarks.md](docs/benchmarks.md).

| Paper | What it exercises |
| --- | --- |
| [ChatDev](https://arxiv.org/abs/2307.07924) | A phase per group, instructor/assistant dialogues repeating until consensus, a shared codebase |
| [MetaGPT](https://arxiv.org/abs/2308.00352) | A shared message pool; roles publish and subscribe by message type; structured documents |
| [Multiagent Debate](https://arxiv.org/abs/2305.14325) | Parallel answers, rounds of revision, a join-all function, a majority vote |
| [Generative Agents](https://arxiv.org/abs/2304.03442) | A memory stream: recency + importance + relevance retrieval, importance scoring, reflection, daily plans |
| [Mixture-of-Agents](https://arxiv.org/abs/2406.04692) | Layers of model calls with no agents, joined and aggregated |
| [Agent Forest](https://arxiv.org/abs/2402.05120) (More Agents Is All You Need) | One model sampled N times in a single component (`replicas`, N from a run variable), then a majority vote |
| [Magentic-One](https://arxiv.org/abs/2411.04468) | A custom orchestrator loop with a task ledger and a progress ledger, calling specialists; its ComputerTerminal is a function that runs code in the sandbox with no model |
| [CAMEL](https://arxiv.org/abs/2303.17760) | Role-play between two agents until a completion token |
| [AutoGen](https://arxiv.org/abs/2308.08155) | A group chat whose manager picks the next speaker; a user proxy with no model (a function in the room) runs the code |
| [AgentCoder](https://arxiv.org/abs/2312.13010) | A programmer and a test designer in parallel, then a test-and-repair loop |
| [AgentVerse](https://arxiv.org/abs/2308.10848) | Experts recruited by spawning, a merged decision, execution, evaluation feedback |
| [ChatEval](https://arxiv.org/abs/2308.07201) | Referee personas debating one by one, each handed the whole discussion |
| [MapCoder](https://arxiv.org/abs/2405.11403) | Recall similar problems, k scored plans tried best first (`iterate.over`), each with its own debugging loop |
| [Voyager](https://arxiv.org/abs/2305.16291) | An automatic curriculum and a skill library that grows only with programs a critic verified |
| [Reflexion](https://arxiv.org/abs/2303.11366) | Actor, evaluator and self-reflection, with lessons kept in an episodic memory between trials |
| [DyLAN](https://arxiv.org/abs/2310.02170) | Agents in layers: a ranker keeps the best for the next layer, early stop at two-thirds agreement, importance scores |
| [TradingAgents](https://arxiv.org/abs/2412.20138) | A trading firm: parallel analysts, a bull/bear debate, a structured trade, a risk debate, a person's approval |
| [Werewolf](https://arxiv.org/abs/2309.04658) | Hidden roles: the rules are code, each player is an agent told only what its role allows |
| [MAD](https://arxiv.org/abs/2305.19118) | An angel and a devil who must disagree; a moderator ends the debate once one side is clearly right, else a judge decides after three rounds |
| [Chain-of-Agents](https://arxiv.org/abs/2406.02818) | A long input split into chunks; workers pass a note of the evidence down the chain, a manager answers from the last note |
| [ReConcile](https://arxiv.org/abs/2309.13007) | A round table of different models: answers with confidence, grouped discussion each round, stop at consensus, a confidence-weighted vote |
| [MedAgents](https://arxiv.org/abs/2311.10537) | Specialties gathered per question, parallel analyses, a summarised report, a voted consultation that revises the report until every expert agrees |
| [MacNet](https://arxiv.org/abs/2406.07155) | Agents on a network (chain, tree, star, mesh; size from a run variable), instructors reviewing each edge, protocol as code |
| [Solo Performance Prompting](https://arxiv.org/abs/2307.05300) | One model, one call: personas named per task discuss and criticise until they agree (the control for real agents) |
| [Corex](https://arxiv.org/abs/2310.00280) (Retrieve) | Independent chains, then a retriever that reads them and picks the most faithful, instead of a vote |
| [Multi-Agent Verification](https://arxiv.org/abs/2502.20379) | Best-of-n chosen by several aspect verifiers, each approving or rejecting every candidate |
| [MACM](https://arxiv.org/abs/2404.04735) | A Thinker mines conditions, a Judge keeps the verified ones and says when they suffice, an Executor carries out the plan; the loop is code calling the roles (`ctx.call`) |
| [Self-Refine](https://arxiv.org/abs/2303.17651) | One model answers, critiques its own answer and revises until the critique finds nothing: the control for critic-and-reviser loops |
| [Diverse Multi-Agent Debate](https://proceedings.iclr.cc/paper_files/paper/2025/hash/3de667dab3b3d812583abc0a786139a0-Abstract-Conference.html) | Multiagent Debate with each debater reasoning a different way (step by step, decompose, check another way) |
| [LongAgent](https://arxiv.org/abs/2402.11550) | A leader splits a long document among members who read their parts at the same time; it answers from their reports |
| [FrugalGPT](https://arxiv.org/abs/2305.05176) (cascade) | A cheap model answers; a scorer accepts it or passes the question to a strong model |
| [Universal Self-Consistency](https://arxiv.org/abs/2311.17311) | Several samples of one model; the model picks the most consistent and it is returned unchanged (self-consistency for open-ended answers) |
| [AutoAgents](https://arxiv.org/abs/2309.17288) | A team drafted per task; an agent observer and a plan observer must both approve the draft; the drafted agents are created (spawned) one plan step at a time |
| [Exchange-of-Thought](https://arxiv.org/abs/2312.01823) | Four communication paradigms (memory, report, relay, debate) in one system, chosen by a run variable; confidence from each agent's consistency; stop at agreement |
| [Agents' Room](https://arxiv.org/abs/2410.02603) | Story writing: planning agents (conflict, characters, setting, plot) and one writing agent per part of the narrative arc share a scratchpad; an orchestrator calls them in turn |
| [STORM](https://arxiv.org/abs/2402.14207) | Article writing by research: one spawned interviewer per perspective questions a search-grounded expert through a call edge; outline, then a cited article |
| [Virtual Lab](https://www.biorxiv.org/content/10.1101/2024.11.11.623004v1) | A PI-led team meeting in a room: scientists of different fields answer in turn, a scientific critic speaks last each round, the PI's summary ends it |

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
