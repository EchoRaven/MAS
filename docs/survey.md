# What the papers have in common

MAS Studio is partly a survey: by rebuilding published multi-agent systems on
one platform, we find what they share, what can be one interface instead of a
special case, and where the abstractions are still missing. This page
collects what the rebuilt papers show (27 so far). The parts themselves are described in
[architecture.md](architecture.md) and [contracts.md](contracts.md), and the
benchmark results in [benchmarks.md](benchmarks.md).

Every template records how it maps the paper (`notes.mapped`) and where it
differs (`notes.differs`), in `src/model/papers/`. The counts below come from
the first 26 templates; Agent Forest, added later, is one model component with
replicas and a vote.

## How often each part is used

| Part | Papers | Used for |
| --- | --- | --- |
| `agent` | 25 of 28 | every role (Mixture-of-Agents and Agent Forest use bare model calls, MacNet calls models from code) |
| `message` edge | 24 | pipelines and fan-out |
| `single_shot` loop | 21 | roles that answer once per turn: debaters, judges, planners |
| `group` with `iterate` | **16** | every kind of "rounds": debate rounds, consensus loops, test-and-fix loops, drafting and review, plans tried in turn (`over`) |
| `function` | 14 | votes, consensus checks, dispatch, recalibration: the protocol's rules as code |
| `react` loop | 12 | roles that use tools: coders, orchestrators |
| access edges (envs, plugins) | 11 | shared spaces: chat rooms, sandboxes, memories, workspaces |
| sandbox env | 8 | running code: every coding paper |
| `handoff` (`carry: full`) | 6 | one-by-one discussion, where each speaker reads all that came before |
| `call` edge | 6 | an orchestrator using other agents as tools |
| room env | 4 | group chats: `free`, `selector`, `round_robin` |
| model calls from code (`ctx.llm`) | 3 | a protocol whose shape changes per run: MacNet's network, MedAgents' gathering |
| memory plugin | 3 | skill library, episodic memory, memory stream |
| spawn | 3 | teams whose size depends on the task |
| `custom` loop | 3 | protocols that are game rules or document chains |
| tools called from code (`ctx.tool`) | 2 | actors with no model: AutoGen's user proxy, Magentic-One's terminal |
| roles called from code (`ctx.call`) | 4 | a protocol whose loop is code but whose roles stay components: MACM's verify-then-keep condition mining, Self-Refine's critique-and-revise, LongAgent's parallel members, FrugalGPT's cascade |

Two parts carry most of the field: an agent with a simple loop, and a group
that repeats until a condition holds. The differences between papers are
mostly about **who sees what** and **when it stops**.

## Recurring patterns, one interface each

