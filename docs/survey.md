# What the papers have in common

MAS Studio is partly a survey: by rebuilding published multi-agent systems on
one platform, we find what they share, what can be one interface instead of a
special case, and where the abstractions are still missing. This page
collects what 26 rebuilt papers show. The parts themselves are described in
[architecture.md](architecture.md) and [contracts.md](contracts.md), and the
benchmark results in [benchmarks.md](benchmarks.md).

Every template records how it maps the paper (`notes.mapped`) and where it
differs (`notes.differs`), in `src/model/papers/`. The counts below come from
those 26 templates.

## How often each part is used

| Part | Papers | Used for |
| --- | --- | --- |
| `agent` | 25 of 26 | every role (only Mixture-of-Agents uses bare model calls throughout) |
| `single_shot` loop | 21 | roles that answer once per turn: debaters, judges, planners |
| `message` edge | 22 | pipelines and fan-out |
| `group` with `iterate` | **16** | every kind of "rounds": debate rounds, consensus loops, test-and-fix loops, drafting and review |
| `react` loop | 13 | roles that use tools: coders, executors, orchestrators |
| access edges (envs, plugins) | 11 | shared spaces: chat rooms, sandboxes, memories, workspaces |
| `function` | 10 | votes, consensus checks, dispatch, recalibration: the protocol's rules as code |
| sandbox env | 8 | running code: every coding paper |
| `handoff` (`carry: full`) | 7 | one-by-one discussion, where each speaker reads all that came before |
| `call` edge | 6 | an orchestrator using other agents as tools |
| room env | 4 | group chats: `free`, `selector`, `round_robin` |
| memory plugin | 3 | skill library, episodic memory, memory stream |
| spawn | 3 | teams whose size depends on the task |
| `custom` loop | 3 | protocols that are game rules or document chains |

Two parts carry most of the field: an agent with a simple loop, and a group
that repeats until a condition holds. The differences between papers are
mostly about **who sees what** and **when it stops**.

## Recurring patterns, one interface each

| Pattern | Interface | Papers |
| --- | --- | --- |
| Rounds until agreement, approval or passing tests | `group.iterate { max_rounds, until, feed }` | Debate, MAD, ReConcile, EoT, MedAgents, DyLAN, CAMEL, ChatEval, AgentVerse, AutoAgents, ChatDev |
| Test-and-fix loop | group iterate + sandbox `run_tests` + `until: "ALL TESTS PASSED"` | AgentCoder, MapCoder, Reflexion, Voyager, ChatDev |
| Parallel work, then wait for everyone | edges fanning out + `function` with `join: all` | Debate, MoA, TradingAgents, MedAgents, AgentCoder |
| Voting and consensus | a `function` over the collected answers (majority, confidence-weighted, 2/3 early stop) | Debate, ReConcile, DyLAN, EoT, MedAgents |
| Group chat with a speaking order | room env, `policy: round_robin \| selector \| mention \| free` | AutoGen, Virtual Lab, MetaGPT, Generative Agents |
| Publish/subscribe message pool | room with `binding.write.tag` and `binding.read.filter` | MetaGPT |
| Who sees whom (topology) | a `function` that decides each round what each agent receives | Exchange-of-Thought (4 paradigms in one table), DyLAN |
| Speaking one after another, each hearing all before | chain of `handoff` edges with `carry: full` | ChatEval, MAD, TradingAgents |
| Orchestrator with specialists | `call` edges: each specialist is a tool (`ask_<id>`) of a `react` agent | Magentic-One, Agents' Room, STORM, TradingAgents |
| Dynamic team | `spawn` of a template agent, or a dispatch function | AgentVerse, AutoAgents, STORM, DyLAN, MedAgents |
| Executing code | sandbox env (Docker, no network) with `bash`, `edit_file`, `run_tests` | AutoGen, AgentCoder, MapCoder, Reflexion, Voyager, ChatDev, MetaGPT, Magentic-One |
| Long-term memory and skills | memory plugin with an extract → classify → merge → retain pipeline | Generative Agents, Voyager, Reflexion |
| Shared files | workspace plugin; the folder `/work` is the one the sandbox mounts | ChatDev, Agents' Room, Magentic-One |
| Structured hand-over (PRD, plan, trade) | `json` port bound to a schema + `parse_json` output stage | MetaGPT, MapCoder, TradingAgents |
| Person in the loop | `human` component, approval policies, `require_approval` on tools | TradingAgents, Magentic-One |
| Protocol as code (game rules, chains) | `custom` loop with `model`, `tools`, `memory` | Werewolf, Chain-of-Agents, Magentic-One |

### The three questions every MAS answers

Read this way, a multi-agent system answers three questions. Each one has its
own place in the document:

1. **Who acts?** Components: agents, model calls, functions, people, spawned
   copies.
2. **Who sees what?** Edges and their `carry`, rooms and their subscriptions,
   access bindings (`auto_inject`, `pinned`, `tool`), and functions that
   choose recipients.
3. **When does it stop?** `iterate.until`, `TERMINATE` and `termination`
   expressions in rooms, an agent's `finish`, output policies, and the
   budgets (dollars, rounds, minutes).

Keeping these apart is what lets one system run four communication paradigms
(Exchange-of-Thought). Only the visibility table changes.

## Interfaces added or fixed while reproducing

Running the systems on benchmarks found gaps that reading the papers did not.
Each one became a general interface, not a fix for one paper:

