# Articles

`recent-10.jsonl`: ten topics from 2024 to 2026, each asking for a Wikipedia-style article,
with no expected answer. They are recent so that what a model remembers may be out of date and
research has something to add, as STORM's paper evaluates on recent Wikipedia topics. Run with
grader `none` and compare systems pairwise (`POST /api/evals/pairwise`).
