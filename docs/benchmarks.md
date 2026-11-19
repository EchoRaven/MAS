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
| MAD (Liang et al.; angel, devil, judge) | 14, 14 | 14.0 | $0.23 |
| AgentVerse (recruit experts, execute, evaluate) | 20 | 20.0 | $0.29 |
| AutoAgents (generated team, observers, execution loop) | 13 | 13.0 | $0.13 |
| Exchange-of-Thought | 23 | 23.0 | $0.29 |
| DyLAN | 22 | 22.0 | $0.17 |
| Mixture-of-Agents | 17 | 17.0 | $0.24 |
| MedAgents | 15 | 15.0 | $0.34 |
| CAMEL role-playing | 12 | 12.0 | $0.11 |
| ChatEval | 12 | 12.0 | $0.19 |
| Magentic-One (its terminal runs code in the sandbox) | **30** | 30.0 | $0.06 |
| MacNet, chain of 4 | 19 | 19.0 | $0.31 |
| MacNet, star of 4 | 22 | 22.0 | $0.44 |
| MacNet, mesh of 4 | 21 | 21.0 | $0.47 |

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
  Systems that exchange or vote on answers gain 2–4: EoT 23, ReConcile and
  self-consistency 22, DyLAN 22, debate 21, AgentVerse 20; against the single
  agent (Compare, McNemar) EoT, debate and Agent Forest at N = 10 fix 7 and
  lose none (p = 0.02). Systems built around roles, personas or long
  pipelines score lower (MoA 17, MedAgents 15, MAD 14, AutoAgents 13, CAMEL
  12, ChatEval 12), but they fix about as many questions as they lose (MoA
  +6 −5, MedAgents +5 −6; p from 0.23 to 1): **no better than one agent**,
  not reliably worse. None of them checks by computing. (The rows after ReConcile were run later, once each,
  on the same 30 questions, with every answer checked for an answer line.)
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

## A weaker model: where the debate's gain appears

The papers report their gains with gpt-3.5-class models; on
gemini-3.1-flash-lite, a single agent already gets most questions it can get
at all. gemma-4-26b-a4b-it (an open model, about 4B active parameters, free
tier: 10 calls a minute here, 30 minutes per run) is weaker, and thinks at
length. Hard computation (30), one run each:

| System on gemma | Correct | Time |
| --- | --- | --- |
| Single agent | 17 | 48 min |
| Agent Forest, N = 5 (vote) | 25 | 92 min |
| Multiagent Debate, 2 rounds | **26** | 116 min |
| ReConcile, 3 rounds | 25 | 112 min |
| Single agent with a code runner | **30** | 8.5 min |

**+9 questions in 30: the first large gain from discussion on this platform.**
The debate fixed 10 questions and lost 1: all five date spans (#11–#15), all
four binomial coefficients mod p (#26–#29) and one digit sum (#9). On the
stronger model, debate gained 4 at most (19 → 23), and no system without a
tool ever solved the binomials. Here three gemma debaters, each slipping in
different places on long exact computations, correct each other: the setting
the paper describes.

Agent Forest fixed **the same nine questions** (all date spans and all
binomials); debate fixed one more (a digit sum, #9). So on the weaker model
both gain about 8–9 in 30, and five votes come within a question of three
debaters exchanging answers, as on the stronger model (where both gained
2–4). The gain grows with how often the model slips, and voting captures
almost all of it.

ReConcile (three gemma seats, confidence-weighted vote over three rounds)
lands in the same place: 25, missing #6–#10 (the digit sums and a long
product). One of those (#8) ended on a cut-off stream ("terminated") that
every system missed; model calls now retry a dropped connection three times.
Voting, debate and ReConcile all sit 8–9 above the single agent, and within
one question of each other. One agent that can run code solves all 30, in
a fourteenth of the time: the weaker model's slips are in long exact
arithmetic, and code removes them where three copies of the model only
outvote them.

On GSM8K gemma is too strong to show this: a single agent scores 95/100.

## MATH-500: a first sample

MATH-500 (competition math, five levels) leaves room even for a strong
model. 50 problems (seed 1), gemini-3.1-flash-lite, one run each, graded by
the math grader:

| System | Correct | Cost |
| --- | --- | --- |
| Single agent | 45 | $0.04 |
| Agent Forest, N = 5 | 45 | $0.21 |
| Multiagent Debate, 2 rounds | 46 | $0.31 |

Later, with code (the same 50, answer lines checked):

| System | Correct | vs single agent (44 this time) | Cost |
| --- | --- | --- | --- |
| Single agent with a code runner | **47** | +3 −0 (p 0.25) | $0.29 |
| Magentic-One (sandboxed terminal) | 45 | +2 −1 | $0.29 |
| Multiagent Debate, each debater with its own sandbox | 47 | +3 −0 | $1.14 |

Running code fixed three problems no text-only system got (#8, #13, #34)
and lost none: the best score on this sample, though three problems is not
yet significant. On 50 more problems (seed 2) the gap nearly closed (single
45, with code 46: +3 −2). Over the 100, code fixes 6 and loses 2 (p ≈ 0.29):
a small edge, not a demonstrated one. MATH's problems are mostly reasoning
with short arithmetic, so a code runner matters far less than on Hard
computation's long exact chains. Magentic-One's orchestration added nothing over one agent
with the same sandbox, as AutoGen's five agents did on Hard computation.
Neither did discussion: Multiagent Debate with a sandbox for each debater
(a system built for this comparison, not a template) scored the same 47 as
one agent with a sandbox, missing almost the same problems, at four times
the cost. Once the single agent has the same tool, three debaters exchanging
answers fix nothing it does not.

At about 90%, neither voting nor debate gains more than a question in 50.
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

On gemma-4-26b, the weaker model where debate gained 9 of 30 on Hard
computation, the same 100 questions:

| System on gemma | Correct | Time |
| --- | --- | --- |
| Single agent | 90 | 21 min |
| Multiagent Debate, 2 rounds | 89 | 62 min |

Debate fixed 2 questions and lost 3 (McNemar p = 1). **Even on the weaker
model, MMLU shows no gain.** gemma already gets 90% of these questions, and
its errors are knowledge errors (which of four facts is right), which three
copies of the same model share; on Hard computation its errors were slips in
long arithmetic, which differ between copies and get corrected. Discussion
fixes the errors that are independent between agents, and MMLU's are not.

## MedAgents on MMLU's medical questions

MedAgents (Tang et al.) evaluates on medical multiple choice. The 75 questions
of the MMLU sample in medicine and biology (dataset "MMLU · medical (75)"),
on gemini-3.1-flash-lite, one run each:

| System | Correct | vs single agent | Cost |
| --- | --- | --- | --- |
| Single agent | 71 | | $0.02 |
| Multiagent Debate | 73 | +2 −0 (p 0.5) | $0.21 |
| MedAgents (specialists, report, voted consultation) | 73 | +2 −0 (p 0.5) | $0.21 |

Both fixed the same two questions (#17 and #50) and missed the same two
(#20 and #25): a panel of named specialists does what three plain debaters
do, at the same cost. Two questions in 75 is within run-to-run noise.

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

| System | Passed | Cost |
| --- | --- | --- |
| Single agent | 48 | $0.03 |
| Single agent with a code runner | **49** | $0.18 |
| AgentCoder (programmer, test designer, executor) | 48 | $0.69 |
| MapCoder (one plan, up to 5 debugging rounds) | 48 | $0.37 |
| MapCoder as in the paper (3 plans tried best first, 5 rounds each) | 48 | $0.37 |
| Reflexion (test, reflect, retry) | 48 | $0.34 |

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
