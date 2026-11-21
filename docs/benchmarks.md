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
- **STORM is no better than one agent with the same search tool.** On ten
  recent topics it wins 7 and loses 12 over two runs (p 0.36), at 12 times the
  cost. Half or more of its links came from no search; one searching agent's
  links did ([STORM](#storm-articles-on-recent-topics-with-live-search)).
- **A writers' room loses to one writer on short stories.** Agents' Room
  (four planners and five section writers around a scratchpad) loses 0–10
  and 0–9 (one tie) to one call, judged pairwise in both orders. A second
  judge, gemma, gives 0–8 (two ties), and stories of about 2,000 words give
  0–9. It costs 7 to 15 times as much. Three setup
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
- **A model critiquing itself helps on reasoning, not arithmetic**
  (Self-Refine: MATH level 5 40 → 44; Hard computation revisions 4 right,
  3 wrong).
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
panel on the Evaluate page). A judge model reads both stories for each prompt,
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
| Long stories (about 2,000 words) | Single writer, long | 0 | 9 | 1 | $0.22 against $0.033 |

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
lost 0–9.

**Caveats.** The paper's agents are fine-tuned for each role. Here every
role is prompted flash-lite. Longer stories did not change the result, so
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

Every claimed gain on this page was checked against the same four controls,
each one a system in the library, and each has explained away some gain:

| Control | System | What it rules out | Where it mattered |
| --- | --- | --- | --- |
| One agent | Single agent (baseline) | that the task needed more than one call | the reference for everything |
| Several samples and a vote | Self-consistency, or Agent Forest with `n` | that discussion beat plain voting | voting matched debate on both models |
| One call imagining the discussion | Solo Performance Prompting | that the gain needs separate agents | it matched debate on flash-lite, on gemma (25 and 26, both just below one agent's 27) and on medical MMLU |
| One agent with the same tools | Single agent with code | that the agents, not the tool, did the work | it matched AutoGen, Magentic-One and tool-equipped debate |

Run them on the same questions and models (on the Evaluate page, Compare with
other systems → Add the four controls, or a batch), with repeats when the gaps are small, and read the paired column
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
