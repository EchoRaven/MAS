# Instructions

`open-20.jsonl`: twenty open-ended requests (explain, advise, write, plan, compare), written for this
project in the style of instruction-following sets such as AlpacaEval, with no expected answer. Run with
grader `none` and compare systems pairwise (`POST /api/evals/pairwise`), as Mixture-of-Agents reports its
win rates.

`open-30b.jsonl`: thirty more requests of the same kinds, written for this project, to add to the twenty
when two systems are too close to tell apart on twenty.
