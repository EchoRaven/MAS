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

## Earlier sets

The sets "Reasoning traps" (6) and "Competition" (20) are too easy for these
models: every system, including the single agent, scored 6/6 on gemini-2.5-flash
and 20/20 on gemini-3.1-flash-lite (after two grading fixes and a DyLAN fix,
see the git log).

## Running one yourself

On the Evaluate page, pick a system and a sample set (or paste cases), choose
"Everything on <model>", and press Evaluate. Each case is an ordinary run you
can open and replay.

To see systems side by side, open **Evaluate → Compare systems**. The page
groups every evaluation by the questions it ran. For each group it shows
accuracy, each repeat's score and the spread, the cost, and the cost per
correct answer. Below that is a grid of which system got each question right.
Older runs of the same system on the same models start unticked.