| Found with | What went wrong | The interface now |
| --- | --- | --- |
| MapCoder | The coder saw only the plan, never the problem, and used the recalled problems' function names (33 of 38 cases failed with correct algorithms) | **`ctx.run_input`**: every function and transform can read what the run started with |
| AutoGen | The manager handed the turn to the person who opened the chat (an unattended run stalls); a manager that named no one ended the run with no answer | **Rooms:** the selector chooses only among agents; when nobody is next, the conversation ends and its last message is the answer, as with `TERMINATE` |
| AutoGen | The critic redid the code's arithmetic by hand and overrode the right result | **Template rule:** executed output is the authority; doubts become checks in code |
| AgentCoder, AutoGen | On coding tasks the final message was a verdict ("ALL TESTS PASSED") or a printed value, not the code | **Result contract:** the last message of a run is its deliverable; coding systems end with the code (see "Open questions") |
| MapCoder, AgentCoder, Reflexion | The sandbox image had no pytest and no network, so tests could never pass; the default test command never found the tests | **`run_tests`:** finds test files, uses pytest when present, else runs every `test_*` function itself, and returns the tests' exit status |
| All of the above | Each bug looked like the paper's method doing badly until the failures were counted by reason | **Evaluate page:** failures grouped by reason, largest first; one click shows those cases |
| Generative Agents | The town's talk had no end; it ran into the round limit and returned nothing | **Room termination sees `posts`** (this run's messages in the room): the day ends after 12, and the last message is the result |
| Voyager | The curriculum declared the goal reached on its first turn, with an empty skill library | **Template rule:** only skills the critic verified count; with none, the curriculum proposes the first task |
| All 26 templates | Found the two above; structural tests and dry runs had passed | **`record-demos.mts --check`:** every template on real models, a table of which finish with an answer and why not (26 of 26 healthy after these fixes, $0.22) |
| Graders | "40%" was read as 0.4 against GSM8K's 40; AutoGen's closing `TERMINATE` was taken for the answer | **Graders:** percentages match either form; stop words are not answers |
| Every comparison | Questions pasted by hand, evaluations run in parallel (a burst of 875 calls a minute got a key suspended) | **Datasets** (versioned, sampled), **batch evaluations** (one system after another), a **server-wide rate limit** |

## What the results say about the patterns

From [benchmarks.md](benchmarks.md), all on the same model:

- **Discussion helps a little, and voting is the bar to beat.** On a set with
  room to improve, Multiagent Debate and ReConcile gain 2–3 questions in 30
  over a single agent. Self-consistency (five samples and a vote) gains as
  much as ReConcile, at 60% of the cost.
- **Tools matter more than talk.** Questions no discussion fixed in any run
  (digit sums of large powers, binomials mod p) were solved every time once
  one agent could run code. A single agent with the same sandbox scored the
  same 30/30 as AutoGen's five-agent chat, faster and cheaper.
- **Test-and-fix loops do not pay on easy code.** On 31 coding problems a
  single agent with a sandbox (59 of 62) scored within one problem of
  AgentCoder (60) and ahead of MapCoder (58), at a quarter to a third of their cost. Writing tests separately
  from the code (AgentCoder) is the one mechanism that caught bugs a single
  attempt missed.
- **The fair baseline has the same tools.** A system with a code executor has
  to be compared with one agent that has the same executor, not with a bare
  model.
- **A paper's gain needs room to show.** On GSM8K the single agent already
  scores 97, so a debate cannot show the paper's 77 → 85.
- **Most "failures" of a rebuilt system were the rebuild.** Every bug in the
  table above first looked like the paper's method doing badly. A
  reproduction is not done until it has been run on a benchmark and its
  failures have been read one by one.

## What does not abstract cleanly yet

These come from the templates' `differs` notes. They are the open edges of
the vocabulary:

- **Environments with their own world.** Generative Agents' town, Voyager's
  Minecraft and Werewolf's game are a room, a Python sandbox and a custom
  loop. A world with space, objects and a clock has no component of its own;
  an imported env (`mas-env/1`) is the way in.
- **Learned components.** Agents' Room fine-tunes its agents; DyLAN learns
  agent importance across tasks. The platform runs prompted models, and does
  not carry what is learned from one task to the next, except through memory
  plugins.
- **Search over plans.** MapCoder tries k plans in order of confidence;
  here one plan is written. Spawning one planner per plan would express it,
  but "try in order until one passes" is not one primitive.
- **Agents without a model.** AutoGen's user proxy and Magentic-One's terminal
  run code without a model call. A small model stands in, or a `process`
  agent; a code-only actor with tool access would be cleaner.
- **Data the papers had.** TradingAgents' market feeds, STORM's Wikipedia
  tables of contents and Werewolf's experience pool are connectable (MCP envs,
  knowledge and memory plugins) but not bundled.

## Open questions for the platform

- **The result of a run is implicit.** It is the last value that reaches the
  starter, or a room's last message. Coding systems needed instructions to
  make that message the code. A declared result (a port with a type, such as
  "a Python file" or "a number") would let the platform check it and let
  graders read it without guessing.
- **Iteration is the most used part.** Sixteen papers are a group that
  repeats. The run page now has a Rounds tab: each round's calls and cost, the
  value it ended with, and why the group went on, stopped, or gave up at the
  round limit. A loop that never passes (MapCoder before its fixes: five
  rounds, then "gave up") is visible at a glance. What is still missing is a
  per-round view on the canvas itself.
- **Templates need behaviour checks, not only structure checks.** Structural
  tests check that a template has the paper's parts; only running it on real
  models found the bugs above. `record-demos.mts --check` now runs every
  template on real models and reports which ones finish with an answer and
  why the others do not. A per-template benchmark sample with a known pass
  rate would go further.