| Pattern | Interface | Papers |
| --- | --- | --- |
| Rounds until agreement, approval or passing tests | `group.iterate { max_rounds, until, feed }` | Debate, MAD, ReConcile, EoT, MedAgents, DyLAN, CAMEL, ChatEval, AgentVerse, AutoAgents, ChatDev |
| Trying candidates in turn until one passes | `group.iterate { over, until }`: round n gets item n of a list from the input; a group inside repeats per candidate | MapCoder (k plans × t debugging rounds) |
| Test-and-fix loop | group iterate + sandbox `run_tests` + `until: "ALL TESTS PASSED"` | AgentCoder, MapCoder, Reflexion, Voyager, ChatDev |
| Parallel work, then wait for everyone | edges fanning out + `function` with `join: all` | Debate, MoA, TradingAgents, MedAgents, AgentCoder |
| Voting and consensus | a `function` over the collected answers (majority, confidence-weighted, 2/3 early stop) | Debate, ReConcile, DyLAN, EoT, MedAgents |
| Sampling ensembles (N answers from one model) | `replicas` on a model component: N calls, one list | Agent Forest, self-consistency |
| Group chat with a speaking order | room env, `policy: round_robin \| selector \| mention \| free` | AutoGen, Virtual Lab, MetaGPT, Generative Agents |
| Publish/subscribe message pool | room with `binding.write.tag` and `binding.read.filter` | MetaGPT |
| Who sees whom (topology) | a `function` that decides each round what each agent receives | Exchange-of-Thought (4 paradigms in one table), DyLAN |
| Speaking one after another, each hearing all before | chain of `handoff` edges with `carry: full` | ChatEval, MAD, TradingAgents |
| Orchestrator with specialists | `call` edges: each specialist is a tool (`ask_<id>`) of a `react` agent | Magentic-One, Agents' Room, STORM, TradingAgents |
| Dynamic team | `spawn` of a template agent, or a dispatch function | AgentVerse, AutoAgents, STORM, DyLAN, MedAgents |
| Executing code | sandbox env (Docker, no network) with `bash`, `edit_file`, `run_tests` | AutoGen, AgentCoder, MapCoder, Reflexion, Voyager, ChatDev, MetaGPT, Magentic-One |
| Long-term memory and skills | memory plugin with an extract → classify → merge → retain pipeline | Generative Agents, Voyager, Reflexion |
| Shared files | workspace plugin with scope `run` (empty in every run; `system` is shared by all runs and kept); the folder `/work` is the one the sandbox mounts; `read.contents` puts the files in front of each turn | ChatDev, Agents' Room, Magentic-One |
| Judging open-ended outputs | grader `none`, then pairwise judging in both orders, by a model or a judging system | Agents' Room, STORM, ChatEval, Mixture-of-Agents |
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
| Agent Forest | The paper's variable is the number of samples N, but on the canvas N was N wired copies (self-consistency was 5 model nodes into a 5-port vote) | **`replicas`** on a model component, from a run variable: one system, swept over N by an evaluation |
| Multiagent Debate | The paper's ablation is over the number of rounds, but a group's round limit was a fixed number | **Round limits from run variables:** `max_rounds: "{{vars.rounds ?? 2}}"`, the same form as `replicas`; the Rounds tab shows the limit the run used |
| Agent Forest (first sweep) | The replicated component's `json` output port (the list) was read as "each reply is JSON": every sample answered with a bare number and no reasoning (1 of 30 at N = 3–10); with N = 1 the vote got a string, not a list (0 of 30) | **A port's type describes what travels on it:** for an ensemble that is the list, and each sample replies as text; a replicated component always sends a list, even of one |
| Generative Agents | The town's talk had no end; it ran into the round limit and returned nothing | **Room termination sees `posts`** (this run's messages in the room): the day ends after 12, and the last message is the result |
| Voyager | The curriculum declared the goal reached on its first turn, with an empty skill library | **Template rule:** only skills the critic verified count; with none, the curriculum proposes the first task |
| AgentCoder, AutoGen, MapCoder | Each returned the wrong kind of answer (a verdict, a printed value, a summary), and each first looked like the method failing | **Declared results:** `result: {type}` on the system, checked at the end of every run; wrong kinds are flagged and grouped first |
| Weaker models (gemma) | On a slower model the per-model quota was far below the provider's (429s at 8 runs at once); its own rate setting was then sent to Google as a request field (400s); runs hit the system's 5-minute limit while the model was still thinking; calls died after exactly 300 s, Node's wait for response headers; and debates ran into the token quota | **Per-model rate limits** (`api.params.rpm`, on top of the provider's, never sent to the provider), **a time limit per evaluation** (`time_limit_min`, the Evaluate page's "Minutes"), **streamed replies** (headers at once; tool calls put together from their pieces), and **inline reasoning kept out of the answer** (Gemma's `<thought>` block had multiplied every debate round's tokens into a quota error) |
| Outside servers (MCP, backends, envs) | A server either had to be reachable at a URL, or was a shell command run on the host (`MAS_ALLOW_LOCAL_EXEC`, no isolation, no way to upload) | **Endpoints, remote or hosted:** one `endpoint` on plugin backends, tools and envs; **hosted services** run uploaded code, single containers or whole compose projects, in Docker (no network, or only the declared hosts through an egress proxy; no published ports; unprivileged) — [hosting.md](hosting.md) |
| The Architect | The agent that designs systems from a description knew none of the interfaces above, so it would have wired N copies for an ensemble and left results undeclared | **Every new interface goes into the Architect's tools too:** asked for "the same question 7 times, most common number wins", it now builds one model component with `replicas: 7`, a vote, and `result: number`, and the design runs (7 calls, checked as a number) |
| The Architect, asked for an AutoGen-style chat | It made a selector room, was told it needed a manager, and had no option to set one: it rebuilt the room until its steps ran out ($0.12, nothing usable); two later designs used every step and never explained themselves | **Rooms take a selector** (connected to the room, read-only, when set); the Architect is **told when four steps are left**, and asked for its explanation if it still runs out. The same request now gives a complete design in 31 steps, with a model-free code runner in the room and a summary |
| All 26 templates | Found the two above; structural tests and dry runs had passed | **`record-demos.mts --check`:** every template on real models, a table of which finish with an answer and why not (26 of 26 healthy after these fixes, $0.22; 27 of 27 again after sandboxes were hardened and CLI agents moved into containers, $0.20; it also notes answers without an answer line) |
| Graders | "40%" was read as 0.4 against GSM8K's 40; AutoGen's closing `TERMINATE` was taken for the answer | **Graders:** percentages match either form; stop words are not answers |
| MATH-500, GSM-Hard | A math grader validated only on the answer key's own forms marked ~7 of 50 right model answers wrong (`4/3` vs `\frac43`, `±`, lists, units); `-$70,145,984` was read as positive | **Graders are checked against model outputs, not only reference solutions:** fractions, `\pm`, unordered lists, trailing units; signs before currency; intervals written as inequalities, sets in braces, matrices entry by entry, decimals below 1 |
| MMLU | Debate looked 4 points better on one run each (92 → 96); two more runs of the single agent scored 96 and 97. Separately, an evaluation of a system whose model had no key ran all 100 cases with empty answers | **Paired comparison** on Compare systems: each system's questions fixed and lost against a reference, with an exact McNemar p-value; **evaluations refuse to start** when a model they call has no key |
| MapCoder | The paper writes k plans and tries them best first, each with its own debugging rounds; the template wrote one plan, because "try in order until one passes" had no part | **`iterate.over`** on a group: round n receives item n of a list picked from the input, until the stop condition holds or the list ends; nested with the debug loop, it is the paper's k × t search. **Run variables in instructions** (`{{vars.k ?? 3}}`), so the planner writes as many plans as the group tries |
| MedAgents | The first evaluation graded 0 of 57: the decision gave the option first and its reason last, and graders read the last line; every failure looked like a wrong answer | **The template ends with `Answer: X`**, and **failure reasons** show a sentence graded against a one-letter answer as its own group ("a sentence, not an answer") |
| AgentVerse, AutoAgents | First runs scored 10 and 13 of 30: AgentVerse returned its evaluator's feedback when the evaluator stayed unsatisfied; AutoAgents ended with a check after its answer, which graders read | **Template rule:** whoever delivers the result ends with `Answer: X` when the task asks for one value, and a reviewer always ends by repeating the deliverable (AgentVerse 10 → 20). **Marked answers:** a declared result can require an answer line (`marked: true`), and evaluations with a single-answer grader check it on every system (`expect`), so the next template with this bug is flagged on its first run |
| A world of its own (Generative Agents' town) | An env whose MCP server was a hosted service checked its health path ("/health") as a URL, failed, and gave its agents no tools: they narrated walking to the park instead of walking there | **Envs reached through an endpoint leave starting and health to the hosting layer**; `examples/hosted/text-world-mcp` is a shared world (places, things, speech, a clock), and two agents in it reproduce the party's spread: what Isabella says in the park, Klaus hears there |
| Every comparison | Questions pasted by hand, evaluations run in parallel (a burst of 875 calls a minute got a key suspended) | **Datasets** (versioned, sampled), **batch evaluations** (one system after another), a **server-wide rate limit** |
| Meta-Prompting (word sorting) | Its sorted lists, one numbered word a line after "Answer:", were all graded wrong: the grader read only that line | **Graders read a list answer whole** (one item a line) |
| Meta-Prompting (Game of 24) | An answer with no single form (any expression that makes 24) could not be graded against an expected string | **Grader `check`:** JS kept with the dataset decides, sees the output and the final answer, and is kept on the evaluation for regrading |
| Meta-Prompting (Game of 24) | With no cap on reply length, flash-lite repeated itself to its output limit every round: $1.4 a run under a $2 budget, and no end | **A spending limit per run** on the evaluation (`usd_limit`), and loop templates cap replies and the conversation they re-send |
| Open-ended comparisons | A length-matched control was built by hand each time (mean words, the plain baseline, a style variable) | **One-click length-matched control** on the Pairwise panel; judgements name each side's setup, run variables included |

## What the results say about the patterns

From [benchmarks.md](benchmarks.md), all on the same model:

- **Neither a weaker nor a stronger model makes discussion pay.** On the
  stronger gemini-3.8-flash, Multiagent Debate scores 26 and 26 on Hard
  computation against one agent's 26 and 27 (+0 −1), and the diverse
  debate, the best three-debater setting on flash-lite, 27 and 27 (+3 −2). On gemma-4-26b, over two runs each, one agent
  scores 25.5 of 30 on Hard computation, and Multiagent Debate (25.5), ReConcile
  (26.5), Agent Forest (25.5) and Solo Performance Prompting (24.5) do no better;
  on flash-lite debate gains 2–4. This was first reported the other way
  (one gemma agent at 18, debate +8, p = 0.02): the run log had cut gemma's
  long answers off before their final line, and the grader read a number
  from the middle of the reasoning. Fixed and run again, the gain is gone.
  On MMLU the same debate on gemma gained nothing either (90 → 89). A
  measured gain is checked against the grader's own misses before it is
  believed.
- **Test-and-repair loops need something to repair.** On HumanEval with
  flash-lite, AgentCoder and MapCoder scored 48 of 50, as did a single agent
  (49 with a code runner); the papers' gains were over single gpt-3.5 calls.
- **Sampling more stops paying after a few samples.** MacNet's star grows
  from 19 (2 nodes) to 22 (4) and then gives one back (21 at 8 nodes, at
  nearly twice the cost of 4). Agent Forest at N = 3
  matches the discussion systems (22 of 30); N = 10 and 20 add a question or
  lose one, at up to 20 times the cost. The questions every N misses are the
  ones that need computation.
- **One round of discussion is all that pays.** Multiagent Debate goes from
  19 (no exchange) to 23 after one exchange, then stays at 22 for rounds 3 and
  4. Agent Forest flattens after three samples. Both stop at the questions
  that need computation.
- **Discussion helps a little, and voting is the bar to beat.** On a set with
  room to improve, Multiagent Debate and ReConcile gain 2–3 questions in 30
  over a single agent. Self-consistency (five samples and a vote) gains as
  much as ReConcile, at 60% of the cost. A vote helps only where the right
  answer is the one given most often: on long ledgers, where every reading
  skips different orders, five readings voted score below one (6.5 against
  9), and splitting the reading (Chain-of-Agents, 14) is what helps.
- **Splitting a long input helps to gather, not to find.** On 20 generated
  ledgers of ~44,000 characters, the total one customer paid over 8 to 14
  scattered orders: one agent reading it all 9 of 20; Chain-of-Agents,
  relaying a note through ~8 parts, 14.5; LongAgent, members reading the
  parts at once, 13.5 at less than half the chain's cost (both p ≈ 0.02
  against one agent); five whole readings voted, 6.5. Asked instead what one
  order paid, a single line, one agent finds all 40, and still all 40 at
  four times the length (~45,000 tokens). One agent with a code
  runner reading the ledger from its sandbox totals 39 of 40, as on every
  set where the work is exact.
- **Tools matter more than talk.** Questions no discussion fixed in any run
  (digit sums of large powers, binomials mod p) were solved every time once
  one agent could run code. A single agent with the same sandbox scored the
  same 30/30 as AutoGen's five-agent chat, faster and cheaper, and so did
  Magentic-One once its terminal ran code in the sandbox (15 → 30). On the
  weaker gemma, where debate and voting reached 25–26 against one agent's 27,
  one agent with a code runner scored 30 in 8.5 minutes against debate's 116. Where the
  arithmetic is short the edge shrinks: on 100 MATH-500 problems a code
  runner fixed 5 and lost none (p ≈ 0.06), and on GSM-Hard's well-posed
  questions it changed nothing.
- **On one 30-question set, every paper system side by side** (Hard
  computation, flash-lite): those that run code solve all 30; those that
  exchange or vote on answers gain 2–4 over one agent's 19 (EoT 22.3, ReConcile
  and DyLAN 22, MacNet's star 22.5, debate 21; p ≈ 0.02 for the best; MacNet's
  chain, which refines one solution in sequence, stays at 19); those built on roles,
  personas or long pipelines are no better than one agent (AgentVerse 19.5,
  MoA 18, MedAgents 16), and role-play is reliably worse (CAMEL 13, ChatEval
  12.5, AutoAgents 14, p ≈ 0.01 over two runs each; MAD 14, p 0.05). MAD's devil, made to disagree, talks its judge out
  of right products; reviewers that recompute by hand (AgentVerse,
  AutoAgents) confirm wrong ones.
