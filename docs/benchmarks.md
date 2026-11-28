# Benchmarks

These numbers come from the Evaluate page (`POST /api/evals`). Every system is
run with **Models: everything on one model**, so the comparison is about how
each system is put together, not which model it uses. The question sets ship
as the page's sample sets, and their answers are computed by program.

## At a glance

The current standing, after every correction below. Each number here has
had its misses checked with the LLM judge, and every case without a known
answer (a provider error, an output cut short) run again; p values are
exact McNemar tests against one agent on the same questions.

- **Running code beats talking.** On Hard computation (30 exact
  computations, flash-lite) one agent with a code runner, Magentic-One and
  AutoGen solve all 30; no discussion system exceeds 23. On the weaker
  gemma one agent with code solves 30 against one agent's 27. On MATH,
  where errors are reasoning, code is a small, consistent edge (+5 −0 over
  100 problems, p 0.06).
- **Exchange and voting add 2–4 questions in 30, with a strong enough
  model.** One agent 19; self-consistency (5 votes) 22; debate 21, with 5
  debaters 22.5 (p 0.04); debaters each reasoning a different way 23 (p
  0.02), and 22 as a vote over those three different first answers (a
  plain three-sample vote: 20.5). Exchange-of-Thought 22.3 over three runs;
  ReConcile, DyLAN, Corex and Multi-Agent Verification 22; MacNet's star of
  four 22.5 (p 0.04), its chain 19.5. Every discussion system on this set
  now has at least two runs.
