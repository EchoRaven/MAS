# Stories

`prompts-10.jsonl`: ten short-story prompts written for this project, with no
expected answer. Run with grader `none` and compare two systems pairwise
(`POST /api/evals/pairwise`), as the writing papers (Agents' Room, STORM)
evaluate theirs.

`prompts-long-10.jsonl`: the same ten prompts asking for about 2,000 words
instead of about 600, closer to the long stories of the Agents' Room paper.

`prompts-30.jsonl`: the ten short-story prompts and twenty more like them, for comparisons where a
judge's position bias leaves most of ten pairs tied.