- **Test-and-fix loops do not pay on easy code.** On 31 coding problems a
  single agent with a sandbox (59 of 62) scored within one problem of
  AgentCoder (60) and ahead of MapCoder (58), at a quarter to a third of their cost. Writing tests separately
  from the code (AgentCoder) is the one mechanism that caught bugs a single
  attempt missed.
- **A simulated discussion does as well as a real one.** One model playing
  several personas in a single call (Solo Performance Prompting) scored as
  Multiagent Debate does (21 of 30 on average on flash-lite, at a fifth of the
  cost), and on the weaker gemma it scored 25 to debate's 26, agreeing with
  debate on 29 of 30 questions.
  On MMLU's medical questions it scored 73 of 75, as MedAgents' specialist
  panel and debate did, missing the same two. What discussion adds does not
  need separate agents.
- **Where debate gains, the exchange does it.** On flash-lite the vote over
  the debaters' first answers, before any exchange, is no better than one
  agent, and the exchange is what lifts it (nine verdicts turned right, none
  wrong, over a rounds sweep), against Choi et al. (2025), who credit the
  vote; on gemma neither gains (vote 26 = debate 26, one agent 27). On MMLU the rounds only add risk (gemma: four right
  verdicts turned wrong, one fixed).
- **Mixing models reaches the best member, not beyond it.** ReConcile with one
  seat per model averaged 27.3 over three runs, as its strongest seat did alone
  (gemini-3-flash, 27.3), at about four times the cost. Mixture-of-Agents
  with three different proposers is the one exception seen, and a small
  one: 28 and 27 against its best model's 26 and 27 (+2 −0, p = 0.5), where
  filling every slot with that best model (Self-MoA) scored 26 and 26. The papers' gains over a single model came mostly from
  models weaker than their best member.
