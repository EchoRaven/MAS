# Benchmarks

These numbers come from the Evaluate page (`POST /api/evals`). Every system is
run with **Models: everything on one model**, so the comparison is about how
each system is put together, not which model it uses. The question sets ship
as the page's sample sets, and their answers are computed by program.

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
model alone gets about 19, so there is room to gain. Four systems, two runs
each, through the built-in dataset (2026-11-18):

| System | Runs | Mean | Cost (60 runs) |
| --- | --- | --- | --- |
| Single agent | 20, 18 | 19.0 | $0.05 |
| Self-consistency, 5 samples | 22, 22 | 22.0 | $0.31 |
| Multiagent debate (Du et al.) | 21, 21 | 21.0 | $0.50 |
| ReConcile (Chen et al.) | 22, 22 | 22.0 | $0.51 |

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

- **The gain comes from the first few samples.** N = 3 already reaches 22,
  where ReConcile and self-consistency stand (22.0). Past that the score moves
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

## Earlier sets

The sets "Reasoning traps" (6) and "Competition" (20) are too easy for these
models: every system, including the single agent, scored 6/6 on gemini-2.5-flash
and 20/20 on gemini-3.1-flash-lite (after two grading fixes and a DyLAN fix,
see the git log).

## Running one yourself

On the Evaluate page, pick a system and a dataset (a built-in set, one you saved,
or questions you paste), optionally a seeded sample of it, choose
"Everything on <model>", and press Evaluate. Each case is an ordinary run you
can open and replay.

To see systems side by side, open **Evaluate → Compare systems**. The page
groups every evaluation by the questions it ran. For each group it shows
accuracy, each repeat's score and the spread, the cost, and the cost per
correct answer. Below that is a grid of which system got each question right.
Older runs of the same system on the same models start unticked.

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
