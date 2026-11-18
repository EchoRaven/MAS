# Coding problems (19)

`mas-code-19.jsonl`: 19 function-level Python problems in HumanEval form. Each
line has `task_id`, `prompt` (the signature and docstring), `test` (a
`check(candidate)` function) and `entry_point`. They cover parsing, intervals,
dynamic programming, simulation and edge cases. They were written for MAS
Studio, so no download is needed.

`mas-code-hard-12.jsonl`: 12 harder ones. They have exact specs with many
edge cases (text justification, a JSON parser, regex matching, a register
machine), performance limits (skyline, counting smaller elements, a median in
log time), and shortcuts the tests forbid and enforce (`json`, `re`, converting
2,000-digit strings to int, merging the lists).

`problems.py` and `problems_hard.py` have the same problems with a reference
solution for each. `build.py` runs every reference against its tests in the
Docker sandbox the grader uses (`python:3.12-slim`, no network, 10 s), and
rewrites the JSON lines only if all of them pass. `naive.py` checks that the
forbidden shortcuts fail:

    python3 -I benchmarks/mas-code/build.py
    python3 -I benchmarks/mas-code/build.py problems_hard
    python3 -I benchmarks/mas-code/naive.py

On the Evaluate page, pick the dataset "Coding problems (19)" or "Coding problems, hard (12)", or load the
file. Records in this shape become code cases, and the grader "Code: run the
tests" runs the answer's last Python block with the tests.