- **On open-ended answers, layering a strong model gains.** On twenty
  instructions judged pairwise, MoA with gemini-3.8-flash proposing and
  aggregating beats that model alone 31–0 over two runs. It still wins 22–6
  with lengths matched and 17–0 under a judge from another family, and Self-MoA
  on it does the same. With flash-lite proposing, or flash-lite throughout, it
  gains nothing. It shows where answers are graded on coverage rather than
  right or wrong. Self-Refine, one model critiquing and revising its own answer,
  gains as much on the same model (25–2, 20–8 at matched length), all of it on
  the answers its critic chose to revise, at two thirds of MoA's cost, and
  unlike MoA it gains on flash-lite too (21–2). Multiagent Debate, each
  debater revising after reading the others, gains as much on that model
  (26–6 at matched length) at the highest cost. Judged against each other,
  debate beats Self-Refine over fifty instructions (34–18, p 0.04) at twice
  its cost, and MoA is level with both (21–24 against debate, 27–22 against
  Self-Refine, over the same fifty). On flash-lite only Self-Refine still gains; MoA and
  debate lose to one call (debate's answers come out shorter). These three are
  the only gains here that survive every control, all on open-ended answers.
- **Writing teams do not beat one writer.** Agents' Room loses short and long
  stories to one call (0–10, 0–9, 1–9), and STORM is no better than one agent
  with the same search tool (7–12), citing more links that no search returned.
  As a judge, ChatEval's panel agrees with a stronger judge no more often than
  one call does (47 against 45 of 70), though it is steadier when the answers
  swap places.
- **A brainstorming group is more creative mostly by listing more.** LLM
  Discussion's role-played agents beat one call 37–0 on alternative-uses items,
  and a single call asked for as many uses 16–1 with 23 ties, at eleven times
  the cost. A judge that saw only the first 12,000 characters of each answer
  first called that 19–0, reading the long lists as unfinished; judges now see
  answers whole. On flash-lite even that edge goes: 2–1 with 17 ties at
  matched count.
- **What a system learns can choose its team.** DyLAN, carrying its agents'
  importance across runs, ranked the Programmer and the Mathematician far above
  the Skeptic and the Generalist on computation questions; a team of those two
  scored 20 of 30 instead of 22, at 24% less.
- **The fair baseline has the same tools.** A system with a code executor has
  to be compared with one agent that has the same executor, not with a bare
  model. Matched that way, discussion adds nothing here: Multiagent Debate
  with a sandbox per debater scored 49 of 50 on MATH-500 against one agent
  with a sandbox's 48 (one problem, p = 1), at four times the cost.
  Meta-Prompting shows it again: on Game of 24, its conductor with an Expert
  Python solves 43 and 42 of 50, while one agent with the same sandbox solves
  all 50 twice, at half the cost. Without code, its gains (word sorting 45
  against one agent's 35, Game of 24 36 against 30) are matched by one call
  with personas (Solo Performance Prompting) and by ten-sample voting, and
  beaten by Self-Refine (49 of 49 on word sorting).
- **A second look without feedback changes little, and on arithmetic not for
  the better.** Intrinsic self-correction (Huang et al.), reviewing and
  improving its own answer twice, kept the same answer in about three runs of
  four; on GSM-Hard every verdict it changed went from right to wrong (5 to 0),
  on Hard computation it gained 4 and lost 2. Self-Refine on the same GSM-Hard
  questions did no better (9 right → wrong, 3 back), until a stronger model
  criticised: then 10 wrong → right and none back, as it rarely objected,
  though that model answering alone did nearly as well for a third of the cost. Self-Refine gains where a slip
  shows on rereading (word order) or on doing the arithmetic (Game of 24: 16
  wrong → right against 2); on arithmetic the check that changes
  answers comes from outside, such as running code.
  Even then, the outside check has to be trusted: CRITIC shows the critic its
  program's output, and on GSM-Hard flash-lite still overruled right results
  (15 right → wrong against 3 back; without the output 20 against 2; with the
  authors' few-shot prompts 11 against none), while
  its first program alone matched one agent with a sandbox.
- **A paper's gain needs room to show.** On GSM8K the single agent already
  scores 97, so a debate cannot show the paper's 77 → 85; on MMLU, 95 against
  the paper's 64 (debate 95.5, no gain). Even a benchmark meant to leave room
  can be capped by its key: every question all systems missed on GSM-Hard was
  broken, which is why datasets can now flag questions.
- **A score of one run needs its spread.** A 4-point gain for debate on MMLU
  (92 → 96) vanished when the single agent was run twice more (96, 97). The
  paired test on the Compare page (questions fixed and lost, McNemar) is what
  says whether a gap is more than noise.
- **Most "failures" of a rebuilt system were the rebuild.** Every bug in the
  table above first looked like the paper's method doing badly. The most
  common single cause was the result's form: eight templates first lost
  points because their last message was not the answer (a critique, a check,
  code, "Next request."), which is why evaluations now check every answer for
  an answer line. A
  reproduction is not done until it has been run on a benchmark and its
  failures have been read one by one.

## What does not abstract cleanly yet

These come from the templates' `differs` notes. They are the open edges of
the vocabulary:

- **Environments with their own world.** Generative Agents' town, Voyager's
  Minecraft and Werewolf's game are a room, a Python sandbox and a custom
  loop. A world with space, objects and a clock has no component of its own;
  it comes in as a hosted MCP service (`examples/hosted/text-world-mcp`: places,
  things, speech and a clock, shared by every agent connected to it) or an
  imported env (`mas-env/1`).
  Generative Agents' party now runs in one (`examples/hosted/town-mcp`, six
  places, a clock that moves between steps): over three days word reached 3, 4
  and 5 of five residents, the one starting farthest from the cafe missing it
  most. At the paper's scale (25 residents, two days, interviews at the end),
  15 and 17 of 24 knew of the party when asked, against the paper's half, and
  9 and 11 came, all of them among those who knew. With residents keeping only
  their last few messages, 44% knew (two runs, noisy); adding the paper's
  memory stream, with reflection firing 3 to 6 times per resident, 19 and 10
  knew: between the two, too noisy over two runs to say more.
- **Learned components** (in part). Agents' Room fine-tunes its agents, which
  the platform does not (it runs prompted models). What is learned from one
  task to the next can now be carried: code keeps values across runs in
  `ctx.state`, and DyLAN accumulates its agents' importance there and, with
  `team_size`, picks its team from it, as the paper's team optimization does.
- **Agents without a model** (now expressed). AutoGen's user proxy and
  Magentic-One's terminal run code without a model call. A function component
  connected to a sandbox calls its tools with `ctx.tool(name, args)`: Magentic-One's
  ComputerTerminal is now that, as in the paper (30 of 30 on Hard computation,
  cheaper than the small model that stood in). A function in a room replies on
  its own when it returns something: AutoGen's user proxy is now that, running
  each python block it sees (28 of 30 on Hard computation at a fifth of the
  cost).
- **Data the papers had.** TradingAgents' market feeds, STORM's Wikipedia
  tables of contents and Werewolf's experience pool are connectable (MCP envs,
  knowledge and memory plugins) but not bundled.

## Open questions for the platform

- **The result of a run was implicit; it can now be declared.** A system's
  `result: {type}` (text, number, code, json, choice) is checked at the end of
  every run, and evaluations flag answers of the wrong kind before their
  grade. AgentCoder and MapCoder declare `code`. Still open: graders could
  read the declared result directly instead of searching the last message
  for it.
- **Iteration is the most used part.** Sixteen papers are a group that
  repeats. The run page now has a Rounds tab: each round's calls and cost, the
  value it ended with, and why the group went on, stopped, or gave up at the
  round limit. A loop that never passes (MapCoder before its fixes: five
  rounds, then "gave up") is visible at a glance. Group nodes on the canvas now show it too:
  their loop settings always, and during a run or replay the round they are
  on, then whether the condition held, the rounds ran out, or all rounds ran.
- **Templates need behaviour checks, not only structure checks.** Structural
  tests check that a template has the paper's parts; only running it on real
  models found the bugs above. `record-demos.mts --check` now runs every
  template on real models and reports which ones finish with an answer and
  why the others do not. A per-template benchmark sample with a known pass
  rate would go further.
- **Open-ended results depend on the judge and the baseline.** Pairwise
  judging shows what can bias a verdict: each side's length and structure, how
  often the judge picked the response shown first (four in five on stories), and
  the share of links a run's own searches returned. A baseline's prompt alone
  produced one apparent gain (MoA over a writer told to give the piece only).
  A judge that can search now exists as a template (Fact-checking judge, a
  judging system with `web_search`); on STORM it moved single verdicts a lot
  and the conclusion not at all. Still open: human labels, without which
  agreement is measured against a stronger model.