- **On the stronger gemini-3.8-flash, debate gains nothing either** (26,
  26 against one agent's 26, 27; the diverse debate 27, 27): across three
  models only the middle one, flash-lite, gains from discussion.
- **On the weaker gemma, nothing without a tool beats one agent** (27;
  debate and ReConcile 26, voting and SPP 25). A 7–8 question gain first
  reported there came from cut-off answers ([A weaker model](#a-weaker-model-no-gain-from-discussion-after-all)).
- **Roles, personas and long pipelines are no better than one agent, and
  role-play is worse.** On Hard computation, two runs each: AgentVerse
  19.5, Mixture-of-Agents 18, MedAgents 16 are no different from one agent;
  CAMEL 13, ChatEval 12.5 and AutoAgents 14 are significantly worse (p ≈
  0.01), MAD 14 nearly so (p 0.05).
- **Layered calls gain on open-ended answers with a strong enough model.**
  MoA with gemini-3.8-flash aggregating (proposers gemini-3.8-flash, flash-lite
  and gemma) beats gemini-3.8-flash alone on twenty instructions 31–0 over two
  runs, 32–0 with length ignored, 22–6 at matched length (p 0.004), and 17–0
  under a judge from another family, at six times the cost: the first gain here
  that survives every control. With gemini-3.8-flash in every slot it does the
  same (17–0 in each of two runs). With only the aggregator strong and flash-lite
  proposing, it gains nothing (12–10) at five times the cost; on flash-lite
  throughout, nothing either. Picking the most consistent of five samples
  (Universal Self-Consistency) instead of merging them gains nothing (12–7)
  ([a strong model](#a-strong-model-a-gain-that-survives-the-controls)).
- **Self-Refine gains as much as MoA on open-ended answers, with one model.**
  On gemini-3.8-flash, answering, critiquing and revising beats the model
  alone 25–2 over two runs and 20–8 at matched length, all of it on the answers
  the critic chose to revise (19–0), at two thirds of MoA's cost. Unlike MoA,
  it gains on flash-lite too (21–2, 21–1 judged on content)
  ([Self-Refine](#one-model-criticising-itself-gains-as-much)).
- **Meta-Prompting gains on word sorting, but voting gains as much and
  Self-Refine more.** On 49 lists, flash-lite: one agent 35, 35;
  Meta-Prompting 45, 44 at seven times the cost; ten-sample voting 45, 44;
  Self-Refine 49, 48. On Game of 24, Meta-Prompting with an Expert Python
  gains (43, 42 against 30, 35), but one agent with a sandbox solves all
  fifty twice at half the cost ([Meta-Prompting](#meta-prompting-word-sorting-and-what-else-gains-as-much)).
- **Revising one's own answer helps only where a slip can be seen.** On
  GSM-Hard (50, flash-lite, two runs each), changed answers went right → wrong
  far more than back: intrinsic self-correction 5 to 0, Self-Refine 9 to 3,
  CRITIC 15 to 3 with the execution shown and 20 to 2 without. Where an answer
  can be checked by reading or by doing the arithmetic, the same Self-Refine
  gains: word sorting 49 and 48 of 49, Game of 24 16 wrong → right against 2.
  CRITIC's first program is its gain
  ([self-correction](#self-correction-without-feedback-what-the-second-look-changes),
  [CRITIC](#critic-criticising-with-the-interpreters-output)).
- **Debate gains on open-ended answers too, at the highest cost.** Three
  debaters revising after reading each other (open mode) beat gemini-3.8-flash
  alone 33–1 over two runs, 36–1 on content, 26–6 at matched length, at $0.48
  for twenty against Self-Refine's $0.20 and MoA's $0.31 for about the same
  gain ([debate](#debate-revised-in-the-open-gains-as-well)).
- **A brainstorming group is more creative mostly by listing more.** LLM
  Discussion's four role-played agents beat one call 37–0 on twenty
  alternative-uses items. Against one call asked for as many uses, they win
  16–1 with 23 ties, at eleven times the cost. A judge first shown only 12,000
  characters of each answer had called that 19–0
  ([LLM Discussion](#llm-discussion-creativity-and-what-the-judge-was-shown)).
- **Mixture-of-Agents beats a prompted writer, not a plain model call.** On
  twenty open-ended instructions it wins 31–9 against a one-call writer told to
  give the piece only (p 0.0007), even with lengths matched, and 14–19 against
  one plain call of the same model (p 0.49), at nine times the cost. The
  writer's prompt took away the headings and lists the judge rewards
  ([Mixture-of-Agents](#mixture-of-agents-on-open-ended-instructions-the-baseline-decides)).
- **ChatEval judges no closer to a stronger judge than one judge call.**
  As a pairwise judge on 70 questions, its debate agrees with gemini-3.8-flash
  on 47 against one flash-lite call's 45 (p 0.79), at ten times the cost; it is
  steadier when the two outputs swap places (80% against 71%)
  ([ChatEval as a judge](#chateval-as-a-judge)).
- **STORM is no better than one agent with the same search tool.** On ten
  recent topics it wins 7 and loses 12 over two runs (p 0.36), at 12 times the
  cost. Half or more of its links came from no search; one searching agent's
  links did ([STORM](#storm-articles-on-recent-topics-with-live-search)).
- **A writers' room loses to one writer on short stories.** Agents' Room
  (four planners and five section writers around a scratchpad) loses 0–10
  and 0–9 (one tie) to one call, judged pairwise in both orders. A second
  judge, gemma, gives 0–8 (two ties), and stories of about 2,000 words give
  0–10. On gemini-3.8-flash it still loses to that model alone (0–4, 6 ties).
  It costs 7 to 18 times as much. Three setup
  bugs came first: cut-off verdicts, a scratchpad shared across stories, and
  a baseline answer line ([Agents' Room](#agents-room-stories-judged-pairwise)).
- **Choosing among samples cannot add an answer no sample has.** On the
  misses of the vote, Corex and Multi-Agent Verification the right answer
  was among the samples in 1–2 of 16; debate's debaters had and lost it in
  a fifth of its misses ([Answers the team had and lost](#answers-the-team-had-and-lost)).
- **Reading a long input in parts beats reading it whole**: on 20
  generated ledgers of ~44,000 characters, Chain-of-Agents 14 of 20 against
  one agent's 9 (+14 −4, p 0.03), at three times the cost, and LongAgent
  (members reading at once) 13.5 at about the single reader's cost; one agent with
  a code runner reading the ledger from a file 19.5 (p 0.003 against the
  chain), at twice the chain's. A vote over five whole readings scores
  6.5, below one: each reading skips different orders, so no total wins.
  Asked instead for one order's amount, a single line, one agent finds all
  40: it is gathering scattered evidence that splitting helps with
  ([Long input](#long-input-chain-of-agents-on-ledger-totals)).
- **A model critiquing itself helps on reasoning and open-ended answers, not
  arithmetic** (Self-Refine: MATH level 5 40 → 44; Hard computation revisions
  4 right, 3 wrong; open-ended instructions 25–2, above).
- **In games and simulations the model decides more than the design.** A
  greedy fisher empties GovSim's commons on all three models; the
  LLM-Stakeholders negotiation closes 12 of 20 deals on gemini-3.8-flash and
  none of 60 on flash-lite; SOTOPIA's one writer who knows both goals scores
  above two agents on 3.8-flash (p < 0.001, under either judge) and not on
  flash-lite or gemma. MachineSoM's societies beat one agent and an equal-call vote on
  AIME and HMMT, but debating first, the paper's finding, did not win; and
  in the consensus game the agents move to the mean of what they see, a
  star's hub pulling the group and a stubborn agent stalling a ring
  ([SOTOPIA](#sotopia-social-goals-played-or-written),
  [MachineSoM](#machinesom-debate-or-reflect-and-in-which-order),
  [Consensus](#consensus-seeking-the-network-and-a-stubborn-agent),
  [Stakeholders](#llm-stakeholders-six-parties-a-veto-and-five-of-six),
  [Avalon](#recon-on-avalon-hiding-merlin)). ReCon's private contemplation
  hides Avalon's Merlin on 3.8-flash (good wins 8 of 20 against 2 of 21, p
  0.03); on flash-lite, whose evil players never sabotage, it changes nothing.
- **Where gains exist they cost**: five debaters cost 17 times one agent
  for 3.5 questions; the cost frontier on Hard computation is the code
  runners (Compare → accuracy against cost). Trying to save the other way
  fails too: FrugalGPT's cascade (cheap model, a scorer, a strong model
  only when in doubt) scores 21.5 at $0.054 a run, against the strong model
  alone's 26.5 at $0.033, since its scorer trusts wrong answers and the
  price gap is only two to one ([A cascade](#a-cascade-frugalgpt)).

## Exact computation (30 questions), all on gemini-3.1-flash-lite

Long multiplication, date spans, letter counts, digit sums of powers, and
counts of coprime integers. Every system answered every question 3 times
(Evaluate page, Repeats = 3). Run on 2026-11-17.

| System | Correct per repeat | Mean | Cost (90 runs) |
| --- | --- | --- | --- |
| Single agent (baseline) | 25, 25, 26 | 25.3 | $0.06 |
| Self-consistency, 5 samples | 26, 25, 27 | 26.0 | $0.36 |
| DyLAN (Liu et al.) | 26, 26, 26 | 26.0 | $0.37 |
| Multiagent debate (Du et al.) | 26, 26, 27 | 26.3 | $0.52 |
| ReConcile (Chen et al.) | 27, 27, 27 | 27.0 | $0.48 |

An earlier single-repeat run also included Mixture-of-Agents: 25/30 for
$0.20. Its aggregator corrupted three multiplications that its proposers had
right.

What this shows:

- **The ranking is stable across repeats, but the gaps are small.** ReConcile
  is best in all three repeats, and the single agent is worst or tied in all
  three. The best system gains about 1.7 questions in 30, at about 8× the cost.
- **Self-consistency is the fair baseline.** At the same cost, five samples
  and a vote do about as well as DyLAN and nearly as well as debate. Only
  ReConcile, which mixes in confidence, stays ahead in every repeat.
- **No system fixes the hardest questions.** Three or four questions, the
  digit sums of large powers (#19, #21–23), fail for every system in almost
  every repeat. Discussion helps when some agents get a question right; it
  cannot produce a skill none of them has. (With one model behind every seat,
  the papers' point about diverse models doesn't apply here.)

## Exchange-of-Thought: four ways of connecting the same three agents

Same 30 exact-computation questions, all three agents on gemini-3.1-flash-lite,
one run per paradigm (run variable `paradigm`). Run on 2026-11-18, with the
server's request limit in force (at most 60 requests a minute).

| Paradigm | Who sees whom | Correct | Cost |
| --- | --- | --- | --- |
| Debate | B and C argue; A sees both | 28/30 | $0.14 |
| Memory | everyone sees everyone | 27/30 | $0.17 |
| Relay | a ring: each sees the one before it | 27/30 | $0.21 |
| Report | A is the hub; B and C see only A | 26/30 | $0.17 |

On the same questions, the single agent scored 25.3 on average over three
repeats (see above).

What this shows:

- Every paradigm lands within two questions of the others. That is inside one
  run's noise: the single agent alone moves by four between runs. So no paradigm
  is shown to be better.
- Most questions are settled in the first round, when all three agents already
  agree. In that case who sees whom never comes into play. The paradigms differ
  only on the few hard questions (#19, #21–23, digit sums of large powers),
  which every paradigm keeps missing.
- To tell the paradigms apart, a set needs more questions where the agents
  disagree at first.

## A ceiling check, and a harder set

On the 30 exact-computation questions, a single agent scored **30/30** on both
gemini-3-flash and gemini-3.8-flash. On that set, a mixed-model ReConcile cannot
beat its strongest seat.

So there is a harder set, "Hard computation (30)", with answers computed by
program: six-digit multiplication, digit sums of larger powers, date spans
across centuries, letter counts in long strings, modular inverses, and binomial
coefficients mod p. One run each, 2026-11-18:

| Single agent on | Correct | Missed |
| --- | --- | --- |
| gemini-3.1-flash-lite | 17/30 | 13, across every kind of question |
| gemini-3.8-flash | 26/30 | #6, #7, #8, #10 (digit sums of powers) |
| gemini-3-flash | 27/30 | #6, #7, #9 |

The two stronger models miss different questions: 3-flash gets #8 and #10,
3.8-flash gets #9. A discussion that always adopted the right answer could
reach 28/30. The question is whether ReConcile, with one seat on each model,
gets above the strongest seat's 27.

## ReConcile with three different models

ReConcile with one seat on each model (lite, 3.8-flash and 3-flash), on the
harder set, one run: **28/30** ($0.31, about 25 minutes). The strongest seat
alone scored 27.

| Question | 3.8-flash alone | 3-flash alone | ReConcile, mixed |
| --- | --- | --- | --- |
| #6 | ✗ | ✗ | ✓ after four rounds |
| #7 | ✗ | ✗ | ✗ |
| #8 | ✗ | ✓ | ✗ (talked out of the right answer) |
| #9 | ✓ | ✗ | ✓ |
| #10 | ✗ | ✓ | ✓ |

- On #9 and #10, the discussion adopted the seat that was right.
- On #6, it reached an answer neither strong model had alone.
- On #8, it lost a right answer.

One question in 30, from one run, is within run-to-run noise.

### Three runs each: a tie

| Arm | Runs | Mean | Cost per run |
| --- | --- | --- | --- |
| gemini-3-flash alone (the strongest seat) | 27, 27, 28 | 27.3 | about $0.07 |
| ReConcile, one seat per model | 28, 28, 26 | 27.3 | about $0.30 |

With three runs each, mixed-model ReConcile ties its strongest seat, at about
4.4 times the cost. Between them, ReConcile's two new runs missed #6, #7, #9
and #10, including the two questions where the first run's discussion had
adopted the right seat. The single agent's new runs missed only #6, #7 and #8.
On this set and these models, the paper's claim that the mix beats its best
member does not reproduce. There is little room to show it: the best seat is
already at 91%. A fairer test needs a set where each seat is wrong on different
questions.

## Hard computation, all on gemini-3.1-flash-lite

On GSM8K the single agent left no room. On "Hard computation (30)" the lite
model alone gets about 19, so there is room to gain. Every paper system
that answers questions, through the built-in dataset (2026-11-18 onward),
two runs where two scores are given, one otherwise:

| System | Runs | Mean | Cost (60 runs) |
| --- | --- | --- | --- |
| Single agent | 20, 18 | 19.0 | $0.05 |
| Self-consistency, 5 samples | 22, 22 | 22.0 | $0.31 |
| Multiagent debate (Du et al.) | 21, 21 | 21.0 | $0.50 |
| ReConcile (Chen et al.) | 22, 22 | 22.0 | $0.51 |
| MAD (Liang et al.; angel, devil, judge) | 14, 14 | 14.0 | $0.23 |
| AgentVerse (recruit experts, execute, evaluate) | 20, 19 | 19.5 | $0.29 |
| AutoAgents (generated team, observers, execution loop) | 14, 14 | 14.0 | $0.13 |
| Exchange-of-Thought | 23, 22, 22 | 22.3 | $0.29 |
| DyLAN | 22, 22 | 22.0 | $0.17 |
| Mixture-of-Agents | 17, 19 | 18.0 | $0.24 |
| MedAgents | 16, 16 | 16.0 | $0.34 |
| CAMEL role-playing | 12, 14 | 13.0 | $0.11 |
| ChatEval | 12, 13 | 12.5 | $0.19 |
| Magentic-One (its terminal runs code in the sandbox) | **30** | 30.0 | $0.06 |
| Solo Performance Prompting (one call, simulated personas) | 20, 22 | 21.0 | $0.10 |
| Corex, Retrieve (5 chains, a retriever picks one) | 22, 22 | 22.0 | $0.49 |
| Multi-Agent Verification (5 chains, 3 aspect verifiers approve or reject each) | 22, 22 | 22.0 | $0.95 |
| Self-Refine (one model: answer, critique, revise; 3 rounds) | 21, 21 | 21.0 | $0.61 |
| MacNet, chain of 4 | 19, 20 | 19.5 | $0.31 |
| MacNet, star of 4 | 22, 23 | 22.5 | $0.44 |
| MacNet, mesh of 4 | 21, 21 | 21.0 | $0.47 |

- **MAD loses 5 to the single agent, in both runs.** Its debaters are an
  "angel" and a "devil" who must disagree, and a judge decides. On the long
  multiplications (#1–14) the devil disputes a right product, and the judge
  recomputes and sides with a wrong one ("Devil correctly identified that
  Angel's partial products were … summed incorrectly"). MAD was built for
  counter-intuitive questions, where forced disagreement breaks a first wrong
  idea; on exact computation it adds errors. (MAD was run later than the
  others in this table, on the same set.)
- **The whole table, in three groups.** Systems that run code solve
  everything: Magentic-One 30 (and AutoGen with its executor, 30, below).
  Systems that exchange or vote on answers gain 2–4: EoT 22.3 (23 in its first run, then 22 and 22), ReConcile and
  self-consistency 22, DyLAN 22, debate 21, AgentVerse 20; against the single
  agent (Compare, McNemar) EoT, debate and Agent Forest at N = 10 fix 7 and
  lose none (p = 0.02). Systems built around roles, personas or long
  pipelines score lower, and with two runs each (60 question-run pairs
  against one agent's two) they split in two. AgentVerse 19.5 (+7 −6),
  Mixture-of-Agents 18 (+8 −10) and MedAgents 16 (+6 −12, p 0.24) are **no
  better than one agent**. CAMEL 13 (+3 −15, p 0.008), ChatEval 12.5 (+5
  −18, p 0.01) and AutoAgents 14 (+2 −12, p 0.01) are **reliably worse**,
  and MAD 14 nearly so (+6 −16, p 0.05): the role-play and argument they
  add talks the model out of products it would have got right alone. (An
  earlier version of this note, from one run each, said none was reliably
  worse.) None of them checks by computing. (The rows after ReConcile were
  run later, with every answer checked for an answer line; all now have
  two runs.)
  All 436 misses of the flash-lite evaluations on this set were checked
  with the judge: it agreed with the grader on all but 6. Two were grader
  errors, now fixed (AutoAgents wrote "Total: 3 + 0 + … + 1 = 6", read as 3;
  MedAgents wrote "one"), which added one question each. The other four
  are AgentVerse and AutoAgents ending with a verification line after the
  answer and no answer line ("… ≡ 1 (mod 1009)" after "is **441**"): the
  rule grades the last line, so they stand, but read leniently AgentVerse's
  first run and AutoAgents would each score one to three higher.
- **A model's critique of itself helps on reasoning, not on arithmetic.**
  Self-Refine (Madaan et al. 2023: answer, critique the answer, revise)
  scores 21 and 21 here, as three-agent debate does, at a little more cost.
  Its critic never once declared an answer free of issues, so every run
  took all three rounds, and the revisions moved as many right answers to
  wrong (3) as wrong to right (4). On MATH level 5 (below) the same loop
  turned 6 first answers right and 2 wrong, and its critic was satisfied in
  7 runs: there the errors are steps of reasoning a second read can catch;
  here they are long products it can only redo, and gets wrong as often.
- **Reading the chains picks what counting them does.** Corex's retriever
  reads five independent chains and picks the most faithful one: 22 and 22,
  the same as self-consistency's vote over five samples, missing the same
  eight questions, at about 1.6 times the cost. Multi-Agent Verification,
  three verifiers (arithmetic, reasoning, the answer) approving or rejecting
  each of the five chains, scores 22 and 22 on the same eight misses, at three
  times the vote's cost. Its approvals show why: on the misses the chains
  disagree (five different answers, typically) and the right one was among
  them in only 1 of 16 cases; the verifiers rejected every chain in 4. On the
  questions answered, the majority was already right every time. Choosing
  among samples cannot add an answer no sample has.
- **One call that simulates a discussion matches a real one.** Solo
  Performance Prompting has one model name the personas a task needs (here a
  mathematician, a "calculator expert" and a critic) and play out their
  discussion in a single response: 20 and 22 in two runs, the same as
  Multiagent Debate's 21 and 21, at a fifth of the cost ($0.05 a run against
  $0.25). On these questions the separate agents add nothing that one model
  imagining them does not.
- **Mixture-of-Agents with three different models: 28 and 27, above its
  best one's 26.5.** (Second runs, added later, for all three: mixed
  28, 27; 3.8-flash alone 26, 27; Self-MoA 26, 26. Run against run, the
  mixture is +2 −0 against 3.8-flash alone, p = 0.5, and +3 −0 against
  Self-MoA, p = 0.25: a consistent small edge, never a significant one.) As its paper intends, the proposers were different
  models (gemini-3.8-flash, gemma, flash-lite, in two layers) and 3.8-flash
  aggregated. It was first reported here as 26, "the same as 3.8-flash
  alone"; three of its four misses were in fact Google 503s with no output.
  Retried in place (Evaluate → Retry), they gave two right answers: 28 of 30,
  for $0.30. Against 3.8-flash alone (26) it fixes two questions and loses
  none (p = 0.5: one run each, not significant). With all slots on flash-lite
  it scored 17. Self-MoA (Li et al. 2025, "Rethinking Mixture-of-Agents")
  claims the best model in every slot beats mixing; with all seven on
  3.8-flash it scored 26 ($0.44, 15 minutes instead of 88), missing exactly
  the four questions 3.8-flash alone misses, and no proposer had the answer
  on any of them. Here, then, the paper's claim does not reproduce: more
  calls to one model change nothing, and the mixture, alone of the two,
  fixes questions the best model cannot, though too few to be sure.
- **DyLAN's team optimization learns the obvious team.** Over one pass of the
  30 questions it accumulated importance (`ctx.state`): Programmer 51,
  Mathematician 49, Skeptic 18, Generalist 8. With `team_size = 2` the later
  questions went to the Programmer and the Mathematician only: 20 of 30
  instead of 22, for 24% less ($0.13 against $0.17). The ranking is the one
  the task calls for (computation); dropping the other two costs a little
  accuracy here, as the paper also finds pruning saves cost first.
- **MacNet's topology matters the way voting does.** A chain refines one
  solution from node to node and scores like one agent (19); a star or a mesh
  merges several independent solutions (22, 21), as voting and exchange do.
  The paper also finds denser topologies ahead of the chain; here the gain is
  the same 2–3 questions the other aggregating systems get, at more cost.
  Its scaling claim does not show at this size: a star of 2, 4 and 8 nodes
  scores 19, 22 and 21, at $0.12, $0.44 and $0.80. As with Agent Forest's
  samples, the gain comes from the first few independent solutions, and every
  size misses the same questions that need computation (#6–10, #26–28).
- **Magentic-One first scored 15**: its ComputerTerminal was a program on
  the server, which an isolated server does not run, so the team multiplied
  by hand and missed all ten products. As a sandboxed agent that only runs
  the coder's code, it solves all 30 for less than half the cost.
- **AgentVerse matches the single agent; AutoAgents falls 6 below it.**
  Both first scored lower for the rebuild's reasons: AgentVerse's result was
  its evaluator's feedback whenever the evaluator stayed unsatisfied, and
  AutoAgents ended with a digital-root check after its answer, which graders
  read instead (AgentVerse 10 → 20 after the fix; AutoAgents's misses moved
  but stayed at 13). What remains is real: AgentVerse's evaluator scores
  wrong products 10/10, and AutoAgents's "quality assurance" agent confirms
  them, so their review steps add calls without catching errors. A reviewer
  that recomputes by hand is no check on arithmetic; one that runs code is.
- **Here, more calls help: about +3 questions in 30.** Every multi-call system
  beats the single agent in both runs. The single agent also moves the most
  between runs (20, then 18), and voting or discussion removes that noise.
- **Discussion adds nothing over voting.** Five independent samples and a vote
  match ReConcile at 60% of the cost, and beat Multiagent Debate, which also
  lost a multiplication (#2) that the single agent had right. This matches the
  exact-computation result above.
- **What they fix, and what nothing fixes.** The multi-call systems recover the
  letter counts (#17, #19, #20) and most date spans (#11, #15), where the
  single agent slips at random. All four miss the digit sums of large powers
  (#6–#10) and the binomial coefficients mod p (#26–#28) in every run. No agent
  can do those in its head, so nobody in the discussion has the right answer to
  spread. A code-execution tool would solve them, which is a test of tools,
  not of the debate.

## Agent Forest: accuracy against the number of samples

"More Agents Is All You Need" (Li et al., 2024) samples one model N times and
takes the majority answer, and reports accuracy rising with N. The template
is one model component with `replicas: "{{vars.n ?? 10}}"` and a vote, so
the sweep is the same system with a different run variable. Hard computation
(30), gemini-3.1-flash-lite, one run per N:

| N (samples) | Correct | Cost | Time |
| --- | --- | --- | --- |
| 1 | 20 | $0.03 | 40 s |
| 3 | 22 | $0.09 | 80 s |
| 5 | 21 | $0.16 | 160 s |
| 10 | **23** | $0.31 | 300 s |
| 20 | 22 | $0.60 | 600 s |

- **The gain comes from the first few samples.** N = 3 reached 22 in this
  run (21 and 20 when run twice more later, so about 21), near where
  ReConcile and self-consistency stand (22.0). Past that the score moves
  by a question either way, which is noise, while the cost doubles each step.
- **The plateau is the questions nobody can do in their head.** Every N
  misses #7–#10 and #26–#28 (digit sums of large powers, binomials mod p), and
  #6 at all but N = 10. Voting removes random slips (#14 and #20 at N = 1); it
  cannot produce an answer no sample has. With a code sandbox, a single agent
  gets all 30 (above).
- **The paper's curve needs room to rise.** Its gains are largest on weaker
  models and on tasks where samples are often right but not reliably. Here a
  single sample is already right on most questions the model can do at all.

The first sweep found a bug in `replicas` itself: the output port's `json`
type (the list) was read as "each reply is JSON", so every sample answered
with a bare number and no reasoning (1 of 30). Each sample now replies as
text, and the component always sends a list.

## A stronger model: no gain either

gemini-3.8-flash alone scores 26 and 27 on Hard computation (two runs),
with room for 3–4 more. Multiagent Debate on it, every debater on
3.8-flash, two runs: 26 and 26, against one agent +0 −1 (p = 1), at $0.62
for both runs. All eight misses checked with the judge. The diverse
debate (three reasoning methods), the best three-debater setting on
flash-lite, does no better on 3.8-flash: 27 and 27, +3 −2 against one
agent (p = 1), at $1.01. So across three models debate helps only the
middle one: flash-lite gains about 2 in 30, gemma (weaker) and 3.8-flash
(stronger) nothing, with or without different methods.

## A cascade: FrugalGPT

FrugalGPT (Chen et al. 2023) answers with a cheap model first, has a scorer
judge the answer, and sends only doubtful questions to a dear model; it
reports the best model's accuracy at a small part of its cost. Hard
computation, flash-lite answering and scoring, 3.8-flash for the doubtful
ones (threshold 8 of 10), two runs:

| System | Correct (two runs) | Cost per run |
| --- | --- | --- |
| flash-lite alone | 20, 18 | $0.025 |
| 3.8-flash alone | 26, 27 | $0.033 |
| Cascade: flash-lite, scored by flash-lite, else 3.8-flash | 22, 21 | $0.054 |

- **The cascade is worse and dearer than the strong model alone** (+0 −10
  against 3.8-flash, p 0.002). Its scorer accepted 39 cheap answers, 10 of
  them wrong: a model checking its own long arithmetic cannot tell right
  from wrong, as Multi-Agent Verification's verifiers could not. And the
  price gap here is only two to one, where the paper's was tens to one;
  the scoring call alone costs more than the strong model saves. A cascade
  needs a scorer that knows when the cheap model is wrong, and a gap worth
  saving. Misses checked with the judge.

## A weaker model: no gain from discussion after all

The papers report their gains with gpt-3.5-class models; on
gemini-3.1-flash-lite, a single agent already gets most questions it can get
at all. gemma-4-26b-a4b-it (an open model, about 4B active parameters, free
tier: 10 calls a minute here, 30 minutes per run) is weaker, and thinks at
length. Hard computation (30), one run each:

| System on gemma | Correct | vs single agent | Time |
| --- | --- | --- | --- |
| Single agent | 27, 24 | | 48 min |
| Agent Forest, N = 5 (vote) | 25, 26 | +2 −2 over both runs | 92 min |
| Multiagent Debate, 2 rounds | 26, 25 | +1 −1 over both runs | 116 min |
| ReConcile, 3 rounds | 26, 27 | +4 −2 over both runs | 112 min |
| Solo Performance Prompting (one call, simulated personas) | 25, 24 | +1 −3 over both runs | 77 min |
| Single agent with a code runner | **30** | +3 −0 (p 0.25) | 8.5 min |

**No system without a tool does better than one gemma agent.** This section
first reported the opposite, as the platform's first large gain from
discussion: the single agent at 17, then 18, and debate +8 above it
(p = 0.02), voting, ReConcile and SPP +7 to +8. That came from the log, not
the systems. The run log kept only the first 20,000 characters of an
output, and gemma, thinking at length, wrote its answer after the cut on 13
of the 30 questions; the grader then read a number from the middle of the
reasoning, and 12 of the 13 were marked wrong (one was marked right by
luck: "157 (mod 10) is not r…" before the cut). The multi-agent systems
were not affected: their answers come from a short vote or judge message.
The log now keeps the end of a long output, and those cases were run again
in place (Retry): 27, missing two digit sums and a long product (#7, #8,
#10), which every system without a tool misses too. On #8 and #10 gemma at
first streamed for about 11 minutes and returned nothing; an empty reply is
now asked for once more, and the single agent then answered both (wrongly).
SPP's prompt gets an empty reply on both every time, so its 25 counts them
as misses.

Second runs of the single agent and the debate, added later: 24 and 25,
so 25.5 each over two runs, +1 −1 run against run. Three of the single
agent's six misses in its second run were gemma thinking past the
provider's own output limit and leaving no answer (as some debaters' calls
did on the same questions); they count as misses. The voting, ReConcile
and SPP rows got their second runs later still (26, 27 and 24): over two
runs each, one agent 25.5, debate 25.5, voting 25.5, ReConcile 26.5, SPP
24.5, none significantly different from one agent.

So on gemma, as on flash-lite, voting, debate, ReConcile and one model
playing all the personas score as one agent does or a question or two
below, at two to three times the time; the questions none of them get are
exact computations no amount of discussion fixes, and one agent that can
run code solves all 30 in a sixth of the time. Found by checking the
misses with the judge (Evaluate → Check misses with the judge), which
flagged a cut output graded wrong.

On GSM8K gemma is near the ceiling: a single agent scores 96/100 (95 until
its cut outputs were run again).

## MATH-500: a first sample

MATH-500 (competition math, five levels) leaves room even for a strong
model. 50 problems (seed 1), gemini-3.1-flash-lite, one run each, graded by
the math grader:

| System | Correct | Cost |
| --- | --- | --- |
| Single agent | 46 | $0.04 |
| Agent Forest, N = 5 | 46 | $0.21 |
| Multiagent Debate, 2 rounds | 47 | $0.31 |

Later, with code (the same 50, answer lines checked):

| System | Correct | vs single agent (45 this time) | Cost |
| --- | --- | --- | --- |
| Single agent with a code runner | **48** | +3 −0 (p 0.25) | $0.29 |
| Magentic-One (sandboxed terminal) | 46 | +2 −1 | $0.29 |
| Multiagent Debate, each debater with its own sandbox | 49 | +4 −0 | $1.14 |

Running code fixed three problems no text-only system got (#8, #13, #34)
and lost none: the best score on this sample, though three problems is not
yet significant. On 50 more problems (seed 2): single 47, with code 49
(+2 −0). Over the 100, code fixes 5 and loses none (p ≈ 0.06): a small but
consistent edge, just short of significance. (Seed 2 was first graded 45
and 46, +3 −2: the grader marked right answers wrong, a unit with a power,
a base subscript, a lettered choice, a sum in another order inside a
fraction; found by checking the misses with the judge.) MATH's problems are mostly reasoning
with short arithmetic, so a code runner matters far less than on Hard
computation's long exact chains. Magentic-One's orchestration added nothing over one agent
with the same sandbox, as AutoGen's five agents did on Hard computation.
Neither did discussion: Multiagent Debate with a sandbox for each debater
(a system built for this comparison, not a template) scored 49 against one
agent with a sandbox's 48, one problem more and none fewer (p = 1), at four
times the cost. Once the single agent has the same tool, three debaters
exchanging answers fix almost nothing it does not.

At about 92%, neither voting nor debate gains more than a question in 50.
(All MATH-500 scores here were regraded on 2026-11-19 after a grader fix:
every system had answered problem #10 as `3 < \lambda \le 4`, which the
key writes `(3,4]`, and been marked wrong; each seed-1 score rose by one,
no comparison changed.)
The misses are mostly wrong answers that every system gives
(`2\sqrt{61}` for `2\sqrt{113}`), which is the same plateau as on Hard
computation.

**The grader needed a second check.** It passed MATH-500's own worked
solutions 500 of 500, but those write answers the way the answer key does.
Models do not: `4/3` for `\frac43`, `3\sqrt{3}/4`, `1+\sqrt{19}, 1-\sqrt{19}`
for `1 \pm \sqrt{19}`, `270/7` for `\frac{270}7\text{ degrees}`. Graded the
first time, every system scored 38–39; about 7 right answers per run were
marked wrong. The grader now reads `a/b` as a fraction, expands `\pm`,
compares lists in any order and drops a trailing unit, and still passes the
500 reference solutions and refuses mismatched answers (3 of 500 pairs pass,
all truly equal). A grader is checked against what models write, not only
against the answer key's own forms.

## MATH level 5: condition mining (MACM)

MATH-500's general sample leaves little room (about 92%), so a set of its
134 level-5 problems (the hardest; built from the same file,
`benchmarks/math-500/test.jsonl`), 50 of them (seed 1), flash-lite, math
grader:

| System | Correct | vs single agent | Cost |
| --- | --- | --- | --- |
| Single agent | 40 | | $0.05 |
| MACM (Thinker, Judge, Executor; up to 4 mining rounds) | 43 | +4 −1 (p 0.38) | $0.25 |
| Multiagent Debate, 2 rounds | 44 | | $0.39 |
| Agent Forest, 5 samples | **45** | | $0.26 |
| Single agent with a code runner | **45** | +6 −1 (p 0.13) | $0.39 |
| Self-Refine (critique and revise, up to 3 rounds) | 44 | +5 −1 (p 0.22) | $0.43 |
| Multiagent Debate, three different reasoning methods | 45 | +5 −0 (p 0.06) | $0.47 |

MACM (Lei et al. 2024) has a Thinker list the conditions and the objective
and mine new conditions one at a time, a Judge keep only those it verifies
and say when they suffice, and an Executor carry out the Thinker's plan
(here a function calling the three roles with `ctx.call`). It scores between
one agent and the voters, at a vote's cost; against Agent Forest it fixes 1
and loses 3. Its Judge declared the conditions sufficient after one mined
condition in 43 of the 50 problems (2 rounds in 5, 3 or 4 in 2), so in
practice it was plan-then-execute with one verified step, not the long
mining the paper describes. The paper's gains were with GPT-4 and a code
executor and over plain chain of thought; against a vote over five samples
at the same cost there is none here. Self-Refine, one model critiquing and
revising its own answer, scores 44 (+5 −1 against one agent), its revisions
turning 6 first answers right and 2 wrong. A code runner does as well as the
best of them (45: +6 −1 against one agent, and 2 fixed, 2 lost against
Agent Forest): even on the hardest problems, MATH's errors are mostly
reasoning, which code and voting fix about equally.

Two notes on measuring it. Every call to a role is a turn, and the
template's first limit (10) cut two runs short; at 40 they gave two right
answers (retried in place). And the first grading marked right answers
wrong on this set (`3 < \lambda \le 4` for `(3,4]`, a vector in decimals,
a set in braces) for every system; the grader was fixed and all MATH
evaluations regraded, with no model calls.

## Long input: Chain-of-Agents on ledger totals

Chain-of-Agents (Zhang et al. 2024) claims that for inputs too long to read
well at once, workers reading parts in turn and passing a note along do
better than one model reading everything. A generated set
(`benchmarks/ledger/build.py`, no download): 20 ledgers of about 700
transactions (~44,000 characters), each asking the total one customer paid
over 8 to 14 orders scattered among look-alike names (Harlow, Harlowe,
Marlow). Answers are computed by the generator and checked against the
text; graded by number; flash-lite, two runs each:

| System | Correct (of 20, two runs) | vs one agent, 40 pairs | Cost |
| --- | --- | --- | --- |
| One agent, reading the whole ledger | 9, 9 | | $0.24 |
| Five such readings and a vote (Agent Forest, N = 5) | 7, 6 | +2 −7 (p 0.18) | $1.26 |
| Chain-of-Agents (parts of 3,000 characters, ~15 per ledger) | 13, 15 | **+14 −4 (p 0.03)** | $0.73 |
| LongAgent (members read parts of 6,000 characters at once; a leader adds up their reports) | 14, 13 | +11 −2 (p 0.02) | $0.27 |
| One agent with a code runner, pasting the ledger into its program | 16, 18 | +17 −1 | $4.59 |
| One agent with a code runner, reading the ledger from `/work/input.txt` | **20, 19** | +21 −0 | $1.71 |

- **The paper's claim reproduces.** Reading in parts beats reading whole,
  significantly, at three times the cost: the first gain here from
  splitting work among agents on something other than arithmetic.
- **The two fail in opposite directions.** One agent's misses are almost
  all too low (16 of 22): it skips orders buried in the long text. The
  chain's are almost all too high (10 of 12): reading each part closely, it
  picks up a look-alike customer or counts an order twice as the note is
  rewritten. Each misses what its way of reading makes easy to miss.
- **Reading more times does not help; reading in parts does.** A vote
  over five whole readings scores 6.5, below one reading's 9, and the
  chain beats it +18 −3 (p 0.001). Each reading skips different orders, so
  the five totals mostly all differ and the most common is no likelier to
  be right: voting fixes errors only where the right answer is the one
  most often given, as on Hard computation, not where every attempt goes
  wrong its own way.
- **Reading the parts at once does as well as relaying a note, for less.**
  LongAgent (Zhao et al. 2024) has members read the parts in parallel and
  quote what bears on the question, and a leader add up their reports:
  13.5 of 20 against the chain's 14.5 at the same part size (+4 −6, p
  0.75), at $0.27 against $0.61, since no member carries a growing note.
  It does not remove the over-counting the chain showed: its misses are
  as often too high (7) as too low (6), members quoting a look-alike name
  and the leader adding it in.
- **Splitting helps to gather, not to find.** The same 20 ledgers, each
  asked instead what one order (from the middle half) paid: a single line
  in 44,000 characters (`benchmarks/ledger/build_lookup.py`). One agent
  reading the whole ledger finds it 40 of 40, LongAgent 40 of 40,
  Chain-of-Agents 39 of 40, at about the cost of their totals runs. At
  four times the length (2,800 transactions, ~175,000 characters, ~45,000
  tokens; `build_lookup_long.py`) one agent still finds 40 of 40 ($0.86),
  and LongAgent 40 of 40 ($0.91). Long input alone does not defeat this
  model at these lengths; what it misses is evidence spread over many
  lines, which reading in parts gathers. (Grading the chain's
  answers found a grader bug: it skipped numbers "given in the question",
  and took the whole ledger for the question, so "Order 12529 paid $801."
  was read as 12529. Only the text before the `---` line counts now.)
- **Parts of a middle size do best.** The paper varies the length each
  worker reads; so did this (`chunk_chars`, two runs each): 3,000
  characters (~15 parts) 14.0, 6,000 (~8 parts) 14.5, 12,000 (~4 parts)
  10.0, against one agent's 9 reading all 44,000 at once. Doubling the
  part trades some over-counting for some under-counting (misses too
  high 10 → 7, too low 2 → 4) and costs less ($0.73 → $0.61); at 12,000
  the parts are long enough to read carelessly again, and misses rise both
  ways (9 too low, 11 too high), toward the single reader's. Misses checked
  with the judge.
- **Code does best, once it can read the input.** One agent with a code
  runner first totalled 17 of 20 by pasting each ledger into its program,
  at six times the chain's cost: every answer wrote the ~21,000-token
  ledger out again (and its very first run answered nothing, the output
  limit, then 16,384 tokens, cutting every program off mid-call). The
  sandbox now holds the run's input as `/work/input.txt`, and an agent is
  told so with its turn (a note in the tool's description was ignored 27
  times of 27). Reading the file, it totals 39 of 40 (+12 −1 against the
  chain, p 0.003) with a median of 677 output tokens a run, at $1.71: still
  twice the chain's cost, because the long input goes with each of its few
  tool turns, but the most accurate by far.
- All misses checked with the judge (it agreed on all 40); no answer was
  unknown.

## MMLU: single agent vs Multiagent Debate

Du et al. report MMLU going from 63.9 to 71.1 with debate (gpt-3.5). Here:
100 questions sampled from the 500-question MMLU sample (seed 1), all on
gemini-3.1-flash-lite, graded by the letter.

| System | Runs | Mean | Cost per run |
| --- | --- | --- | --- |
| Single agent | 92, 96, 97 | 95.0 | $0.03 |
| Multiagent Debate, 2 rounds | 96, 95 | 95.5 | $0.28 |

**No gain on this model.** The first pair of runs looked like one (92 → 96,
four questions fixed, none lost), but the single agent's next two runs scored
96 and 97. On one run each, the Compare page gave that first gap p = 0.13
(McNemar on the 4 changed questions): not enough to call it, and the repeats
confirmed as much. Both systems miss the same few questions (#48, #74, #96;
on #96 the debaters agreed on "A, B, C, and D" for a one-letter question). At
95% there is little left for discussion to fix, as with GSM8K; the paper's
setting is a model that gets a third of MMLU wrong.

On gemma-4-26b, the weaker model, the same 100 questions:

| System on gemma | Correct (two runs) | Mean | Time per run |
| --- | --- | --- | --- |
| Single agent | 90, 89 | 89.5 | 21 min |
| Multiagent Debate, 2 rounds | 89, 91 | 90.0 | 62 min |

Over both runs (200 question-run pairs) debate fixed 4 and lost 3 (McNemar
p = 1). **Even on the weaker
model, MMLU shows no gain**, as Hard computation does not either (see above:
the gain once reported there came from cut-off answers). gemma already gets
90% of these questions, and its errors are knowledge errors (which of four
facts is right), which three copies of the same model share.

## MedAgents on MMLU's medical questions

MedAgents (Tang et al.) evaluates on medical multiple choice. The 75 questions
of the MMLU sample in medicine and biology (dataset "MMLU · medical (75)"),
on gemini-3.1-flash-lite, one run each:

| System | Correct | vs single agent | Cost |
| --- | --- | --- | --- |
| Single agent | 71 | | $0.02 |
| Multiagent Debate | 73 | +2 −0 (p 0.5) | $0.21 |
| MedAgents (specialists, report, voted consultation) | 73 | +2 −0 (p 0.5) | $0.21 |
| Solo Performance Prompting (one call, simulated personas; two runs) | 73, 73 | +2 −0 | $0.05 |

Both fixed the same two questions (#17 and #50) and missed the same two
(#20 and #25): a panel of named specialists does what three plain debaters
do, at the same cost. One model imagining the panel in a single call (Solo
Performance Prompting) scored the same 73 in two runs, missing the same two
questions, at a quarter of the cost. Two questions in 75 is within run-to-run noise.

The first MedAgents evaluation graded 0 of 57: its decision maker gave the
option first and a sentence of why last, and graders read the last line.
The template now ends with "Answer: X", and the Evaluate page groups such
failures as "a sentence, not an answer" instead of "wrong answer".

## GSM-Hard: does running code help?

GSM-Hard replaces GSM8K's numbers with large ones, to test computing over
reasoning in text. 50 questions (seed 1), flash-lite, every answer checked
for an answer line:

| System | All 50 | The 41 well-posed | Cost |
| --- | --- | --- | --- |
| Single agent | 38 | 38 | $0.02 |
| Single agent with code | 38 | 38 | $0.21 |
| Magentic-One (sandboxed terminal) | 39 | 39 | $0.14 |
| Multiagent Debate | 36 | 36 | $0.18 |

**All nine questions every system missed are broken.** The numbers were
swapped in mechanically, so the keys can be nonsense: the "change" from a
$1,956,511 bill is −1,173,896.6; doing 4 million of 100 problems leaves
−13,394,694; Joe with $50 is left with −$1,895,420; a key of 289,934,000
does not follow from its question. The models answer what the question
sensibly means and cannot match them. On the 41 well-posed questions every
system is within 3 of all of them, and code changes nothing: these are long
multiplications a model gets right in one or two steps, unlike Hard
computation's chains of exact arithmetic. Scores on GSM-Hard measure its
answer key as much as the systems; a cleaned subset would be needed to
compare them.

## HumanEval: five coding systems

50 problems sampled from HumanEval (seed 1), all on gemini-3.1-flash-lite,
graded by running each answer against the problem's tests in Docker.

| System | Passed (two runs) | Mean | Cost per run |
| --- | --- | --- | --- |
| Single agent | 48, 47 | 47.5 | $0.03 |
| Single agent with a code runner | 49, 48 | **48.5** | $0.17 |
| AgentCoder (programmer, test designer, executor) | 48, 48 | 48.0 | $0.58 |
| MapCoder (one plan, up to 5 debugging rounds) | 48 | 48.0 | $0.37 |
| MapCoder as in the paper (3 plans tried best first, 5 rounds each) | 48 | 48.0 | $0.37 |
| Reflexion (test, reflect, retry) | 48, 48 | 48.0 | $0.36 |

(The second runs were added later, so that no comparison here rests on a
single run; the two MapCoder rows are two runs of the same system.)

All five miss #47 (HumanEval/145, sorting by digit sum with negative
numbers); the others differ by one problem each, which is noise. Reflexion
(91% on HumanEval in its paper, with gpt-4) misses the same #8 and #47 as
AgentCoder. AgentCoder
and MapCoder report large gains over a single gpt-3.5 call (to 79.9% and
80.5%); on a model that already passes 96% of these problems alone there is
nothing for a test-and-repair loop to repair, and they cost 12 to 28 times
as much.

MapCoder with its plan search (`iterate.over`, three plans, best first)
never once tried a second plan: on 44 problems the first plan's code passed
the debugger's tests in round 1, on 4 after one or two repairs. The two it
missed (#8 and #47) passed the debugger's own tests too, and failed the
hidden ones. A search over plans can only act on failures the agents' own
tests catch; here every wrong answer looked right to them, so the paper's
k × t search costs nothing extra and changes nothing. What would help is
better tests (AgentCoder's test designer aims at that), not more plans.

The first grading had every system at 46–47: the grader copied an `import
math` from inside HumanEval/115's function, and a docstring line starting
"from any cell" from /129, to the top of the program, so right answers
failed. Both were the grader's, found because every system failed the same
two problems. After the fix, "Run the tests again" re-graded the stored
answers in Docker without calling any model.

## Multiagent Debate: accuracy against the number of debaters

Du et al. report accuracy rising with the number of agents as well as of
rounds. Hard computation (30), flash-lite, 2 rounds, two runs each (the
debate template's builder takes the number of debaters, `debateWith(n)`):

| Debaters | Correct (two runs) | Mean | vs one agent, over 60 (question, run) pairs | Cost |
| --- | --- | --- | --- | --- |
| 1 (single agent) | 20, 18 | 19.0 | | $0.05 |
| 2 | 20, 20 | 20.0 | +7 −5 (p 0.77) | $0.27 |
| 3 (the template) | 21, 21 | 21.0 | +6 −2 (p 0.29) | $0.50 |
| 5 | 23, 22 | **22.5** | +8 −1 (**p 0.04**) | $0.85 |
| 5, in a ring (each reads its own and its two neighbours' answers) | 22, 22 | 22.0 | +7 −1 (p 0.07) | $1.07 |
| 3, all told to reason step by step | 21, 22 | 21.5 | +7 −2 (p 0.18) | $0.58 |
| 3, each a different method (step by step, decompose, check another way) | 23, 23 | **23.0** | +9 −1 (**p 0.02**) | $0.60 |
| the same three, one round: a vote over their first answers, no exchange | 22, 22 | 22.0 | +7 −1 (p 0.07) | $0.24 |
| a plain three-sample vote (Agent Forest, N = 3), for comparison | 21, 20 | 20.5 | +5 −2 (p 0.45) | $0.19 |

- **The paper's agent curve reproduces.** Each debater added helps a
  little, and five are the first setting on this set where debate beats one
  agent significantly. Two are no better than one: with two, a disagreement
  has no majority to settle it.
- **It costs what it buys.** Five debaters cost 17 times one agent for 3.5
  questions in 30; a five-sample vote (self-consistency, 22.0 over two runs
  on the same questions, $0.31) comes within half a question at about a
  third of the cost. The gain is real; it is not cheap.
- **Sparse communication keeps the accuracy; its saving is small.** Li et
  al. (2024) report that debaters reading only their neighbours do as well
  as a full exchange, for less. In a ring of five (`debateWith(5, "ring")`)
  each debater reads three answers instead of five: 22 and 22, one question
  below the full exchange (0 fixed, 1 lost). Its round-2 input fell by a
  third as designed (median 2,605 tokens a call against 3,892), worth about
  $0.10 of the $0.85, since output costs six times input here; and three
  runaway replies in this run (9,850, 46,848 and 65,538 tokens, the last at
  the output limit) cost more than that, so it came out at $1.07. The saving
  is real, and smaller than one run's noise in output length.
- **Different methods help more than more debaters.** "Breaking Mental
  Set" (Liu et al. 2025) argues that debaters who think alike share blind
  spots, and gives each a different way of reasoning. Three debaters told
  to reason step by step, to decompose, and to check the answer another way
  (`debateWith(3, "full", true)`) score 23 and 23: above five plain
  debaters, at 70% of their cost, and significant against one agent. The
  control matters: three debaters all told to reason step by step are each
  right far more often in round 1 than plain ones (41 of 60 against 35),
  yet finish at 21.5, as plain debate does: the exchange was already fixing
  those slips. With the same individual accuracy (43, 44, 40 in round 1),
  the diverse three finish 1.5 higher: +3 −0 against the same-method
  control (p 0.25), suggestive rather than proven, but the only
  three-debater setting here that beats one agent significantly. On MATH
  level 5 the same three score 45 of 50, one above plain debate (+2 −1)
  and level with a five-sample vote and a code runner: where errors are in
  reasoning rather than long arithmetic, different methods tie the best,
  not beat it. Without the exchange (`rounds = 1`, a vote over the three
  diverse first answers) they score 22 and 22 at 40% of the cost: the
  exchange adds one question (+2 −0, p 0.5). A plain three-sample vote
  ("think step by step", Agent Forest with N = 3) scores 21 and 20 on the
  same questions (its single earlier run, 22, was high): so with three
  agents, different methods add 1.5 over the plain vote (+3 −0, p 0.25)
  and the exchange one more. Each step is small and none alone is
  significant; together, plain vote 20.5 → diverse vote 22 → diverse
  debate 23.
- All misses of the six debate evaluations were checked with the judge
  (it agreed with the grader on all 100), and no output was cut.

## Multiagent Debate: accuracy against the number of rounds

Du et al.'s ablation varies the rounds of debate. The template's group takes
its round limit from the run variable `rounds` (`max_rounds: "{{vars.rounds
?? 2}}"`), so this is one system with four settings. Hard computation (30),
gemini-3.1-flash-lite, three debaters, one run per setting:

| Rounds | Correct | Cost | Time |
| --- | --- | --- | --- |
| 1 (three answers and a vote, no exchange) | 19 | $0.18 | 190 s |
| 2 (one exchange) | **23** | $0.22 | 150 s |
| 3 | 22 | $0.41 | 290 s |
| 4 | 22 | $0.64 | 360 s |

- **One exchange brings the whole gain.** Round 1 is three independent answers
  and a vote, and scores like a single agent (19). After the debaters read
  each other once, the score reaches 23, the best of any system without a
  tool on this set. More rounds hold it at 22, at up to three times the cost.
- **The same plateau as Agent Forest, at the same place.** Every setting
  misses #6–#8, #10 and #26–#28, the questions that need computation. The
  paper reports gains up to about four rounds on arithmetic, with weaker models;
  here the debaters agree after one exchange.
- **The Rounds tab shows it per run.** A round's value is the three answers,
  and from round 2 on they are usually the same.

## AutoGen with a code executor: 30/30

The four systems above all miss the digit sums of powers and the binomial
coefficients in every run. Those are questions that need computation, not
discussion. AutoGen (Wu et al.) has a user proxy that runs every code block in a
sandbox (here Docker, `python:3.12`, no network). Same 30 questions, all on
gemini-3.1-flash-lite, two runs each:

| AutoGen version | Runs | Cost (60 runs) |
| --- | --- | --- |
| First run | 25, 25 | $0.12 |
| After three fixes (below) | **30, 30** | $0.12 |

For comparison, the best system without a tool averaged 22.0, and the single
agent 19.0. AutoGen costs about a quarter of what ReConcile does here, because
the code does the work that the models otherwise get wrong.

Nine of the first run's ten misses were not the model's fault:

- **The critic overrode the code.** On C(47, 14) mod 997, the code printed
  165, which is right. The critic redid the sum by hand, got 800, and ended
  the chat with it. The template's critic now treats the executor's output as
  fact and asks for a check in code when it doubts it.
- **The manager handed the turn to the person** who opened the chat (4
  cases). An unattended evaluation cannot answer. The platform's selector now
  chooses only among agents; a person speaks when @named.
- **The manager named no one** (5 cases). The run ended with no output,
  although the last message had the answer. A room where nobody is next now
  ends like TERMINATE, with its last message as the answer, which is what
  AutoGen's group chat returns.

The grader also took AutoGen's trailing "TERMINATE" for the final answer. It
skips it now.

### Is it the team or the tool?

A single agent with the same Python sandbox (the "Single agent with code"
baseline) on the same 30 questions and model, two runs:

| System | Runs | Cost (60 runs) | Time |
| --- | --- | --- | --- |
| Single agent with code | **30, 30** | $0.10 | 5 min |
| AutoGen (planner, coder, critic, executor, manager) | 30, 30 | $0.12 | 8.5 min |

On these questions the tool does all the work. AutoGen's four agents and
manager add nothing over one agent that can run code, and they take longer. A
fair test of AutoGen's conversation needs tasks a single agent with a tool
cannot finish: longer programs, several files, fixing failing tests.

This is the clearest result so far. How the agents talk matters less than
whether one of them can run code, and the right baseline for a system with
tools is a single agent with the same tools.

### With a user proxy that has no model

AutoGen's UserProxyAgent runs code without a model call; here it was a small
model with the sandbox's bash until rooms could seat functions. As a function
in the room (it runs each python block it sees, and stays silent otherwise),
AutoGen scored 28 of 30 on Hard computation at $0.024, a fifth of the
$0.12 with the small model. Its two misses (#19, #20, counting letters) are
not arithmetic: the coder retyped the sentence into its code with different
words, and the code counted the wrong text correctly. Running code fixes
computing, not copying.

## Coding: five systems on 31 problems

Two sets written for this (`benchmarks/mas-code/`, no download): 19
function-level problems, and 12 harder ones with exact specs, performance
limits and forbidden shortcuts that the tests enforce. Each problem is in
HumanEval form, and each has a reference solution that passes its tests in
the grader's Docker sandbox. The grader is "Code: run the tests". All on
gemini-3.1-flash-lite, two runs each:

| System | 19 problems (of 38) | 12 hard (of 24) | Cost, both sets |
| --- | --- | --- | --- |
| Single agent | 36 | 20 | $0.05 |
| Single agent with code | 37 | 22 | $0.27 |
| AutoGen (Wu et al.) | 37 | 21 | $0.26 |
| AgentCoder (Huang et al.) | **38** | 22 | $1.00 |
| MapCoder (Islam et al.) | 37 | 21 | $0.80 |

- **On problems of this size, every system is within noise of the others.**
  The best system (AgentCoder, 60 of 62) gains one problem over a single
  agent with code (59), and four over a single agent without it (56), at
  about four times the cost of the agent with code. AgentCoder's separately written
  tests are the only mechanism that shows any edge: it caught the
  edit-script ordering bug that most single attempts got wrong.
- **The hard set separates a little, by edge cases, not algorithms.** Most
  misses are in a few problems. An edit script applied in the wrong order
  breaks on "" → "abc". Regex matching without memoisation times out. The
  JSON parser has syntax errors. These are the failures a test-and-fix loop
  is meant to catch, and it catches some of them.
- **ChatDev and MetaGPT cannot be graded this way.** Both build a
  multi-file project in their workspace and end with a report on it ("The
  environment is now set up, and I have verified the integration of
  `engine.py`…"), not with the function a test can run: ChatDev failed 6 of
  6 hard problems on syntax and imports, none of them a wrong algorithm, and MetaGPT 2 of 2 the same way (its last message: TERMINATE and a report on the files).
  Their papers evaluate whole programs (requirements to a runnable
  project); comparing them needs that kind of task, not HumanEval-form
  functions, and changing what they deliver would no longer be them.
- **What the paper systems claim needs harder tasks.** The papers report their
  gains on competition problems and on weaker models. Here a single attempt
  already passes 90–95%, so there is little left to gain.

Getting here took four fixes to the rebuilt systems, each found by grouping a
run's failures by reason (the Evaluate page now does this):

| System | What went wrong | Fix |
| --- | --- | --- |
| AgentCoder | Returned "ALL TESTS PASSED" instead of the code (0 of 3 in a trial) | The executor ends every report with the current code |
| AutoGen | The critic returned what the code printed, not the code | The critic answers with the code when the task asks for code |
| MapCoder | The coder never saw the problem, only the plan, and used the recalled LeetCode function names (5 of 38) | Functions can read the run's input (`ctx.run_input`); the plan edge carries the problem |
| MapCoder, AgentCoder, Reflexion | The sandbox had no pytest and no network, so the tests never passed and every loop used all its rounds | `run_tests` runs plain-assert tests without pytest; templates write such tests |

MapCoder went from 5 of 38 to 37 of 38 on the 19 problems, and its cost fell
from $0.86 to $0.39, because its debug loop now stops when the tests pass.

## GSM8K: single agent vs Multiagent Debate (Du et al.)

The 100-problem GSM8K sample (`benchmarks/gsm8k/`, saved as the dataset
"GSM8K test · 100"), one run each, everything on gemini-3.1-flash-lite, graded
by Number:

| System | Score | Cost | Time |
| --- | --- | --- | --- |
| Single agent | 97/100 | $0.02 | 1.5 min |
| Multiagent debate (3 agents, 2 rounds) | 98/100 | $0.26 | 10 min |

The paper reports 77.0 → 85.0 with gpt-3.5-turbo. With this model, the single
agent is already at 97, so there is no room for an 8-point gain. One question
in 100 is noise, at about 12 times the cost.

| Question | Single | Debate | What happened |
| --- | --- | --- | --- |
| #4 | ✗ | ✓ | the single agent read "sell all his toys" as all the lego sets too, and answered 0 |
| #8 | ✗ | ✓ | ambiguous: the expected 36 takes 10% off the time; the model divided by 1.1 (36.36) |
| #47 | ✓ | ✗ | the debate settled on a wrong commission ($900 for $450) |
| #76 | ✗ | ✗ | the question says "8:00 AM until 11:00 PM" (15 hours, 1800); the expected 360 is 8 to 11 AM. A label error in GSM8K: both answers follow the text |

The first grading marked both systems wrong on #22 and #58. They answered
"33%" and "40%", and GSM8K writes those answers as 33 and 40. The Number grader
read "40%" as 0.4. It now accepts a percentage in either form, and both
evaluations were regraded without calling a model again.

To show the paper's effect, the next step is a weaker model, or harder
problems (GSM-Hard, MATH), where the single agent leaves room.

## Debate or vote? What the rounds add

"Debate or Vote" (Choi et al. 2025) argues that majority voting accounts for
most of what multi-agent debate gains, and that the exchange rounds add
little. Every stored debate run keeps each debater's answer in each round,
so the claim can be checked without new model calls: vote over the
debaters' *first-round* answers (the same samples, before any exchange) and
compare with the debate's final answer on the same question.

| Debate evaluation | Cases | Vote on round 1 | Debate's final | Rounds turned the vote wrong → right / right → wrong | Debater accuracy by round |
|---|---|---|---|---|---|
| Hard computation, gemma, 2 rounds | 30 | **26** | **26** | 0 / 0 | 87% → 87% |
| Hard computation, flash-lite, 2 rounds (two runs) | 60 | 42 | 42 | 1 / 1 | 61% → 72% |
| Hard computation, flash-lite, rounds sweep 2, 3, 4 | 90 | 58 | 67 | 9 / 0 | 60% → 74% (→ 73%) |
| Exact computation, flash-lite (three runs) | 90 | 75 | 79 | 4 / 0 | 81% → 87% |
| MATH-500 (50), flash-lite | 50 | 46 | 47 | 1 / 0 | 91% → 95% |
| MATH-500 level 5 (50), flash-lite | 50 | 42 | 44 | 2 / 0 | 79% → 87% |
| GSM8K (100), flash-lite | 100 | 96 | 98 | 2 / 0 | 97% → 98% |
| GSM-Hard (50), flash-lite | 50 | 37 | 36 | 1 / 2 | 71% → 71% |
| MMLU (100), flash-lite, two runs | 200 | 191 | 191 | 1 / 1 | 95% → 95–96% |
| MMLU (100), gemma | 100 | **92** | **89** | 1 / 4 | 91% → 89% |
| MMLU medical (75), flash-lite | 75 | 72 | 73 | 1 / 0 | 95% → 97% |

- **On the weaker model the rounds change nothing.** On gemma the three
  debaters' first answers, counted, already give the debate's 26, and two
  rounds of reading each other change no verdict; and neither beats one
  gemma agent (27; first reported as 18, a log that cut its answers off).
  On gemma there is no gain for the vote or the exchange to explain.
- **On flash-lite the rounds do the work.** There the first-round vote is
  where one agent is (18–20 of 30 on hard computation, against one agent's
  19), and the exchange lifts each debater from about 60% to 74%: nine
  verdicts turned right and none wrong over the rounds sweep. The exchange
  helps where the debaters' slips differ and each can check the others'
  arithmetic, and only in the first exchange (73–74% after round 2, 3 or 4).
- **Where the model knows the answer or not (MMLU), rounds only add risk.**
  On gemma's MMLU they turned four right verdicts wrong for one fixed: a
  debater talked into a wrong option by two others.
- Over all nineteen debate evaluations the rounds turned 22 wrong votes
  right and 8 right ones wrong (p ≈ 0.02): a real but small effect, almost
  all of it on long computation with the stronger model. Measured by
  `scripts/debate-rounds.mts` over the stored runs.

## Self-correction without feedback: what the second look changes

"Large Language Models Cannot Self-Correct Reasoning Yet" (Huang et al., ICLR
2024) asks a model to review its answer and find problems, then to improve
it, with no feedback from outside, and finds the answers get worse: GPT-4 on
GSM8K 95.5, then 91.5 and 89.0 after one and two rounds. The template
"Intrinsic self-correction" uses the paper's prompts, two rounds, five calls,
and logs each round's boxed answer, so one run gives the first answer and the
corrected ones on the same question.

| flash-lite, two runs each | First answer | After round 1 | After round 2 | Right → wrong | Wrong → right | Cost per run |
|---|---|---|---|---|---|---|
| GSM-Hard (50) | 38, 37 | 37, 34 | 35, 35 | 5 | 0 | $0.20 |
| Hard computation (30) | 19, 21 | 22, 22 | 21, 21 | 2 | 4 | $0.25 |

- **On GSM-Hard the paper's finding holds in direction.** Every changed
  verdict went from right to wrong (5 to 0, p 0.06 over two runs): reviewing,
  the model talked itself out of answers the key agrees with.
- **On Hard computation it does not.** Two rounds turned 4 wrong answers right
  and 2 right answers wrong: no difference beyond noise.
- **Most answers never change.** In 74 of 100 GSM-Hard runs and 42 of 60 Hard
  computation runs the answer is the same in all three rounds. A second look by
  the same model, with nothing new to go on, mostly agrees with itself.
- **Self-Refine's gain on word sorting is not a contradiction.** There each
  slip is visible on rereading: two neighbouring words in the wrong order.
  On arithmetic the model rereads its own reasoning and finds it plausible;
  a check from outside (running code) is what changes the answer, as with
  one agent with a sandbox above.
- **Self-Refine on the same fifty does no better.** Its critic redoes every
  computation and almost never answers NO ISSUES (2.6 and 2.7 revisions of 3
  on average). First answers 35 and 39, last 34 and 34: 9 right → wrong and
  3 wrong → right (p 0.15), read from the Evaluate page's answers by step.
- **With a stronger critic the same loop gains.** flash-lite still answers
  and revises, gemini-3.8-flash criticises (`model_map` `node:critic`). The
  critic mostly says NO ISSUES (0.3 revisions on average, not 2.7), and what it
  sends back is right: first answers 37 and 36, last 41 and 42, 10 wrong →
  right and none right → wrong (p 0.002), at $0.08 a run against $0.25. The
  weak critic's fault was finding problems that were not there. As a way to
  answer, though, it does not pay: gemini-3.8-flash answering alone gets 40
  and 41 at $0.028, nearly as many for a third of the cost.

The paper's other finding, that debate gains no more than a vote over the same
number of answers, is checked in [Debate or vote?](#debate-or-vote-what-the-rounds-add).

## CRITIC: criticising with the interpreter's output

CRITIC (Gou et al., ICLR 2024) adds the tool to self-correction. On math, the
model writes Python that stores its result in `answer`; the code runs; it is
shown the code, the interpreter's report and the output, asked "What's the
problem with the above code?", and writes a better solution, which runs in
turn: at most four corrections, stopping once the result stays the same twice.
The paper's ChatGPT on GSM8K: program of thought 72.5, CRITIC 78.2, and 77.0
when the critic does not see the execution ("w/o Tool"). The template's run
variable `tool=false` is that ablation; each correction's executed answer is
logged.

| flash-lite, two runs each | First program | After corrections | Right → wrong | Wrong → right | Cost per run |
|---|---|---|---|---|---|
| GSM-Hard (50), with the execution | 40, 39 | 35, 32 | 15 | 3 | $0.26 |
| GSM-Hard (50), without it | 41, 40 | 30, 33 | 20 | 2 | $0.26 |
| Hard computation (30), with the execution | 30 | 30 | 0 | 0 | $0.11 |
| Hard computation (30), without it | 30 | 29 | 1 | 0 | $0.10 |

- **Writing a program is the gain; criticising it costs answers.** The first
  program already does what one agent with a sandbox does (Hard computation
  30 of 30). On GSM-Hard, corrections turned 15 right answers wrong and 3
  wrong ones right with the execution shown (p 0.008), 20 and 2 without it
  (p 0.0001).
- **The interpreter's output halves the damage but does not make it a gain.**
  Reading the execution, the critic still overruled correct results: in one
  run it called its own program's right product "incorrect output", against
  its mental arithmetic, and wrote another program.
- **The authors' few-shot prompts do not change it.** With their pot.md and
  critic.md before each call (`shots=paper`; nine programs, four critiques),
  the first programs are a little better and the corrections still only lose:
  over two runs each, 82 → 71 with the execution shown (11 right → wrong, none
  back) and 80 → 70 without it (10 and none), at $0.43 a run. Zero-shot was not
  the cause.

Two template fixes came before these numbers. The first version compared each
revision's result with the previous one even when the revision had stored no
answer, so the stopping rule never fired and every run did all four
corrections; it also criticised code that had given no answer. Fixed, nine
revisions in ten still printed the result without storing it and could not be
taken, so corrections changed almost nothing (GSM-Hard 40 → 41, 39 → 39). With
the instruction repeated, almost every revision is taken (1 of 157 not), and
the numbers above are those runs.

## Answers the team had and lost

Each miss graded by rule now says whether a member marked the right answer
during the run (contracts: `reached`). Applied to the stored runs of the
evaluations above (hard computation on flash-lite unless noted), it splits
each system's misses in two:

| System | Misses where a member had it | Who had it most |
|---|---|---|
| DyLAN | 13 of 45 (29%) | the Skeptic (8), the Mathematician (6) |
| Multiagent debate | 20 of 98 (20%) | each debater, about equally |
| Multiagent debate, gemma | 4 of 15 | |
| ReConcile (three models) | 5 of 28 | |
| Exchange-of-Thought | 3 of 19 | |
| Self-consistency, 5 samples | 5 of 32 | a minority sample |
| Agent Forest | 6 of 49; on gemma 3 of 5 | a minority sample |
| Corex (Retrieve) | 2 of 16 | one of the candidates |
| Multi-Agent Verification | 1 of 16 | one of the candidates |
| MedAgents, CAMEL, Mixture-of-Agents | 2 of 18, 2 of 25, 1 of 20 | |
| MAD, AgentVerse, AutoAgents, ChatEval, AutoGen, Magentic-One, SPP | none | |

- **Discussion loses answers it finds.** In a fifth of debate's misses
  (over all its evaluations, sweeps included) a debater marked the right
  product and the team's final answer was another; DyLAN loses more, most
  often an answer its Skeptic gave. Kept, those would be worth about two
  questions in thirty for each, the size of the gains discussion gives at
  all here: an upper bound for any better way of combining the same
  debaters.
- **Choosing among samples has little left to choose.** For the vote,
  Corex and Multi-Agent Verification, the right answer was among the
  samples in 1 to 2 of 16 misses (Corex, MAV) and a few of 32 or 49 (the
  vote), so better selection is worth one question at most: the
  misses are questions no sample solves, as the earlier table showed.
- **MAD's devil found nothing to lose.** Its members marked answers in 64
  messages over 34 misses, none of them right: MAD's misses are not the
  judge overruling a right answer but nobody having one.

## Agents' Room: stories, judged pairwise

Stories have no expected answer, so they are evaluated with the grader
**None** and compared pairwise (`POST /api/evals/pairwise`, or the Pairwise
panel on the Evaluate page; the Compare page lists every judgement by set). A judge model reads both stories for each prompt,
in both orders. A story wins only when both orders pick it; anything else is
a tie. The set is `benchmarks/stories/prompts-10.jsonl`: ten prompts asking
for a short story of about 600 words. Everything runs on flash-lite; the judge
is gemini-3.8-flash unless noted.

| Agents' Room | Against | Wins | Losses | Ties | Cost (10 stories) |
|---|---|---|---|---|---|
| Final, run 1 | Single writer, run 1 | 0 | 10 | 0 | $0.20 against $0.013 |
| Final, run 2 | Single writer, run 2 | 0 | 9 | 1 | $0.20 against $0.013 |
| Final, run 1, judged by gemma | Single writer, run 1 | 0 | 8 | 2 | |
| Parts a fifth of the asked length | Single writer, run 1 | 1 | 9 | 0 | $0.20 against $0.013 |
| Long stories (about 2,000 words) | Single writer, long | 0 | 10 | 0 | $0.22 against $0.033 |

Agents' Room loses on every prompt but one or two, under two judges of
different families and at both lengths (sign test over the decided prompts,
p ≈ 0.002–0.02), at 7 to 15 times the cost. Both judges give the same reasons: the five parts repeat
their emotional beats, the ending drags, and the story runs long. Agents'
Room's stories average 849 and 728 words over the two runs (475 to 1,148).
The single writer's average 651 and 647, all between 605 and 718. The
writers were first told to write 150–300 words each, a floor of 750 for five
parts. Told instead to write a fifth of the asked length, they still
averaged 822 words, and the result was 1–9: the overshoot is the writers',
not the rule's. Asked for about 2,000 words, neither side got there. Agents'
Room averaged 1,206 words and the single writer 1,667, and Agents' Room still
lost 0–10 (0–9 when the judge saw only the first 12,000 characters of each).

**On a stronger model it still loses, by less.** With every role on
gemini-3.8-flash, against one call of that model (judged by gemini-3-flash):
0–4 (6 ties) pairwise and 2–4 (4 ties) scored pointwise. Its stories are as
long (626 words against 631), at $0.48 for ten, eighteen times the single
call. Self-MoA and Self-Refine on the same model never lost a story.

**Caveats.** The paper's agents are fine-tuned for each role. Here every
role is prompted flash-lite, and gemini-3.8-flash in the run above. Longer stories did not change the result, so
length is not what separates this from the paper. Fine-tuning is the
remaining difference, and this platform does not test it. The result holds
for this design with prompted roles on this model.

### Three bugs before the result

The numbers above are the fourth attempt. Each earlier attempt measured a
flaw in the setup, not the method:

1. **The judge's verdicts were cut off.** The judge had a 600-token output
   limit, and gemini thinks before it answers. On 6 of 10 prompts it never
   reached its "Better:" line, and a missing verdict was counted as a tie
   (first result: 0 wins, 4 losses, 6 ties). The judge now has 4,000 tokens,
   its replies are kept, and a missing verdict is marked as such, not as a tie.
2. **The scratchpad was shared by every story.** It was a workspace with scope
   `system`: one folder for all runs of the system, kept between them, and
   read by two stories at once in a concurrent evaluation. A beekeeper story
   turned into a spaceship from the ice-ship prompt, and a planner wrote about
   "letters postmarked from the future" from the lighthouse prompt (0–10).
   Plugins now have scope `run`, which starts empty in every run. Agents'
   Room, Magentic-One and ChatDev use it, and the Evaluate page warns about a
   shared workspace or board. Magentic-One re-run with the fix: still 30/30
   on Hard computation.
3. **The baseline ended every story with "Final: …".** The question baseline
   asks for a last answer line, and the judge marked that line down in four
   of its losses (5–5). The **Single writer (baseline)** template is one call
   with no answer line; it is the baseline for writing systems.

A last fidelity fix came before the final runs. The writers opened only some
of the scratchpad's files, often just the part before theirs, and drifted
off the plan. In the paper every agent's prompt holds the whole scratchpad.
A workspace binding can now inject its files' contents (`read.contents`, the
**File contents** toggle on the edge), and every Agents' Room planner and
writer gets the whole scratchpad. The stories then kept to their prompts but
still lost (0–10, 0–9).

## STORM: articles on recent topics, with live search

STORM researches a topic by interviews. A curator picks perspectives; for each,
an interviewer questions a topic expert who answers from web search; the notes
become an outline, and the outline becomes the article. The set is
`benchmarks/articles/recent-10.jsonl`: ten topics from 2024 to 2026. They are
recent so that what a model remembers may be out of date and research has
something to add. Everything runs on flash-lite. On this model `web_search`
is a grounded Gemini call. The control is **Single writer with search
(baseline)**: one agent with the same search tool that searches, then writes.

| STORM | Against | Judge | Wins | Losses | Ties |
|---|---|---|---|---|---|
| run 1 | writer with search, run 2 | gemini | 4 | 6 | 0 |
| run 2 | writer with search, run 1 | gemini | 3 | 6 | 1 |

**A judge that can search.** The judges above cannot check recent facts.
The **Fact-checking judge** template is one agent with `web_search` and
`fetch`, used as the judging system (`judge_system`, on gemini-3.8-flash). It
checks the facts and links the two articles disagree on before it rules: 162
searches and fetches over the 40 readings.

| STORM against the writer with search | Plain judge (gemini-3.8-flash) | Fact-checking judge |
|---|---|---|
| STORM run 2 / writer run 1 | 3–6 (1 tie) | 0–9 (1 tie) |
| STORM run 1 / writer run 2 | 4–6 | 4–3 (3 ties) |
| Together | 7–12 | 4–12 (p 0.08) |

Checking moves single verdicts a lot, more than the two judges differ
overall, and leaves the conclusion where it was: STORM is no better than one
searching agent. The judging cost $0.49, against $0.05 for the plain judge.

gemma is no judge for these topics. It does not know 2024–2026 events, so it
calls real ones made up. It also gave no verdict on 5 of 20 readings: its
thinking ran past the judge's 4,000-token limit, which now follows the judge
model's own.

| | Cost (10 articles) | Words | Links per article | Of them returned by its own searches |
|---|---|---|---|---|
| Writer with search, two runs | $0.018, $0.020 | 301, 335 | 2.8, 4.6 | 75%, 89% or more |
| STORM, two runs | $0.229, $0.217 | 430, 444 | 5.2, 6.3 | 38%, 48% |

Over both runs STORM wins 7 and loses 12 (p 0.36): no better than one agent
with the same search tool, at 12 times the cost. Its articles are longer and
the judge credits their depth on some topics, but it marks others down for
drifting off the topic (the Rubin Observatory article covers the observatory,
not its first images).

**Links.** A judge cannot check recent facts or links, so the links are
checked against each run's own searches: the **Sourced links** count on the
Pairwise panel, `GET /api/evals/:id/sources`, or `scripts/sourced-links.mts`.
STORM cites more links, but half or more of them came from no search. Some
the expert wrote from memory while answering (a doi.org paper, a 2024 news
article). Others the writer added. One searching agent cites what it found.
(The writer's first run was logged before the log kept 12,000 characters of
a tool's result, so its share is a lower bound.)

### Before these runs

- **Search worked only on Anthropic models.** On the others `web_search` was
  left out, and STORM's expert answered from memory. It now runs as a grounded
  Gemini call on every other model. Google gives sources as redirect links that
  expire within minutes (404 by the end of a run), so they are resolved to the
  real pages at search time.
- **The notes lost their sources on the way.** Interviewers cut sources to a
  site's name ("Source: NOAA/Climate.gov"). The curator, told to pass the notes
  on, wrote its own article instead. Its writer then cited "Provided Interview
  Notes" and links of its own (2.3 per article, 17% from searches; 1–6 and 2–5
  in the first judgements). Interviewers now copy each URL exactly, the curator
  passes the notes on as written, and the writer may cite only URLs the outline
  gives.
- **The log kept 3,000 characters of a tool's result**, too little to see where
  sources were lost. It now keeps 12,000.

**Caveats.** The paper's STORM drafts long articles from many interviews;
these articles are 300–450 words on flash-lite, from three interviews. The paper's
baselines include retrieval-augmented writing, which is the control here.

## ChatEval as a judge

ChatEval is an evaluator: three referees with different personas debate which
of two answers is better, and a chair gives the verdict. Its paper reports that
the debate agrees with human judges better than one judge does. Its task is
pairwise judging, so it is tested as a judge here (`judge_system` on
`POST /api/evals/pairwise`). It judged the seven valid pairs above, 70
questions across stories and articles, against one judge call, both on
flash-lite. There are no human labels: gemini-3.8-flash's verdicts stand in
for them (`scripts/judge-agreement.mts`).

| Judge (flash-lite) | Agrees with gemini-3.8-flash | Its two orders agree | Cost |
|---|---|---|---|
| One call | 45 of 70 (64%) | 50 of 70 (71%) | $0.12 |
| ChatEval (3 referees, 2 rounds, a chair) | 47 of 70 (67%) | 56 of 70 (80%) | $1.18 |

Each judge agrees with the reference on questions where the other does not: 6
for the single call, 8 for ChatEval (p 0.79). On stories they agree with it
equally (28 of 40 each); on articles 17 and 19 of 30 (p 0.62). The debate
changes its mind less when the two outputs swap places, at ten times the cost.
It does not agree with the stronger judge any more often. Run twice on the
same pairs, the single call's win, loss and tie counts moved by one or two per
pair (its first run's per-question verdicts were lost to the bug below).

Two bugs came first. The judgement files were named by the judge model, so a
panel run on flash-lite and flash-lite alone wrote the same file, and the
panel's verdicts replaced the single judge's. Each file is now named by the
judge's full label. The judging also locked both evaluations, so a second
judge could not start until the first finished; judging only reads them, and
the lock is gone.

## Mixture-of-Agents on open-ended instructions: the baseline decides

Mixture-of-Agents reports its gains as win rates on open-ended instructions
(AlpacaEval). The set here is `benchmarks/instructions/open-20.jsonl`, twenty
requests to explain, advise, write, plan or compare. MoA (two layers of three
proposers and an aggregator, every call on flash-lite) is judged pairwise in
both orders by gemini-3.8-flash.

| MoA against | Run 1 | Run 2 | Its words | Cost (20) |
|---|---|---|---|---|
| Single writer (one call, told to give the piece only) | 16–4 | 15–5 | 248, 268 | $0.011 |
| the same, judged on content and not length | 16–3 (1 tie) | 13–7 | | |
| the same, told to write about 450 words | 15–2 (3 ties) | 14–4 (2 ties) | 426, 428 | $0.017 |
| **Single model call (the request as it is, no instructions)** | **7–9 (4 ties)** | **7–10 (3 ties)** | 518, 517 | $0.023 |

MoA's answers average 444 and 449 words, at $0.21 for twenty.

Against the writer baseline MoA wins 31 of 40 decided (p 0.0007), and keeps
winning when the judge is told to ignore length and when the writer is made as
long. Against one plain model call it wins 14 and loses 19 (p 0.49), at nine
times the cost. That call is exactly one of MoA's proposers. **The gain was
the baseline's prompt, not the aggregation.** The writer baseline was built
for stories. Its instruction to give "the piece itself only, no title" removed
headings and lists: 0 headings and 3 list items per answer, against MoA's 4
headings, 9 list items and 4 tables. The judge rewarded structure ("easier to
scan", "dense paragraphs"). The plain call formats as MoA does (5 headings, 10
list items) and writes a little more.

For systems built of plain model calls, the baseline is now **Single model
call (baseline)**: one such call with nothing added. Its run variable `style`,
when set, is appended to the request, to match another system's length. The stories above keep
the writer baseline, where headings have no place. STORM's control, a
searching writer told to give the piece only, may have been held back the
same way; STORM lost to it anyway.

### A strong model: a gain that survives the controls

The paper's MoA mixes different models. Here the proposers are
gemini-3.8-flash, flash-lite and gemma, and gemini-3.8-flash aggregates. The
control is gemini-3.8-flash alone, one plain call, the strongest model in the
mix. The judge is gemini-3-flash rather than 3.8, because 3.8 writes the
final answer on both sides.

| Mixed MoA against gemini-3.8-flash alone | Run 1 | Run 2 |
|---|---|---|
| Default criterion | 16–0 (4 ties) | 15–0 (5 ties) |
| Judged on content, not length | 17–0 (3 ties) | 15–0 (5 ties) |
| The single model told to aim for about 730 words | 10–3 (7 ties) | 12–3 (5 ties) |
| Judged by gemma, another model family | 17–0 (3 ties) | |

| | Words | Headings | List items | Cost (20) |
|---|---|---|---|---|
| gemini-3.8-flash alone | 585, 586 | 5.0, 5.0 | 15.4, 14.1 | $0.054 |
| the same, aiming for 730 words | 758, 753 | 4.7, 5.2 | 7.5, 6.8 | |
| Mixed MoA | 735, 748 | 6.2, 5.9 | 16.9, 17.4 | $0.31 |

MoA wins 31–0 over both runs on the default criterion, and 32–0 when the
judge is told to ignore length (p < 0.0001). Against the single model at its
own length it wins 22–6 (p 0.004), at six times the cost. The two controls
cover each other's weak point. On the length-neutral criterion, both sides
are formatted alike and differ only in length. At matched length, the single
model drops half its lists, which may favour MoA, and MoA's margin shrinks
but holds. The judge's reasons are coverage: "more comprehensive", "includes
the pro-rata rule", "quieter temples than the usual suggestions".

**Mixing is not what makes the gain.** An earlier version of this section
said it was, on the strength of the flash-lite result above. Self-MoA, with
gemini-3.8-flash in every slot, tests that directly:

| Self-MoA, all on gemini-3.8-flash | Wins | Losses | Ties |
|---|---|---|---|
| against the mixed MoA | 6 | 4 | 10 |
| against gemini-3.8-flash alone (two runs) | 34 | 0 | 6 |
| the same, judged on content, not length | 33 | 0 | 7 |
| against the model told to aim for about 730 words (two runs) | 26 | 5 | 9 |

It writes 761 and 756 words, with 5.4 and 6.1 headings and 18.9 and 18.1 list
items, at $0.55 for twenty. It ties the mix and beats the model alone as the
mix does, at its own length too (13–3 and 13–2, p 0.0002). The matched control
keeps under half Self-MoA's lists, and the judge's reasons often name its
tables and structure, so that margin is partly format.

Is a strong aggregator enough? With every proposer on flash-lite and
gemini-3.8-flash aggregating, no:

| MoA against gemini-3.8-flash alone | Proposers | Aggregator | Result (two runs unless noted) | Cost (20) |
|---|---|---|---|---|
| Mixed | 3.8-flash, flash-lite, gemma | 3.8-flash | 31–0; 32–0 judged on content | $0.31 |
| Self-MoA | 3.8-flash ×3 | 3.8-flash | 17–0, 17–0; 16–0, 17–0 judged on content; 26–5 at matched length | $0.55 |
| Cheap proposers | flash-lite ×3 | 3.8-flash | 12–10 (18 ties); 10–9 (21 ties) judged on content | $0.25 |
| Self-MoA on flash-lite (against flash-lite alone) | flash-lite ×3 | flash-lite | 14–19 | $0.21 |

The cheap-proposer MoA writes as much as the model alone (576 and 603
words against 585) and is no better, at five times the cost. The gain needs
the strong model among the proposers as well as aggregating: drafts from
flash-lite give gemini-3.8-flash nothing to merge that it would not have
written itself. Different models are not needed (Self-MoA gains as much as
the mix), but a strong one at both stages is. That fits Self-MoA's finding
that a strong model in every slot is enough. Its claim that this beats the
mix shows here only as a tie.

**Merging is what gains, not sampling and choosing.** Universal
Self-Consistency (Chen et al. 2023) samples gemini-3.8-flash five times, asks
it which answer is the most consistent with the others, and returns that one
unchanged:

| USC on gemini-3.8-flash (two runs) | Default criterion | Judged on content |
|---|---|---|
| against gemini-3.8-flash alone | 12–7 (21 ties), p 0.36 | 11–5 (24 ties) |
| against the mixed MoA (run 1) | 0–15 (5 ties) | |

It writes as the model alone does (584 and 602 words), at six times the
cost ($0.34 for twenty), and is no better. The choice is also less about
consistency than it looks: the selector picked the first of the five answers
23 times in 40, where a blind pick would land there 8 times. MoA's drafts
give the aggregator material to combine; choosing among samples of one model
returns one of its ordinary answers.

**On stories the edge is small.** Self-MoA on gemini-3.8-flash against that
model alone, on the ten short-story prompts:

| | Wins | Losses | Ties | Picked the story shown first |
|---|---|---|---|---|
| Run 1, judged by gemini-3-flash | 4 | 0 | 6 | 16 of 20 |
| Run 2, judged by gemini-3-flash | 3 | 0 | 7 | 17 of 20 |
| Run 1, judged by gemma | 3 | 0 | 7 | 17 of 20 |

The lengths match (619 and 623 words against 631 and 634). MoA never loses:
7–0 over the two runs (p 0.016), and gemma agrees. But both judges picked
whichever story came first in four readings of five, so most pairs are ties
the order decided. Where a judge could tell the stories apart it chose MoA's,
at nine times the cost. Agents' Room, a team built for stories, lost to one
call on the same prompts (0–10). The Pairwise panel and the Compare page now
show how often a judge picked the response shown first, flagged at four in
five or more. (One run;
judged on content rather than length it still wins 16–0. The matched-length
control was run for the mix only.)
On Hard computation the same mix did not help (28, 27 against the best
model's 26, 27): drafts from different models add coverage to open-ended
answers, and there is nothing to add to a product that is right or wrong.

### One model criticising itself gains as much

Self-Refine (one model answers, critiques its own answer and revises, up to
three times, until the critique finds nothing to fix) was measured above on
maths. Most of its paper's tasks are open-ended, so its run variable `mode:
open` drops the step-by-step answer line. On gemini-3.8-flash, against that
model alone, judged by gemini-3-flash:

| Self-Refine against gemini-3.8-flash alone | Run 1 | Run 2 |
|---|---|---|
| Default criterion | 10–1 (9 ties) | 15–1 (4 ties) |
| Judged on content, not length | 11–1 (8 ties) | 14–1 (5 ties) |
| The single model told to aim for about 730 words | 9–4 (7 ties) | 11–4 (5 ties) |

It writes 694 and 682 words (5.5 headings, 17–18 list items) at $0.20 for
twenty: 25–2 over two runs (p < 0.0001), 20–8 against the single model at
matched length (p 0.04; judged again, 11–3 and 10–6). The critic found nothing
to fix in 8 and 9 of the twenty, and those answers are one plain call, like
the control. The split shows where the gain is:

| Answers (both runs, default criterion) | Wins | Losses | Ties |
|---|---|---|---|
| Revised at least once | 19 | 0 | 4 |
| Never revised: one call, as the control | 6 | 2 | 9 |

The never-revised answers are the control model against itself, and their
6–2 is the noise these judgements carry. The revised ones win 19–0. So on
this model, self-feedback gains about what Mixture-of-Agents gains (22–6 at
matched length), for two thirds of its cost and with one model. On maths
(above) its revisions moved 4 answers right and 3 wrong.

**Unlike MoA, it gains on flash-lite too.** Against flash-lite alone:

| Self-Refine on flash-lite | Run 1 | Run 2 |
|---|---|---|
| Default criterion | 10–1 (9 ties) | 11–1 (8 ties) |
| Judged on content, not length | 12–0 (8 ties) | 9–1 (10 ties) |

It writes 564 and 570 words against flash-lite's 518, with as many headings
and lists. Flash-lite's critic almost never finds nothing to fix: 38 of the 40
answers went through all three revisions, so it costs $0.17 for twenty, seven
times one call. MoA on flash-lite lost 14–19 to one call. One reading, not
tested here: merging drafts needs a model that can merge them well, while a
weak model can still act on specific feedback about its own answer.

A stronger critic adds little (one run). With flash-lite writing and
gemini-3.8-flash criticising (`model_map` `node:critic`), Self-Refine beats
flash-lite alone 11–1 (8 ties), as flash-lite criticising itself does, and
leads that version 8–3 (9 ties, p 0.23). Its critic is satisfied sooner (12
of 20 answers revised three times, against 38 of 40), at the same cost ($0.18
for twenty).

On stories it is like MoA: never worse, rarely told apart. Self-Refine on
gemini-3.8-flash against that model alone, on the ten short-story prompts:
1–0 (9 ties) and 3–0 (7 ties), with the story shown first picked in 19 and 17
of 20 readings. Its stories run a little longer (653 and 662 words against
631 and 634), at $0.09 for ten. With this judge, ten stories separate only
large differences, such as Agents' Room's loss to one call; a smaller edge
needs more prompts or a judge with less position bias.

**Scoring each story alone** (`pointwise: true`, "Score each alone" on the
Pairwise panel) takes the order away: the judge reads one story at a time and
gives it 1 to 10, and the higher score wins.

| Against gemini-3.8-flash alone (gemini-3-flash judging) | Pointwise | Mean scores | Pairwise, above |
|---|---|---|---|
| Self-MoA, run 1 / run 2 | 5–2 (3 ties) / 4–1 (5 ties) | 9.8–9.5 / 9.9–9.6 | 4–0 / 3–0 |
| Self-Refine, run 1 / run 2 | 3–4 (3 ties) / 4–2 (4 ties) | 9.5–9.6 / 9.8–9.6 | 1–0 / 3–0 |
| Agents' Room against the single writer (check) | 0–7 (3 ties) | 8.4–9.4 | 0–10 |

It agrees with the pairwise verdicts: Agents' Room loses, Self-MoA has a
small edge (9–3 over two runs), and Self-Refine none (7–6). The order is gone,
but the scores crowd the top of the scale (9.5 to 9.9), which leaves ties of
its own.

**Thirty stories** (`benchmarks/stories/prompts-30.jsonl`: the ten and twenty
more) give the small effects more room. Self-Refine on gemini-3.8-flash
against that model alone: 7–1 (22 ties, p 0.07) pairwise, the story shown
first picked in 52 of 60 readings; 9–3 (18 ties) pointwise, mean scores 9.77
against 9.57. Both point the same way. Self-Refine's stories are a little
better as often as not, never clearly worse, and the difference is small
enough that thirty prompts still leave it short of significance.

### Debate, revised in the open, gains as well

Multiagent Debate votes on final answers, which open-ended requests do not
have. In the paper's open-ended task (biographies) each agent's revised answer
is what counts. The run variables `mode: open` and `answer_format: "Reply with
your full response."` do that: three debaters answer, read each other and
revise for two rounds, and the first debater's last revision is the result.
On gemini-3.8-flash, against that model alone:

| Debate (open) against gemini-3.8-flash alone | Run 1 | Run 2 |
|---|---|---|
| Default criterion | 17–0 (3 ties) | 16–1 (3 ties) |
| Judged on content, not length | 20–0 | 16–1 (3 ties) |
| The single model told to aim for about 730 words | 13–1 (6 ties) | 13–5 (2 ties) |

It writes 703 and 701 words, at $0.48 for twenty. Side by side, on the same
twenty instructions, model and judge (two runs each):

| Against gemini-3.8-flash alone | Default | On content | Matched length | Cost (20) |
|---|---|---|---|---|
| Mixture-of-Agents (mixed proposers) | 31–0 | 32–0 | 22–6 | $0.31 |
| Self-Refine | 25–2 | 25–2 | 20–8 | $0.20 |
| Debate, open | 33–1 | 36–1 | 26–6 | $0.48 |

All three gain about as much against the model alone. Judged against each
other (two runs each, the same judge):

| Head to head | Run 1 | Run 2 | Together |
|---|---|---|---|
| MoA against Self-Refine | 8–5 (7 ties) | 7–6 (7 ties) | 15–11, p 0.56 |
| MoA against debate | 5–8 (7 ties) | 7–7 (6 ties) | 12–15, p 0.70 |
| Self-Refine against debate | 5–11 (4 ties) | 4–9 (7 ties) | 9–20, p 0.06 |

Debate leads Self-Refine by a margin just short of significance, and MoA
sits between them. To settle that one, both answered thirty more instructions
(`benchmarks/instructions/open-30b.jsonl`), as long as each other (808 and
795 words, as many headings and lists): debate 14–9 (7 ties). Over all fifty,
debate beats Self-Refine 34–18 (p 0.04), at about twice the cost ($0.79
against $0.41 for the thirty). MoA answered the thirty too ($0.50): over all
fifty it is level with debate (21–24, p 0.77) and with Self-Refine (27–22,
p 0.57). The order is debate, then MoA, then Self-Refine, and only debate
over Self-Refine is clear. Self-Refine gets most of the gain for half of
debate's price.

**On flash-lite, debate is like MoA, not Self-Refine.** Against flash-lite
alone, open-mode debate on flash-lite loses: 2–6 (12 ties) and 4–8 (8 ties),
6–14 together (p 0.12); judged on content, 2–7 and 5–11 (7–18, p 0.04). Its
answers come out shorter than one call's (430 and 446 words against 518, with
fewer lists): the debaters cut after reading each other where gemini-3.8-flash's
added. Two of the three methods need a strong model, merging drafts and
revising after reading others. Only criticising one's own answer gains on
flash-lite. Merging drafts,
criticising one's own answer, and revising after reading others all work on
open-ended answers with this model. On exact computation none of them did.

## LLM Discussion: creativity, and what the judge was shown

LLM Discussion (Lu et al., COLM 2024) brainstorms like a group. Four agents
with distinct roles (engineer, artist, futurist, community organiser) answer
a creative task, read each other's ideas and build on them over three rounds,
and a collector merges their final lists. The set is
`benchmarks/creativity/aut-20.jsonl`: twenty items in the form of the
Alternative Uses Test ("List as many creative and unusual uses as you can for
a brick."). The judge is gemini-3-flash, asked which list is more original,
varied and workable, and told that a longer list is better only if its extra
ideas are. Everything runs on gemini-3.8-flash.

| LLM Discussion against | Run 1 | Run 2 | Together |
|---|---|---|---|
| One call (about 30 uses) | 18–0 (2 ties) | 19–0 (1 tie) | 37–0 |
| One call told to aim for about 130 uses | 5–1 (14 ties) | 11–0 (9 ties) | 16–1, p 0.0003 |

| | Uses per answer | Words | Cost (20) |
|---|---|---|---|
| One call | 30.5, 30.1 | 914, 925 | $0.08 |
| One call, about 130 uses | about 133 | about 2,800 | $0.08 |
| LLM Discussion | 133.2, 132.1 | 1,482, 1,563 | $0.90 |

The merged lists are four times as long as one call's, so the fair control is
a single call asked for as many uses. Against it LLM Discussion still wins
16–1, but 23 of the 40 judgements are ties: its lead comes mostly from listing
more, and partly from more varied ideas. It costs eleven times as much.

On flash-lite (one run each), LLM Discussion lists about 76 uses against one
call's 26 and beats it 14–0 (6 ties). Against one call told to aim for 76
uses, it is 2–1 with 17 ties. On the weaker model its whole advantage is the
count. On gemini-3.8-flash a small edge in the ideas themselves survives. The
pattern matches MoA and debate, which gain only on the stronger model.

Against Self-Refine (gemini-3.8-flash, open mode), the paper's kind of single-model
baseline, LLM Discussion wins 16–0 and 19–0 (5 ties). Self-Refine revises one
list and ends with about 32 uses, as one call does ($0.32 for twenty), so this
measures the count again. On idea quality, the comparison that counts is the
one at matched count above.

**The first judgement was wrong, and a platform bug made it so.** At first
LLM Discussion beat the count-matched call 19–0 as well. The judge kept saying
the other list "cuts off mid-sentence at item 86". It did not: the judge was
shown only the first 12,000 characters of each answer, and the long lists ran
to 14,000–20,000. The run log also kept only 20,000 characters of an answer
and cut the middle of longer ones. The judge now sees answers whole up to
60,000 characters, and is told when one is shortened. The log keeps answers up
to 200,000 characters. The count-matched control was run again, and every
affected judgement was redone. Among the earlier open-ended results, only one
long story exceeded either limit. Agents' Room against the single writer on
long stories was judged again with it whole: 0–10, where it had been 0–9.

### How much a judgement moves when repeated

Thirteen pairs above were judged a second time by the same judge, with the
same criterion. Each pair's file had been overwritten when the judge rejudged
it on content rather than length, before such judgements got files of their
own. Across them the wins and losses moved by 1.1 per pair of twenty
questions. Clear results came back almost unchanged: Self-Refine's 10–1 and
15–1 exactly, mixed MoA's 16–0 and 15–0 as 15–0 and 16–0. The near-ties moved
most: cheap-proposer MoA 6–6 became 5–4, and USC 5–3 became 3–4. Every
conclusion above holds on the second judging. A split of a few questions on
twenty is within what judging the same outputs again produces.

## Meta-Prompting: word sorting, and what else gains as much

Meta-Prompting (Suzgun & Kalai 2024) has one model conduct. With the authors'
Meta-Expert instruction it either calls a named expert ("Expert Linguist:"
and an instruction in triple quotes), a fresh call to the same model that
sees only that instruction, or gives a final answer; each expert's output
goes back with the authors' prompt to verify, for at most fifteen rounds. The
template uses their prompts (their repository, MIT) without the Python
expert: the paper's "Meta −Py" setting. The paper's GPT-4 word sorting:
standard prompting 80.4, zero-shot chain of thought 83.6, Meta −Py 84.0,
Meta with Python 99.6.

The set is `benchmarks/word-sorting/word-sorting-50.jsonl`, fifty lists of 12
to 20 words in BIG-Bench Hard's format, generated from the system word list;
in half, a third of the words share their first two letters. One list holds
"étude", whose expected place (last, by code point) is arguable: it is
flagged and left out, so 49 questions. Everything runs on flash-lite, graded
by exact match of the sorted list (case and punctuation ignored).

| Word sorting (49), flash-lite | Run 1 | Run 2 | Cost per run | Against one agent, both runs |
|---|---|---|---|---|
| One agent, thinking step by step | 35 | 35 | $0.011 | |
| Meta-Prompting | 45 | 44 | $0.08 | +21 −2 (p 0.0001) |
| Solo Performance Prompting (multi-persona, one call) | 45 | 47 | $0.05 | +25 −3 (p < 0.0001) |
| Agent Forest, 10 samples and a vote | 45 | 44 | $0.21 | +19 −0 (p < 0.0001) |
| Self-Refine | **49** | **48** | $0.29 | +27 −0 (p < 0.0001) |

- **The gain is real, and larger than the paper's.** The single agent already
  thinks step by step, so this is the paper's chain-of-thought column: 71%
  against Meta-Prompting's 91%, where GPT-4 had 83.6 against 84.0. A weaker
  model leaves more room: on gemini-3.8-flash the single agent sorts all 49
  lists ($0.014), and no system can gain.
- **It is not the experts alone.** In 32 and 31 of 49 questions the conductor
  gave its final answer in the first round without calling anyone; there it
  still beat the single agent, 54 to 43 over both runs. When it did call
  experts (35 questions), it got all 35, the single agent 27.
- **One call with personas matches it for less.** Solo Performance
  Prompting, the paper's multi-persona column (GPT-4: 79.2), gets 45 and 47,
  against Meta-Prompting +8 −5 (p 0.6), at two thirds of its cost.
- **Voting matches it at two and a half times the cost.** Meta-Prompting and
  ten-sample voting win 6 questions each against the other.
- **One model checking its own list does best.** Self-Refine gets 97 of 98,
  beating Meta-Prompting +8 −0 (p 0.008), at three and a half times its cost.
  Sorting is checkable: comparing neighbouring words finds the slip that a
  first pass makes, and a reviser fixes it. Meta-Prompting's experts verify
  too, but the conductor often skips them.

The first grading counted none of Meta-Prompting's answers right: it writes
the sorted list one numbered word a line after "Answer:", and the grader read
only that line. The answer grader now reads a list given one item a line as
the whole list, and both evaluations were regraded without calling a model.

**Game of 24: the interpreter, not the conductor.** The paper's largest gain
is here: GPT-4 standard prompting 3%, Meta −Py 11%, Meta with Python 67%. The
set is `benchmarks/game24/game24-50.jsonl`, fifty games generated from every
four numbers 1 to 13, keeping those with the fewest solutions (4nums.com's
ranked games would need a download). A `check` grader verifies that the final
answer uses exactly the four numbers and equals 24. "Meta-Prompting (with
Python)" adds the authors' Expert Python: its code runs in a sandbox and the
output goes back to the conductor.

| Game of 24 (50), flash-lite | Run 1 | Run 2 | Cost per run |
|---|---|---|---|
| One agent, thinking step by step | 30 | 35 | $0.09 |
| Meta-Prompting | 36 | 37 | $0.80 |
| Solo Performance Prompting (multi-persona, one call) | 37 | 43 | $0.15 |
| Meta-Prompting with Python | 43 | 42 | $0.21 |
| Mixture-of-Agents, all flash-lite | 34 | 32 | $0.25 |
| Multiagent Debate, three debaters, two rounds | 40 | 42 | $0.53 |
| Self-Refine | 44 | 43 | $0.36 |
| Agent Forest, 10 samples and a vote | 42 | 44 | $1.04 |
| **One agent with a Python sandbox** | **50** | **50** | $0.12 |

- **The interpreter is the gain, and the scaffold costs some of it.** One
  agent that can run code solves all fifty twice, beating Meta-Prompting
  with Python +15 −0 (p 0.0001) at half its cost. The conductor lost games
  by declaring them impossible, or with an expression that uses the wrong
  numbers.
- **Without code, the scaffold adds little.** Meta-Prompting against one
  agent: +18 −10 (p 0.18), at nine times the cost. Solo Performance
  Prompting, in one call, does at least as well: 37 and 43, +21 −6 against
  one agent (p 0.006) and +18 −11 against Meta-Prompting (p 0.26), at a fifth
  of its cost (the paper's GPT-4: multi-persona 25.0, Meta −Py 11.0). With Python against
  without: +19 −7 (p 0.03).
- **Voting works even with many right answers, at a price.** Ten samples
  agreed often enough on the same expression (the top answer had 5.6 of 10
  votes on average, about four different answers per game) to reach 42 and
  44, as many as the Python expert, at five times its cost. The first run scored 3:
  the vote stripped every `*` as Markdown, so right products lost their
  signs; Agent Forest, self-consistency, MAV and EoT shared the bug, which
  answers that are numbers never showed.
- **Self-Refine gains here, as on word sorting.** Its revisions turned 16
  wrong answers right and 2 right ones wrong over two runs (first answers 34
  and 39, last 44 and 43; p 0.001), where on GSM-Hard they lost (3 against 9).
  A 24 answer can be checked by doing the arithmetic, as a sorted list by
  reading it; a GSM-Hard answer only by redoing the reasoning.
- **Mixture-of-Agents gains nothing here.** 34 and 32, as one agent. Its
  aggregator declared 9 and 10 games impossible, and in at least 2 of 16 and
  4 of 18 misses a proposer had written a right expression that the aggregator
  dropped (the Compare page's "had it, lost", which reads a line that is a
  whole answer, not an expression inside a sentence); in the rest no proposer
  had one. Merging drafts does not check
  them, where Self-Refine's critic does the arithmetic.
- **Discussion lands between one call with personas and a vote.** Multiagent
  Debate gets 40 and 42 at half the vote's cost; no method without code
  reaches one agent with a sandbox.
- **Teams lose answers they had.** Regraded with "had it, lost" (a member
  wrote an expression the check passes, the final answer failed it), misses
  with a right answer inside the team, per run: debate 3 and 3 of 8 and 10,
  Mixture-of-Agents 4 and 2 of 18 and 16, Meta-Prompting 2 and 2, ten-sample
  voting 2 and 2 (a right sample outvoted), Self-Refine 1 and 2, Meta-Prompting
  with Python none. Keeping any member's checked answer would have added two
  or three games to each.
- **Every miss without code was a claim that no solution exists**, or a
  wrong expression; every game has one, and the record keeps it.

The first evaluation of Meta-Prompting on this set had no cap on reply
length. On two games flash-lite repeated itself to its output limit in every
round, $1.4 a game and no end; it was stopped and marked invalid. Replies are
now capped at 4,096 tokens (the authors' configuration has 1,024). An
uncapped run of the Python version (46 of 50, $0.92) is left out of the
table for the same reason.

## Solo Performance Prompting on its own task

SPP's headline task is Trivia Creative Writing: a short story on a topic that
works in the answers to five trivia questions (the paper's GPT-4: standard
prompting 74.6%, SPP 79.9%). `benchmarks/trivia-writing` has twenty such
tasks, written for this project from well-known facts whose answers are names
(Jupiter, Canberra, Beethoven), never numbers or common words a story would
use anyway. A `check` counts the answers in the story, after the last "Final
answer:" when there is one, so answers SPP's personas name while discussing do
not count. On flash-lite one plain call and SPP both find 99 of 100 ($0.008
and $0.021): well-known facts leave no room.

On the paper's own set (100 tasks of five TriviaQA questions, from the SPP
repository; kept on the server, not bundled, as it carries no license), one
plain call works in 82.0% and 80.6% of the answers, SPP 79.2% and 80.4%, at
two and a half times the cost: no gain, where the paper's GPT-4 went from
74.6% to 79.9%. The first SPP run was graded on a list: without the paper's
demonstrations, flash-lite ended its stories with "Final answer:" and a list of
the answers it had worked in, which the check read. The template now asks for
the whole piece as the final answer to a writing task, and 97 of 100 runs give
the story there.

## Generative Agents in a town: who heard of the party, who came

Generative Agents' measured outcome is social: Isabella plans a Valentine's
Day party and, over two simulated days among 25 residents, word of it reaches
about half of them and 5 of the 12 invited come. That needs a world where news
has to travel, which a shared room is not (everyone hears everything).
`examples/hosted/town-mcp` is one: six places joined by paths, speech heard
only where it is said (or found there soon after), a clock that moves between
steps for everyone at once, and a `report` of who heard a keyword and who was
where. "Generative Agents (town)" puts six residents in it, each starting in a
place of their own, only Isabella knowing of the party; a function runs the
day, each resident taking a turn every hour from 08:00 to 19:00.

| Six residents, flash-lite, hourly steps | Heard of the party (of 5) | At the cafe 17:00–19:00 | Cost |
|---|---|---|---|
| Day 1 | 3 | 3 | $0.061 |
| Day 2 | 4 | 4 | $0.058 |
| Day 3 | 5 | 3 | $0.057 |

- **News travels by place.** Klaus, who starts in the library (two walks from
  the cafe), was the one who missed it on two days of three; Maria, Tom and
  Carlos, who pass the cafe, heard every time. Word reached 80% on average,
  more than the paper's half: six people in six places meet far more often
  than 25 in a town of many buildings.
- **Most who heard, came.** 10 of the 12 who heard over three days were at the
  cafe during the party.
- **A day costs six cents.** About 190 model calls: 66 looks, 65 things said,
  19 to 26 moves.

With twelve residents, the six added mostly starting away from the cafe
("Generative Agents (town, 12 residents)"), word travels further, not less:

| Twelve residents | Heard of the party (of 11) | At the cafe 17:00–19:00 | Cost |
|---|---|---|---|
| Day 1 | 11 | 5 | $0.128 |
| Day 2 | 11 | 3 | $0.126 |
| Day 3 | 10 | 3 | $0.121 |

- **More people pass it on.** 97% heard, against 80% among six: besides
  Isabella, 8, 8 and 6 residents spoke of the party themselves on the three
  days, so a larger town has more carriers.
- **Fewer of those who heard come.** 11 of 32 who heard came (34%), against
  10 of 12 (83%) among six; the paper had 5 of 12 invited. Hearing of it is not
  deciding to go.
- **"Heard" is generous.** It counts any line with "party" said where a
  resident was, a reply or a repeat included; the paper interviewed each agent
  about what it knew. Read the counts as exposure, an upper bound on knowing.

So the day now ends as the paper's does: each resident is asked whether it
knows of a party today, and counts as knowing only with a yes that names
Isabella or the cafe.

| Interviewed, two days each | Exposed | Knew when asked | Came |
|---|---|---|---|
| Six residents | 5, 5 of 5 | 3, 5 | 2, 2 |
| Twelve residents | 11, 11 of 11 | 7, 8 | 5, 7 |

- **Hearing of it is not knowing it.** Among twelve, 15 of 22 knew when asked
  (68%), against 100% exposed, nearer the paper's 52%. Klaus answered that he
  "never managed to find out who was hosting it or where"; Sam said yes, to "a
  party being hosted by the town in the park", and is counted as not knowing.

At the paper's scale ("Generative Agents (town, 25 residents, 2 days)": 25
residents, the party on the second day, as the paper's was planned on the 13th
for the 14th; hourly steps, interviews at the end of day 2):

| Twenty-five residents, two days | Run 1 | Run 2 | Paper |
|---|---|---|---|
| Knew of the party when asked (of 24) | 15 | 17 | about half |
| At the cafe, day 2, 17:00–19:00 | 9 | 11 | 5 of the 12 invited |
| Exposed | 24 | 24 | |
| Cost (about 1,800 model calls) | $0.74 | $0.74 | |

- **Close to the paper.** 32 of 48 knew when asked (67%), against the paper's
  52%, nearer than with six (80%) or twelve (68%, one day) residents; everyone
  had been present when it was spoken of.
- **Everyone who came knew.** All 20 at the party had said they knew of it;
  about three in five of those who knew came.

**Does the memory stream matter?** By default a resident keeps its whole
conversation (summarised past 30 messages), which leaves a memory stream
nothing to add. So a variant keeps only each resident's last 8 messages:

| Twenty-five residents, two days, two runs each | Knew when asked (of 24) | Came | Cost per run |
|---|---|---|---|
| Whole conversation | 15, 17 (67%) | 9, 11 | $0.74 |
| Last 8 messages only | 8, 13 (44%) | 8, 14 | $0.51 |
| Last 8 messages + the paper's memory stream | 19, 10 (60%) | 19, 7 | $1.20 |

- **Forgetting costs knowing, noisily.** Knowing falls from 67% to 44% when
  residents keep only their last few messages; runs vary a lot (8 and 13 for
  the same setup).
- **The memory stream wins some of it back, too noisily to say how much.**
  With the paper's memory stream added to the short history (retrieval by
  recency, importance and relevance; reflection once recent importance passes
  30), 19 and then 10 of 24 knew: on average between short memory and the whole
  conversation, but one run is the best of all six and the other near the
  worst. Two runs per setup cannot separate these; more would be needed.
- **Reflection fires, once per agent per few hours.** 103 and 101 reflections,
  every resident 3 to 6 times, never twice within seconds; no errors. It
  doubles the cost of the short-memory town (importance ratings and
  reflections on every observation).
- **Earlier memory-stream runs are withdrawn.** Two runs reported 16 and 14
  knowing, but the plugin's scope was `agent`, kept across runs, so residents
  started with memories of earlier runs, the party among them; and reflection
  never fired (its trigger read a run variable that was never set and is shared
  by every agent). A new scope, `agent_run` (each agent's own, empty every
  run), a per-agent trigger, and writes serialised per agent (overlapping
  writes had lost records and repeated reflections) fix them; the numbers above
  are from the fixed runs.

**The same ablation on gemini-3.8-flash** (two runs each, 25 residents, two
days, the fixed memory stream):

| gemini-3.8-flash, two runs each | Knew when asked (of 24) | Came | Heard of it | Cost per run |
|---|---|---|---|---|
| Last 8 messages only | 10, 13 (48%) | 11, 13 | 17, 18 | $1.51 |
| Last 8 messages + the paper's memory stream | 18, 15 (69%) | 12, 13 | 24, 20 | $3.10, $3.30 |

- **The memory stream helps knowing on the stronger model, about as much as
  the whole conversation did on flash-lite.** Both stream runs beat both
  short-memory runs (pooled 33 of 48 against 23 of 48, Fisher p 0.06). The
  news also travels further: 44 of 48 heard of it against 35 (p 0.03).
- **It does not bring more guests.** 25 came with the stream and 24 without
  (p 1.0); on this model knowing and coming separate, as about half of those
  who knew stayed away.
- **Reflection fires more often, and it doubles the cost.** 237 reflection
  events in the second stream run (flash-lite: about 100). A first stream
  run on course to pass its $4 limit was stopped and is marked invalid; the
  two above ran with $7 limits.
- The whole-conversation town was not rerun on this model.

A first memory-stream run failed on day 2 ("fetch failed", $1.15): a hosted
service's idle clock was touched only when a run first connected, so after an
hour the town was stopped under it. Every call through a hosted endpoint now
counts as a use; the rerun went past the hour untouched.

The town is hosted once per server (`examples/hosted/town-mcp`, under the name
`town`); days of it run one after another, as it is one shared world. In a
two-hour trial day the residents also called `enter` themselves; they now see
only `look`, `move`, `say` and `wait` (an env edge can list the tools it
allows), and the reset, the clock and the report are the day's alone.

## Werewolf: does the seer's knowledge reach the vote?

Xu et al.'s seven-player game (two werewolves, a seer, a witch, a guard, two
villagers; `paper-werewolf`) with the moderator as code and every choice made
by a player agent (flash-lite). The question measured: does the seer's private
knowledge make the village vote better? `seer=false` withholds her visions; the
game is otherwise the same. Twenty games each, the seating shuffled every
night.

| Twenty games each | Villagers won | Village ballots on a werewolf | Cost |
|---|---|---|---|
| Seer sees | 6 (30%) | 56 of 130 (43%) | $0.10 |
| Seer sees nothing | 3 (15%) | 42 of 104 (40%) | $0.07 |
| Seer sees and is told to say so (`seer_open`) | 5 (25%) | 75 of 133 (56%) | $0.10 |
| Seer sees, with the experience pool (games in sequence) | 7 (35%) | 76 of 141 (54%) | $0.22 |

- **Little difference, and none that twenty games can show** (Fisher p 0.45).
  The village's ballots fall on a werewolf about as often as a random vote
  would (two of five on day 1, 40%), with or without the seer.
- **The seer hints instead of telling.** Shown that Alice is a werewolf, she
  says "I am very suspicious of Alice… I have a strong feeling she is not on
  the side of the village", never that she saw it: her brief warns that
  revealing herself makes her a target, and she obeys it. A hint carries no
  more weight than anyone else's suspicion.
- **Told to say it, she does, and the vote follows; the game does not.** With
  `seer_open` the moderator privately advises her to name herself and whom
  she saw: she did in 10 of the 16 games where she spoke (1 of 15 before), and
  ballots on a werewolf rose from 43% to 56% (p 0.03, counting ballots as
  independent). Werewolves voted out rose from 9 to 13, but the witch poisoned
  only 2 instead of 8, and the village voted the seer herself out 9 times
  either way; the villagers won 5 games.
- **The witch decides more games than the seer.** Her poison killed a werewolf
  in 8 and 6 games, against 9 and 6 voted out by the village; the guard and
  the healing potion left 5 and 3 nights without a death.
- **The game needed the paper's rules.** In a trial with a fixed seating both
  werewolves killed the seer, listed first, and she inspected the first name
  listed; the seating is now shuffled every night. With only villagers and a
  seer, ten games all ended on night 2: one wrong vote on day 1 left the
  werewolves as many as the rest. The witch and the guard (as in the paper)
  make games last two to three nights.

**The experience pool** (`paper-werewolf-experience`, the paper's own
addition): after each game every player, the dead too, is shown how it went
and writes one lesson for its role; a memory plugin with scope `agent` keeps
each player's lessons across games (only replies starting "Lesson:" are
stored, no model call) and shows the five most recent before every answer.
Twenty games run one after another, so the pool grows.

- **The lessons are specific and sound.** The witch: "I will prioritize
  protecting the Seer with my healing potion as early as possible"; a werewolf:
  "identify and eliminate the witch early, as their poison was the direct cause
  of my elimination"; a villager: "prioritize my own analysis of voting
  patterns rather than relying on the consensus".
- **The village votes better, not significantly.** Ballots on a werewolf rose
  from 43% to 54% (p 0.07 counting ballots as independent, which they are not
  within a game); wins 6 to 7. Both halves of the sequence are alike (55%,
  53%): what helps arrives with the first lessons, not by accumulating.
- **The seer still does not say what she saw.** She claimed her role in 1 of
  15 games without the pool and 0 of 14 with it, though her own lesson reads
  "share my discovery about Alice … immediately during the first day". Both
  sides learn, so the werewolves' lessons work against the village's.

## TradingAgents: a backtest from prices alone

Xiao et al.'s firm (`paper-tradingagents-backtest`: four analysts, a bull and
bear debate, a trader, a risk debate, a risk manager; no approval step, as an
evaluation runs unattended) decides each trading day from the 30 days of daily
prices before it, for the paper's three stocks, over the 40 trading days from
2026-09-28 to 2026-11-20 (after the models' training, so no model can recall
them). Its analysts are told to use only the prices given: the paper's news,
social media and filings are not connected. `benchmarks/tradingagents`
fetches the prices at run time and scores long only (BUY holds the stock,
SELL holds cash, HOLD keeps the last position). One agent, one call, on the
same cases is the control. All on flash-lite.

| 120 decisions (3 stocks × 40 days) | Direction right (BUY before a rise, SELL before a fall) | AAPL | AMZN | GOOGL | Cost |
|---|---|---|---|---|---|
| Buy and hold | | +3.2% | +3.8% | −17.7% | |
| One agent (two runs) | 45 of 111, 44 of 114 (40%) | −6.1%, +0.9% | −9.6%, −4.3% | −17.7%, −20.2% | $0.10 |
| TradingAgents (two runs) | 28 of 60, 19 of 50 (43%) | +0.5%, −1.3% | −6.0%, −11.4% | −14.3%, −7.2% | $2.23 |

- **Neither reads the next day from prices.** Up and down days were even (60
  of 120); the firm's calls are a coin's (p 0.70 and 0.12), the single agent's worse
  than one (p 0.06 and 0.02): it mostly buys (69 and 76 of 120), and in this
  stretch rises were followed by falls.
- **The firm's gain is its caution.** It held in half its decisions or more
  (60 and 70 of 120), against 5 and 7 for one agent, so it was out of the market more: a
  smaller loss than buy and hold on the falling stock (GOOGL), a loss against
  it on the two that rose, in both runs. Its Sharpe ratio is below buy and
  hold's on every stock in both runs, GOOGL included (−2.82 and −3.14 against
  −2.57): a smaller loss there, not a better return for its risk.
- **Twenty-two times the cost** of one agent for that.

The paper reports large gains over buy and hold (Q1 2024, with its news and
fundamentals feeds and GPT-4o models); with prices alone and over 40 days,
none appears here. Graded on the Evaluate page by `benchmarks/tradingagents/check.js`
(right direction of all decisions): 45 and 44 of 120 for one agent, 28 and 19
for the firm, as the backtest script counts.

## GovSim: does a commons hold?

Piatti et al.'s fishery (`paper-govsim`): five fishers share a lake of 100
tons; each month each says privately how much it will catch, the fish left
double up to 100, and below 5 tons the lake collapses. Between months the
catches are made public and each fisher speaks once. The rules are code; every
catch and every word is a fisher's (flash-lite). Twelve months, five runs each.

| Five runs each | Survived 12 months | Months survived | Efficiency | Cost |
|---|---|---|---|---|
| As in the paper | 5 of 5 | 12 each | 100% | $0.51 |
| No talk (`talk=false`) | 5 of 5 | 12 each | 100% (one run 90%) | $0.10 |
| One fisher told privately to think only of himself (`greedy=true`) | 0 of 5 | 0, 2, 2, 2, 3 | 17–26% | $0.04 |
| The same, with the universalization prompt | 1 of 5 | 2, 3, 3, 8, 12 | 27–74% | $0.23 |

- **Cooperation needs no talk here.** In every run all five caught exactly 10
  tons in the first month, before anyone had spoken: the sustainable share,
  worked out from the rules alone (half the lake, split five ways). The paper
  found most models collapse the lake; flash-lite never did, so talk had
  nothing to add.
- **One greedy fisher collapses it, every time.** He took 20 tons (once 50);
  the others told him plainly to stop ("Luke, taking 20 tons is unsustainable
  and puts the entire lake at risk"), and he refused. Nobody absorbed his
  excess: holding the lake would have meant the other four taking 7.5 tons
  each, and they kept to 10, so the stock shrank month after month; in three
  runs some raised their own catch to 12–16 tons in month 2 ("if you do not
  respect the limit…"), which hastened the end.

- **The universalization prompt helps a little.** Asking each fisher before it
  chooses what would happen if everyone caught as much (`universalization=true`,
  the paper's remedy), with the greedy fisher still in: the lake lasted 2, 3, 3,
  8 and 12 months (one-sided p 0.05 against 0, 2, 2, 2, 3). In the run that
  held, the other four did what none did before: they cut to 2 tons each for
  six months and absorbed his 18, at the price of equality (0.74).

The paper's agents also reflect and plan with a memory of past months, and its
newcomer is a persona rather than a private note.

## Repeated games: forgiving, and coordinating with a pattern

Akata et al.'s games (`paper-repeated-games`): an agent plays ten rounds of a
2×2 game against a fixed strategy, the options named J and F so that no word
primes the choice, each round's prompt stating the rules and the whole
history. Five games each, flash-lite, a cent per five games.

**Prisoner's Dilemma against an opponent who defects once** (F in round 1,
then J forever; J is to cooperate):

| Five games each | Rounds (player, other) | Points (player, other) |
|---|---|---|
| Plain | `JF FJ JJ JJ JJ JJ JJ JJ JJ JJ` ×3, `JF FJ FJ FJ …` ×2 | 74/74 ×3, 90/10 ×2 |
| Predicting the other's move first (`predict=true`) | `JF FJ FJ FJ …` ×5 (once J in the last round) | 90/10 ×4, 88/18 |

- **It retaliates once, every time**, then either forgives (three of five,
  cooperating to the end) or keeps defecting against an opponent who never
  defects again (two of five). The paper's GPT-4 was unforgiving; here the
  lasting defection is exploitation, not a grudge: the opponent cooperates
  throughout.
- **Predicting first makes it exploit.** Asked to predict the other's move,
  it predicts J, and F is the best answer to J: all five games exploit the
  opponent, against two of five without the prediction. The paper's remedy
  is for coordination; here it costs the opponent.

**Battle of the Sexes against an opponent who alternates** (J, F, J, F, …;
the player prefers J, the other F, and both get nothing when they differ):

| Five games each | Rounds coordinated (of 10) | The player copied the other's last move (of 9) |
|---|---|---|
| Plain | 6, 1, 10, 2, 1 | 4, 9, 0, 8, 9 |
| Predicting first | 1, 3, 2, 2, 2 | 9, 7, 8, 8, 8 |

- **It copies the last move, one step behind.** Against an alternating
  partner, choosing what the other chose last round is always wrong; in three
  of five plain games it did so almost every round, as the paper found of
  GPT-4. One game found the pattern and coordinated all ten rounds.
- **Predicting first does not help here.** Its predictions are the same
  copying ("they are returning to the option that yielded mutual points"):
  1 to 3 rounds coordinated, against the paper's gain from the same prompt.

**Two agents against each other** (`opponent=agent`; the other sees the game
from its side, F its favourite in the Battle of the Sexes):

| Five games each | Rounds | Coordinated (of 10) |
|---|---|---|
| Prisoner's Dilemma | `JJ` all ten rounds, every game | 10 each |
| Battle of the Sexes | `JF FJ JF FJ …` in four games, `JJ` ×9 in one | 0, 0, 9, 0, 0 |
| Battle of the Sexes, both predicting first | | 0, 1, 9, 4, 7 |

- **Two agents always cooperate in the dilemma**: 80 points each, no defection
  in 50 rounds.
- **In the Battle of the Sexes they swap past each other.** Each opens with
  its own favourite, then each copies the other's last move, so they change
  places every round and never meet: no points at all in four games of five.
- **Here predicting first does help**, as the paper found: two more games
  settle on one option (4 and 7 rounds), though one still never meets. It
  helps against a partner who also adapts, not against a fixed alternation.

## Negotiation with AI feedback: a higher price, or no sale

Fu et al.'s bargaining (`paper-negotiation`): a seller and a buyer negotiate
over a balloon listed at $20, each message ending with an offer or an
acceptance; after each game a critic reads the negotiation and gives the
seller three suggestions, which accumulate into every later game. Four games
a run, ten runs, flash-lite in all three parts; the control has no critic.

| Ten runs | Game 1 | Game 2 | Game 3 | Game 4 | Per game, no sale as $0 | Cost |
|---|---|---|---|---|---|---|
| With the critic: deals, mean price | 10, $19.19 | 9, $19.83 | 2, $20.00 | 6, $20.00 | $13.26 | $0.13 |
| No critic | 10, $19.30 | 10, $19.60 | 10, $19.30 | 10, $19.65 | $19.46 | $0.06 |

- **The coached seller's price rises to the ceiling**, as the paper found:
  every deal from game 3 on is at $20, the most the buyer will pay.
- **And then it stops selling.** The critic's advice is to "anchor higher",
  "stay above your original listing" and "stop countering against your own
  original list price"; the seller takes it and names floors the buyer cannot
  meet ("my firm walk-away point remains at $23 … I am moving on"). In games
  2 to 4, 17 of 30 negotiations closed against 30 of 30 without the critic
  (Fisher p 0.00005): counting a lost sale as nothing, the coached seller
  earns a third less per game.
- **Setting the buyer was most of the work.** Told to pay "$10 or less", the
  buyer held to it and no game of four closed; told it would "rather buy than
  walk away", it paid $35 for the $20 balloon. The runs above have a buyer who
  wants it, $10 ideally, never above the list price. The paper reports the
  same trade-off for its harder bargainers: a higher price, more failed deals.

## Auction Arena: bidding to the last dollar

Chen et al.'s auctions (`paper-auction-arena`): bidders with $20,000 each
compete for six items sold one after another (values $2,000 to $10,000,
$33,000 in all, known to everyone), each auction rising in $500 steps until
one bidder is left, who pays its last bid. Three agent bidders (flash-lite),
with or without the paper's rule bidder, which bids while the price is below
the item's value. The auctioneer, budgets and profits are code; the runs
report their profits as metrics. Five auctions each.

| Five auctions each | Agents' profit per auction | Rule bidder's | Items above value | Agent wins at full value | Cost |
|---|---|---|---|---|---|
| Three agents and the rule bidder | $500–1,500 (mean $900) | $0–1,000 (mean $500) | 0 | 16 of 25 | $0.08 |
| Three agents | $500–1,500 (mean $1,100) | | 0 | 19 of 30 | $0.11 |
| Private values (`private=true`), with the rule bidder | $500–2,700 (mean $1,740) | $300–2,900 (mean $1,560) | 1 | 3 of 20 at or above its own value | $0.09 |

- **Nobody overpays, and nobody profits.** No item in ten auctions went above
  its value, but prices ran up to it: of $33,000 of goods, the bidders kept
  $500 to $1,500 an auction.
- **The agents win by paying the whole value.** 35 of their 55 wins were at
  exactly the item's value, a win worth nothing; asked "do you bid $6,000?"
  for an item worth $6,000, they bid. The rule bidder, which stops a step
  below, earned $500 a win and on average more than any one agent ($500
  against $300 a bidder an auction).
- **Budgets were never the constraint.** Bidders ended with thousands left,
  one often never winning anything: with values common to all, the auction
  is decided at the item's value, and planning for later items had nothing to
  change.
- **With private values there is profit, and the rule bidder takes most of
  it.** Each bidder told only its own value (0.8 to 1.2 times the listed one,
  the paper's private-value setting): prices stop where the second-highest
  value drops out, and the bidders keep more. The agents won 20 items, 3 at
  or above their own value, and earned $580 each an auction; the rule bidder,
  still bidding while below its value, won 10 and earned $1,560.

## SOTOPIA: social goals, played or written

SOTOPIA (`paper-sotopia`): two characters, each with a private social goal
that pulls against the other's (a flatmate who wants the other to take over the
bins, one who has exams; a refund past the return policy), talk for up to 10
messages, and an evaluator agent scores each character's goal completion (0 to
10) and the change in their relationship (-5 to 5). The follow-up "Is this the
real life?" (Zhou et al. 2024) found that one model writing the whole
conversation, knowing both goals, scores higher than two agents who each know
only their own: `mode=script` is that comparison. Six scenarios written for
the template, ten runs each (60 conversations per row), the same model playing,
writing and judging:

| Ten runs of six scenarios | Goal completion (0-10) | First speaker (the one who asks) | Second speaker | Relationship | Cost per run |
|---|---|---|---|---|---|
| gemini-3.8-flash, two agents | 6.07 | 4.06 | 8.0 | 0.61 | $0.028 |
| gemini-3.8-flash, one writer | **6.96** | 4.91 | 9.0 | 0.98 | $0.009 |
| flash-lite, two agents | 6.26 | 3.81 | 8.7 | 0.18 | $0.017 |
| flash-lite, one writer | 6.48 | 3.46 | 9.5 | 0.66 | $0.004 |
| gemma-4-26b-a4b-it, two agents | 5.94 | 2.65 | 9.2 | 0.48 | free |
| gemma-4-26b-a4b-it, one writer | 5.82 | 1.96 | 9.7 | 0.53 | free |

- **On 3.8-flash the paper's finding holds.** The written conversations score
  0.9 higher (permutation test over the ten runs, p < 0.001); more for the one
  who asks (4.91 against 4.06, p 0.03), and the relationship ends warmer (p
  0.05). A writer who knows both goals finds the compromise both can accept;
  agents who know only their own goal more often end without one.
- **On flash-lite it does not.** 6.48 against 6.26 (p 0.38); the writer helps
  the one who refuses, not the one who asks (3.46 against 3.81). Only the
  warmer ending remains (p 0.07).
- **On gemma neither.** 5.94 against 5.82 (p 0.60, one batch sweeping
  `mode`); as on flash-lite, the writer favours the one who refuses (9.7
  against 9.2) and leaves the one who asks with less (1.96 against 2.65, p
  0.02). The follow-up paper's gap shows on the strongest of the three models
  only.
- **Refusing is easier than asking.** On every row the second speaker, whose
  goal is mostly to decline, scores about twice the first.
- **The judge is not the cause.** With the evaluator swapped to the other
  model (`model_map: {"node:evaluator": ...}`), ten runs again per row:

  | Players, judged by the other model | Two agents | One writer | p |
  |---|---|---|---|
  | gemini-3.8-flash, judged by flash-lite | 5.95 | **7.20** | < 0.001 |
  | flash-lite, judged by gemini-3.8-flash | 6.33 | 6.24 | 0.67 |

  The gap follows the model that plays, not the one that judges: 3.8-flash's
  written conversations win under either judge, flash-lite's under neither.
  Under both judges the writer's conversations end warmer (relationship 1.02
  against 0.63, p 0.004; 0.62 against -0.09, p 0.007). No human scores are
  compared.

## MachineSoM: debate or reflect, and in which order

Zhang et al.'s society (`paper-machinesom`): three agents answer, then go
through three rounds; in each round every agent either debates (reads the
others' last answers) or reflects (reads only its own), as the run variable
`strategy` sets (`ddd` … `rrr`); the last round's majority is the answer. The
paper found that strategies opening with debate beat those opening with
reflection. Three easygoing agents (`traits=EEE`), flash-lite, AIME 2026
(30) and HMMT February 2026 (33), against one agent and Agent Forest's
majority vote over independent samples (12 is the society's number of calls):

| flash-lite, 63 problems | AIME | HMMT | Correct | Agents agreeing at the end | Cost |
|---|---|---|---|---|---|
| One agent | 13 | 10 | 23 | | $0.09 |
| Vote over 3 samples | 18 | 11 | 29 | | $0.30 |
| Vote over 12 samples | 18 | 12 | 30 | | $1.19 |
| `ddd` (debate, debate, debate) | 18 | 16 | 34 | 2.79 of 3 | $1.53 |
| `rdd` | 18 | 15 | 33 | 2.76 | $1.47 |
| `drr` | 21 | 15 | 36 | 2.43 | $1.45 |
| `rrr` (reflect only) | 20 | 17 | **37** | 2.24 | $1.38 |

- **Every society beats one agent** (`ddd` +13 −2, p 0.007; `rrr` +16 −2,
  p 0.001), and the society's rounds add to a plain vote: `rrr` beats the
  12-sample vote at the same number of calls (+8 −1, p 0.04).
- **Debate first does not win here.** The order the paper found is reversed
  in the counts (`rrr` 37 and `drr` 36 against `ddd` 34 and `rdd` 33), but
  neither difference is significant (`rrr` against `ddd` +5 −2, p 0.45; `drr`
  against `rdd` the same).
- **Debate makes agents agree, not answer better.** After debate rounds
  nearly all three end on the same answer (2.79 of 3 for `ddd`); after
  reflection rounds they agree less (2.24) and are right more often: the
  paper's conformity, at a cost of the vote's independence.
- **Traits change little.** Three overconfident agents (`traits=OOO`):
  `ddd` 38 (21 and 17) against 34 for easygoing ones (+5 −1, p 0.22), `rrr`
  37 against 37 (+3 −3). Overconfidence did not stop the agreement either:
  2.81 of 3 agree after `ddd`, as with easygoing agents (2.79), and 2.21
  after `rrr`. Both OOO societies again beat the 12-sample vote (`ddd` +9
  −1, p 0.02; `rrr` +8 −1, p 0.04). As the paper found, the strategy matters
  more than the traits; unlike it, debating first was not the better
  strategy. About $1.5 a society for the 63.
- One model; the paper uses gpt-3.5 and others on MMLU, MATH and chess. Not run on gemini-3.8-flash: one agent
  already solves 61 of these 63 (30 and 31).

## Consensus seeking: the network and a stubborn agent

Chen et al.'s consensus game (`paper-consensus`): five agents each start with
a whole number from 0 to 100 (drawn anew every game), and each round every
agent sees only its neighbours' numbers and states a new one; they agree when
the spread is at most 1 (six rounds at most). The paper found that agents
mostly move to their neighbours' average, and that the network and stubborn
agents change how fast and where they meet. Twenty games a row; "pull" is
how far the meeting point ends from agent 1's start (the hub in the star, the
stubborn agent where there is one):

| 20 games each | Agreed | Rounds (when agreed) | From the starting mean | Agent 1's pull (distance from its start) | Moves toward the neighbours' mean | Cost |
|---|---|---|---|---|---|---|
| gemini-3.8-flash, full | 20 | 1.7 | 5.0 | 16.8 | 93% | $0.03 |
| ring | 13 | 4.8 | 1.6 | 23.6 | 99% | $0.12 |
| star | 20 | 5.0 | 5.4 | **11.3** | 77% | $0.10 |
| full, agent 1 stubborn | 20 | 4.3 | 6.6 | 16.9 | 87% | $0.10 |
| ring, agent 1 stubborn | **2** | 4.5 | 12.0 | **12.0** | 98% | $0.13 |
| flash-lite, full | 20 | 2.5 | 1.8 | 25.6 | 89% | $0.03 |
| ring | 18 | 5.6 | 0.9 | 25.2 | 92% | $0.06 |
| star | 18 | 4.9 | 7.0 | **13.5** | 73% | $0.05 |
| full, agent 1 stubborn | 20 | 4.2 | 2.2 | 21.1 | 87% | $0.05 |
| ring, agent 1 stubborn | **5** | 5.6 | 10.6 | **13.5** | 90% | $0.06 |
| gemma-4-26b-a4b-it, full (10 games) | 10 | 1.4 | 3.9 | 27.6 | 96% | free |
| ring | 10 | 5.2 | 2.1 | 20.9 | 95% | free |
| star | 10 | 4.8 | 4.5 | **14.4** | 81% | free |

- **The average strategy, as the paper found.** On all three models 73% to 99% of
  changes move toward the mean of what the agent sees, and with everyone
  seeing everyone the group meets near the starting mean (within 2 to 5 of
  it) in two or three rounds.
- **A sparse network is slower but fairer.** In a ring agreement takes about
  five rounds and fails in 7 and 2 of 20 games within six, but where it is
  reached it lies closest to the starting mean (1.6 and 0.9).
- **The hub pulls, on all three models.** In the star, the agent who sees
  everyone (and whom the others see) ends the game about 11 to 14 from where
  the group meets, against 17 to 28 for an ordinary agent: the others move
  toward it. gemma (10 games a network, a sweep over `topology` in one batch)
  agrees in every ring game, where 3.8-flash and flash-lite failed in 7 and 2
  of 20.
- **A stubborn agent is felt in a ring, hardly with everyone seeing it.** With
  full sight the stubborn agent slows agreement (about 4 rounds against 2)
  but the meeting point is no nearer its number (16.9 against 16.8 on
  3.8-flash; 21.1 against 25.6 on flash-lite). In a ring it stalls the group
  (2 and 5 of 20 agree) and drags its neighbours toward it (12.0 and 13.5).
- Starting numbers differ from game to game, so these are averages over
  different games; the paper's robot-formation task is not built.

## LLM-Stakeholders: six parties, a veto and five of six

Abdelnabi et al.'s negotiation (`paper-stakeholders`), in a scenario written
for the template: six parties (Council, Residents' Association, Local
Businesses, Green Coalition, Youth Club, Builder) settle a community centre's
site, budget, hours, parking and operator, three options each. Each has
private scores and a minimum; a deal passes if the Council (which proposes
last) and the Residents' Association (a veto) accept it and five of six reach
their minimum, which only 7 of the 243 deals do (the Council's own best is
not one). Three rounds of six messages, then the Council's final proposal,
checked by the rule. Twenty games a row:

| 20 games each | Final deal passes | A passing deal proposed on the way | Parties at their minimum | Local Businesses' score | Green Coalition's score | Cost |
|---|---|---|---|---|---|---|
| gemini-3.8-flash, all cooperative | **12** | 16 | 4.45 | 52.6 | 64.8 | $0.52 |
| Local Businesses greedy | 12 | 14 | 4.55 | **43.7** | 72.0 | $0.52 |
| Green Coalition a saboteur | 9 | 10 | 4.40 | 41.2 | **80.8** | $0.52 |
| flash-lite, all cooperative | **0** | 1 | 3.10 | 51.0 | 59.5 | $0.22 |
| Local Businesses greedy | 0 | 6 | 3.20 | 52.0 | 57.0 | $0.22 |
| Green Coalition a saboteur | 0 | 7 | 2.55 | 46.2 | 50.9 | $0.23 |

- **The smaller model never closes.** flash-lite passed no deal in 60 games
  (3.1 parties at their minimum on average) though in 14 a passing deal was
  put on the table along the way; 3.8-flash passed 12 of 20. The paper's
  finding: small models mostly fail, strong ones still fail often.
- **Greed backfires.** A greedy Local Businesses ended with less (43.7 against
  52.6 when cooperative, below its minimum of 50), and the deals passed as
  often: the others planned around it.
- **A saboteur costs a few deals and gains ground.** Nine of 20 passed with a
  secret saboteur against 12 (Fisher p 0.53, not significant over 20), and
  the saboteur's pretended scores did best of all (80.8): the others conceded
  to its stated wishes. On flash-lite it pushed parties further below their
  minimums (2.55 against 3.10).
- **Proposed, then lost.** On 3.8-flash 16 cooperative games saw a passing
  deal proposed and 12 ended on one: the Council's last proposal is not
  always the best one on the table.
- **A private scratchpad lifts the small model off zero, not the strong
  one.** With `plan=true` each party first writes notes it alone sees (what
  the others seem to want, which deals might pass for them), kept for its
  next turn, as the paper's structured prompts do. flash-lite then passes 4
  of 20 (against 0 of 20 cooperative, p 0.11; 0 of all 60 games without
  notes, p 0.003), 3.8 parties at their minimum against 3.1, and a passing
  deal is proposed in 9 games against 1. 3.8-flash passes 10 of 20 against
  12, at 1.7 times the cost ($0.92 for 20): it needed no notes to read the
  others.

## ReCon on Avalon: hiding Merlin

Wang et al.'s Avalon (`paper-avalon-recon`): six players, four good (Merlin,
who knows the evil players; Percival, who sees Merlin and Morgana without
telling which is which; two Loyal Servants) and two evil (Morgana and the
Assassin, who know each other), roles shuffled every game. Leaders propose
teams, everyone speaks once and votes, teams play secret cards; three
successful quests leave the Assassin one guess at Merlin. With ReCon
(`recon=good`) the good players first think in private what each other player
is and how their own words and votes will be read, notes kept for their next
turn; only the answer is seen. Twenty games a row (21 without ReCon on
3.8-flash, the first test game included; batches stopped at their cap were
topped up and pooled):

| | Good won | Three quests succeeded | Assassin found Merlin | Approved teams with an evil player | Cost a game |
|---|---|---|---|---|---|
| gemini-3.8-flash, no ReCon | 2 of 21 | 21 | 19 | 27% | $0.13 |
| gemini-3.8-flash, ReCon for good | **8 of 20** | 20 | 12 | 23% | $0.12 |
| gemini-3.8-flash, ReCon for both sides | 6 of 20 | 20 | 14 | 20% | $0.17 |
| flash-lite, no ReCon | 15 of 20 | 20 | 5 | 70% | $0.017 |
| flash-lite, ReCon for good | 11 of 20 | 19 | 8 | 69% | $0.021 |

- **On 3.8-flash ReCon hides Merlin, as the paper found.** Good wins the
  quests every game either way; the game is lost at the Assassin's guess.
  Without ReCon Merlin is found 19 times in 21 (his rejections of evil teams
  give him away); with it 12 in 20, and good wins 8 games against 2 (Fisher
  p 0.03), at the same cost.
- **Evil's contemplation takes back part of it.** With both sides thinking
  first, good wins 6 of 20: between no ReCon (2 of 21, p 0.13) and ReCon for
  good alone (8 of 20, p 0.74), the Assassin finding Merlin 14 times. Two
  contemplating sides cost 1.4 times as much a game ($0.17); the cost estimate
  from the earlier runs ($2.5 for 20) missed that, as it pools the system's
  runs across run variables.
- **On flash-lite there is nothing to hide from.** Its evil players join 70%
  of approved teams yet rarely play fail (good won three quests in 39
  of 40 games), and its Assassin finds Merlin 5 times in 20: good wins 15 of 20
  without ReCon, 11 with it (p 0.32).
- The paper's ReCon refines a draft of speech in a second pass; here
  thinking and answer are one call.

## The games on a stronger model

Each game setup here can be rerun with one command, with the server up:
`npx --no-install tsx scripts/simulate.mts paper-govsim --repeats 5 --on gemini --vars '{"greedy":true}' --usd 1`
starts the evaluation, waits, and prints every metric's mean, range and
values (the runs stay on the Evaluate and Compare pages).

The game experiments above ran on flash-lite. The key setups again on
gemini-3.8-flash (`on_model: gemini`, every player and critic on it), the
outcomes read from the runs' metrics; about $1.60 in all.

| Experiment | flash-lite | gemini-3.8-flash | gemma-4-26b (open weights) |
|---|---|---|---|
| GovSim, no greedy fisher, no talk: runs that kept the lake 12 months | 5 of 5 | 3 of 3 (100% efficiency) | |
| GovSim, one greedy fisher: months survived (5 runs; gemma 3) | 0, 2, 2, 2, 3 | 1, 1, 1, 1, 12 | 0, 0, 0 |
| GovSim, greedy, with the universalization prompt | 2, 3, 3, 8, 12 | 1, 1, 1, 2, 12 | |
| Auction Arena, common values: agents' profit per auction (all three) / rule bidder's | $900 / $500 | $1,900 / $1,200 | |
| Negotiation with the critic: deals, mean price (10 runs of 4 games; gemma 3 of 2) | 27 of 40 closed, $19–20 | 40 of 40, $16.33 | 6 of 6, $15.96 |
| Negotiation without the critic | 40 of 40, $19.46 | 40 of 40, $14.65 | 6 of 6, $17.61 |
| Werewolf (20 games): villagers won / with `seer_open` | 6 / 5 | 10 / 13 | |
| Prisoner's Dilemma against a one-time defector (5 games) | retaliates once; forgives 3, exploits 2 | `JF FJ JJ … JJ FJ` in all five | `JF FJ JJ … JJ FJ` in all five |
| Battle of the Sexes against an alternating partner: rounds coordinated | 6, 1, 10, 2, 1 | 8, 8, 8, 6, 8 | 8, 8, 7, 8, 8 |

- **The negotiation finding is the paper's on the stronger model, and the
  weak model's is not.** With 3.8-flash as seller, buyer and critic, the
  critic's advice raises the price from $14.65 to $16.33 and no deal is lost:
  every one of the ten coached runs averaged more than every uncoached run
  ($15.50 and up against $15.00 and down). On flash-lite the coached seller
  overreached past the buyer's limit and lost a third of its sales; a stronger
  buyer haggles to a lower price, and a stronger seller presses without
  breaking.
- **A stronger greedy fisher is greedier.** Told privately to catch "as much
  as you can get away with", 3.8-flash took 50 or 55 tons in the first month
  in four runs of five and the lake collapsed at once; in the fifth it took 10
  and the lake held twelve months. Flash-lite took 20 and the lake lasted two
  or three months. The others kept to 10 either way, and the universalization
  prompt changed nothing here.
- **Learning the pattern.** Against an alternating partner 3.8-flash found
  the alternation by the fifth round in every game (6 to 8 rounds of 10
  coordinated); flash-lite copied the last move and mostly missed. In the
  dilemma it retaliates once, forgives, and defects in the last round, in all
  five games alike: the end-game defection a fixed horizon invites.
- **More profit, more wins.** Its bidders kept twice as much ($1,900 an
  auction), still paying no item above its value; its villagers won half
  their games, and 13 of 20 when the seer was advised to speak (p 0.52 for
  10 against 13).

- **A third model, from another line, sides with the stronger one.** Gemma
  (open weights, free, 10 calls a minute; the cheaper setups only) played the
  dilemma exactly as 3.8-flash did, move for move in all five games, and
  found the alternation as it did; its greedy fisher took 80 to 95 tons in
  the first month and emptied the lake every time. Its negotiation is too
  small to read (three runs of two games, only the second coached, and the
  uncoached runs happened to price higher).

The findings that hold on all three: one greedy fisher ends the commons. On
the two measured for it: no bidder pays above value. Flash-lite is the odd
one in the repeated games: the two others follow the pattern and defect in
the last round. The ones that turn: whether coaching costs sales,
whether a player can follow a pattern, and how much a selfish note is obeyed.

## Older results on a stronger model

Several reasoning results above were measured on flash-lite only. The
clearest of them again on gemini-3.8-flash, on the same questions (GSM-Hard's
sample of 50 with seed 1, Hard computation's 30, the 20 long ledgers), one run
each, about $2.50; one agent on 3.8-flash is the control (40 and 41 on the
GSM-Hard sample, 26 and 27 on Hard computation, measured before).

| System | Set | flash-lite | gemini-3.8-flash | One agent, 3.8-flash |
|---|---|---|---|---|
| Self-Correct: first → after two rounds | GSM-Hard 50 | 38 → 35 (5 right → wrong, 0 back) | 39 → 41 (1 → wrong, 3 back); 42 → 42 (2, 2) | 40, 41 |
| CRITIC, execution shown: first → corrected | GSM-Hard 50 | 40 → 35 (15 → wrong, 3 back over two runs) | 42 → 37 (6 → wrong, 1 back) | 40, 41 |
| CAMEL | Hard computation 30 | 12, 14 | 21 | 26, 27 |
| AutoAgents | Hard computation 30 | 14, 14 | 25 | 26, 27 |
| Chain-of-Agents | Ledger totals 20 (~44,000 characters) | 13, 15 (one agent 9, 9) | 20 | 19 |
| MAD | Hard computation 30 | 14, 14 | 27 | 26, 27 |
| MacNet, star of 4 | Hard computation 30 | 23, 22 (+8 −1 against one agent) | 26 | 26, 27 |
| Meta-Prompting with Python | Game of 24 (50) | 43, 42 (one agent 30, 35) | 50 | 50 ($0.017, against $0.40) |

- **Held:** CRITIC's critique still costs answers (six right answers argued
  wrong for one fixed), and CAMEL's role-play still falls below one agent.
- **Turned:** intrinsic self-correction no longer hurts on the stronger
  model (a net two fixed), though it ends level with one agent; AutoAgents'
  deficit nearly closes (25 against 26 and 27).
- **Vanished:** Chain-of-Agents' gain was flash-lite's difficulty with a long
  ledger, not the chain's: one 3.8-flash agent reading the whole ledger gets
  19 of 20, the chain 20. So with MacNet's star (26, level with one agent)
  and Meta-Prompting with Python (50 of 50, as one agent alone at a
  twenty-third of the cost); MAD's loss vanishes the same way (27).
- **The pattern:** every gain measured on flash-lite against one agent is
  gone on 3.8-flash, where one agent is near the ceiling of these sets; two
  losses stay (CRITIC, CAMEL). A multi-agent gain on a weak model is a claim
  about that model's failures, to be rechecked on a strong one before it is
  made about the method.
- **The sets are too easy for 3.8-flash to test a gain.** Even MATH level 5
  (the same 50) is 48 of 50 for one 3.8-flash agent, at $0.06: the ceiling
  leaves a multi-agent system two questions to win. Testing whether these
  methods help a strong model needs harder sets. Competition problems from
  February 2026 (`benchmarks/competition-math`, fetched from MathArena at run
  time) are not hard enough either: one 3.8-flash agent solves AIME 2026 30 of
  30 and HMMT February 2026 31 of 33, $0.08 each. (HMMT first read 27: the
  `math` grader compared forms, and four right answers written differently,
  7\sqrt{3}/3 for \frac{7}{3}\sqrt{3} and the like, were marked wrong. It now
  compares the values of expressions without variables; regraded, no other
  earlier `math` answer changes on that account.)
- Self-correction's middle round dips (33 and 30 right) and the last
  recovers: 5 and 7 of the round-1 replies give no boxed answer, the rest
  change and change back.

## Hard code on a strong model: LiveCodeBench

The one set where gemini-3.8-flash is off the ceiling: LiveCodeBench's
hard AtCoder problems from January to April 2025 (`benchmarks/livecodebench`,
60 problems, stdin programs, standard library only, graded by the public and
up to ten hidden tests each in the Docker sandbox, 6 seconds a test). All on
3.8-flash; AgentCoder and MapCoder were run to the end in a second pass over
the problems their first, capped pass had not reached (MapCoder's spending
cap stopped it three short of 60).

| System | Solved | Against one agent on the same problems | Cost per problem |
|---|---|---|---|
| One agent | 46 of 60 (77%) | | $0.009 |
| One agent with a Python sandbox (two runs) | 40, 42 of 60 | +3 −9, +5 −9 | $0.021 |
| AgentCoder (programmer, test designer, executor) | 39 of 60 | +2 −9 (p 0.07) | $0.06 |
| MapCoder (recall, plan, code, debug) | 45 of 57 | 45 of the same 57: +3 −3 | $0.11 |
| Best of 10 against the samples (one model, no roles) | 48 of 60 | +3 −1 (p 0.63) | $0.016 |

- **Nothing beats one agent here either.** With room to gain (14 problems
  one agent misses), no system fixed more than five of them; AgentCoder and
  the sandbox agent lost more than they fixed, and MapCoder tied (+3 −3), at
  two to twelve times the cost.
- **On flash-lite the multi-agent coders win, and by a lot.** The same 60
  problems with every role on gemini-3.1-flash-lite:

  | flash-lite | Solved | Against one agent on the same problems | Cost per problem |
  |---|---|---|---|
  | One agent | 18 of 60 (30%) | | $0.002 |
  | One agent with a Python sandbox | 23 of 60 | +6 −1 (p 0.13) | $0.025 |
  | AgentCoder | 32 of 56 | +15 −0 (p 0.0001) | $0.094 |
  | MapCoder | 33 of 59 | +17 −2 (p 0.0007) | $0.07 |
  | Best of 5 against the samples (one model, no roles) | 28 of 60 | +14 −4 (p 0.03) | $0.006 |
  | Best of 10 against the samples | 32 of 60 | +16 −2 (p 0.001) | $0.010 |

  The gain is not the roles. `baseline-best-of-n` has one model write a
  program, run it on the statement's own sample tests in the sandbox, and
  write another until one passes them (up to n), keeping the one that passed
  most: with ten tries it solves 32, as many as AgentCoder (31 against 32 on
  the 56 AgentCoder reached, +5 −6) at a tenth of its cost. The sandbox agent
  alone gained little because it wrote one program and seldom tried again;
  what helps the weak model is more attempts checked against tests. On
  3.8-flash the same ten tries get 48 of 60 against one try's 46 (+3 −1):
  the strong model's first program is usually its best. It is a
  gain for the weak model only: on
  3.8-flash the same systems tie or lose, and one 3.8-flash agent (46 of 60,
  77%, $0.009 a problem) beats either system on flash-lite at a tenth of its
  cost. A team lifts a weak model toward a strong one; it does not lift the
  strong one.
- **On a weaker open model the set is hard indeed.** One gemma-4-26b agent
  (free, 10 calls a minute) solves 5 of a seeded 20 of these problems; most
  misses give no program at all, its thinking running past the output limit.
- **Tools cost the agent its answer.** The sandbox agent tested and retimed
  its programs until it ran out of steps, then returned "I ran out of steps
  before finishing" with no program, on 7 of its 20 misses.
- **Half of one agent's misses are its length.** Eight of its fourteen have
  no whole program: a long derivation cut at the output limit, or a program
  cut mid-line. The limit is the same for every system. Its thinking counts
  against the limit: rerun on its fourteen misses with 65,536 output tokens
  instead of 32,768, it solved 2, and seven others ran past the run's time
  limit still thinking. They are hard for it, not merely cut short.

## Earlier sets

The sets "Reasoning traps" (6) and "Competition" (20) are too easy for these
models: every system, including the single agent, scored 6/6 on gemini-2.5-flash
and 20/20 on gemini-3.1-flash-lite (after two grading fixes and a DyLAN fix,
see the git log).

## Running one yourself

On the Evaluate page, pick a system and a dataset (a built-in set, one you saved,
or questions you paste), optionally a seeded sample of it, choose
"Everything on <model>", and press Evaluate. Each case is an ordinary run you
can open and replay. A miss where a member marked the right answer on the way
says "had it: <member>" and groups under "a member had it, the team lost it".

### The controls a multi-agent system should beat

Every claimed gain on this page was checked against the same controls,
each one a system in the library, and each has explained away some gain:

| Control | System | What it rules out | Where it mattered |
| --- | --- | --- | --- |
| One agent | Single agent (baseline) | that the task needed more than one call | the reference for everything |
| Several samples and a vote | Self-consistency, or Agent Forest with `n` | that discussion beat plain voting | voting matched debate on both models |
| One call imagining the discussion | Solo Performance Prompting | that the gain needs separate agents | it matched debate on flash-lite, on gemma (25 and 26, both just below one agent's 27) and on medical MMLU |
| One agent with the same tools | Single agent with code | that the agents, not the tool, did the work | it matched AutoGen, Magentic-One and tool-equipped debate |
| For code: as many tries, checked by tests | Best of n against the samples | that the roles, not retrying, did the work | it matched AgentCoder on LiveCodeBench (flash-lite) at a tenth of the cost |

Run them on the same questions and models (on the Evaluate page, Compare with
other systems → Add the controls: for a code grader, one agent, one with a
sandbox and best of n; else the first four; or a batch), with repeats when the gaps are small, and read the paired column
(fixed, lost, p) on Compare rather than the accuracies alone.

To sweep a run variable, write its values with `|` in the Evaluate page's
variables: `n=2|4|8` queues one evaluation per value (per system, when others
are compared), one after another (`sweep: {name, values}` on
`POST /api/evals/batch`). The sweeps in this page (Agent Forest's N, debate's
rounds, MacNet's size) can be run that way.

To see systems side by side, open **Evaluate → Compare systems**. The page
groups every evaluation by the questions it ran. For each group it shows
accuracy, each repeat's score and the spread, the cost, and the cost per
correct answer. Below that is a grid of which system got each question right.
Older runs of the same system on the same models start unticked, and so do
evaluations that did not finish or in which no model answered.

**vs reference** compares each system with one reference (a baseline system
by default; click another's entry to switch), question by question: `+4 −0`
means it got 4 questions right that the reference got wrong, and lost none.
Its p-value is the exact McNemar test on those changed questions, the paired
test papers use for two systems on the same questions. With repeats, a
question counts as right when more than half the runs got it. Below p = 0.05
a difference is unlikely to be chance; with one run each, also repeat the
reference (MMLU above: a +4 at p = 0.13 vanished with two more runs). "Only
questions where they differ" cuts the grid down to the changed questions.

With a number, math or final-answer grader, the Evaluate page also checks
that every answer is **marked** ("Check that every answer is marked", on by
default; `expect: {type, marked: true}` in the API): a line `Answer: …`,
`Final: …` or `\boxed{…}`. An unmarked answer is graded on its last line,
which may be a check or a critique; such cases are flagged ("not the declared
result type: no answer line") and listed first among the failures. Grades do
not change. Four rebuilt papers (MedAgents, AgentVerse, AutoAgents,
AgentCoder) first lost points this way.

Run across the 14 paper templates that answer questions (5 questions of
Exact computation each, on flash-lite), the check found four more with the
same bug on their first run, all fixed:

| Template | Unmarked before | What it ended with | After the fix |
| --- | --- | --- | --- |
| CAMEL | 5 of 5 | "Solution: the task is fully complete. Next request." (the user's end marker never reached the stop condition: 40 rounds, $0.41) | 0 of 5, $0.01 |
| AutoGen | 2 of 5 | the code and TERMINATE, without its result | 0 of 5 |
| Magentic-One | 5 of 5 | the answer in prose; once graded on a digit from its working | 0 of 5 |
| ChatEval | 5 of 5 | a verdict with no value (it is built to judge answers, not to give one) | 0 of 5 |

The other ten (Debate, ReConcile, Agent Forest, EoT, DyLAN, MAD, MedAgents,
AgentVerse, AutoAgents, MoA) marked every answer.

**Flagged questions.** A question whose key cannot be right (or that has no
sensible answer) can be flagged as broken from Compare's grid (the flag
button, with a reason; `PUT /api/datasets/:id/flags`). A flag is a note on the
dataset, not a change to it: its version, and every evaluation of it, stay as
they are. Compare leaves flagged questions out of scores, spreads, paired
tests and exports ("Leave out N flagged questions", on by default) and shows
them struck through. The nine broken GSM-Hard questions below are flagged.

Each accuracy on Compare carries its 95% interval (Wilson): on 30
questions a score of 19 is 46–78%, so a single run of a 30-question set
says little; compare systems with the paired test on the same questions
(the "vs reference" column), and repeat a run before believing a gap.

Compare plots each ticked evaluation's accuracy against its cost per
question (log scale) and names the cost frontier: the evaluations nothing
cheaper is as accurate as. On Hard computation that frontier is the
systems that run code (AutoGen, Magentic-One); every discussion system sits
behind it.

**Check N misses with the judge** asks the LLM judge, one call per wrong
answer, whether each in fact agrees with the expected one. Grades stay as
they are; the ones it calls right point at a grader rule to fix (every MATH
grader fix here came from reading such misses: an interval written as an
inequality, a sum in another order, a vector in decimals). On the five
level-5 MATH evaluations, after those fixes, the judge agreed with the
grader on 31 of the 33 misses ($0.01); the other two were its own mistakes
(an unsolved equation accepted as its roots, 0.4995 from a simulation as
1/2). It points at what to check; it does not decide. Across every
evaluation here graded by rule (595 misses on Hard computation, GSM8K,
GSM-Hard, MMLU, MATH-500 and its level 5), it flagged 15: six were grader
errors, fixed and regraded (above and in the MATH-500 section); the rest
were systems ending on a line that is not the answer (a code fence, a
verification line, "she owes $27,398,229" for −27398229), which the rule
grades as written.

A case a provider fails in passing (overloaded, a 5xx, a dropped stream, a
rate limit) runs once more at the end of the evaluation, on its own; a second
failure counts. (Before this, three scores here counted such failures as
wrong answers: Mixture-of-Agents with three models, and the single agent and
ReConcile on gemma; each rose when retried.)

When a few cases of a long evaluation fail for want of an answer (a dropped
connection, a provider error, a stop or a restart), **Retry N failed** runs
only those again, in place, with the same models and settings; wrong answers
are results and are not retried.

An evaluation whose system calls a model with no key here is refused before
it starts, with the model and the component that uses it; use "Everything on
<model>" to run it on one you have.

### Datasets and code problems

Questions can be saved as a dataset (Evaluate → "Save these questions as a
dataset…", or `POST /api/datasets`). A dataset keeps where it came from, its
license, and a version that changes when its cases change, so two evaluations
with the same `set` id ran the same questions. GSM8K lines (`####` answers),
multiple choice (choices and a letter) and HumanEval records (`prompt`, `test`,
`entry_point`) are read as they come. Anything else can be turned into cases with
a small JavaScript adapter.

HumanEval-style problems are graded with "Code: run the tests". The last Python
block of the answer is run with the problem's tests in a fresh Docker container
(`python:3.12-slim`): no network, 512 MB, one CPU, 128 processes, a read-only
program, 10 seconds. A case passes when the tests pass.
