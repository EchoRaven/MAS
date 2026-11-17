# Benchmarks

These numbers come from the Evaluate page (`POST /api/evals`). Every system is
run with **Models: everything on one model**, so the comparison is about how
each system is put together, not which model it uses. The question sets ship
as the page's sample sets, and their answers are computed by program.

## Exact computation (30 questions), all on gemini-3.1-flash-lite

Long multiplication, date spans, letter counts, digit sums of powers, and
counts of coprime integers. 2026-11-17, one run per system unless noted.

| System | Correct | Cost | Per case |
| --- | --- | --- | --- |
| Single agent (baseline) | 25/30 (23, 25 and 27 over three runs) | $0.019 | 2.1 s |
| Self-consistency, 5 samples | 26/30 | $0.121 | 4.0 s |
| Multiagent debate (Du et al.) | 27/30 | $0.186 | 6.1 s |
| ReConcile (Chen et al.) | 28/30 | $0.168 | 5.0 s |
| DyLAN (Liu et al.) | 27/30 | $0.108 | 4.6 s |
| Mixture-of-Agents (Wang et al.) | 25/30 | $0.203 | 8.0 s |

What this does and does not show:

- Every system gains at most 3 questions over the single agent, at 6–11× the
  cost. A single agent's own score moves by 4 between runs. With 30 questions
  and one run each, **none of these differences is significant.**
- Self-consistency, five samples of one model, costs about the same as the
  multi-agent systems and lands in the same band. That matches what the
  critiques of multi-agent debate report (for example Smit et al. 2023,
  "Should we be going MAD?").
- The misses cluster on digit sums of large powers, where every system
  struggles. Mixture-of-Agents also corrupted three multiplications that its
  proposers had right: its aggregator recomputes instead of copying.

## Earlier sets

The sets "Reasoning traps" (6) and "Competition" (20) are too easy for these
models: every system, including the single agent, scored 6/6 on gemini-2.5-flash
and 20/20 on gemini-3.1-flash-lite (after two grading fixes and a DyLAN fix,
see the git log).

## Running one yourself

On the Evaluate page, pick a system and a sample set (or paste cases), choose
"Everything on <model>", and press Evaluate. Each case is an ordinary run you
can open and replay.
