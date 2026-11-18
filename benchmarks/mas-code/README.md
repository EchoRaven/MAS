# Coding problems (19)

`mas-code-19.jsonl`: 19 function-level Python problems in HumanEval form. Each
line has `task_id`, `prompt` (the signature and docstring), `test` (a
`check(candidate)` function) and `entry_point`. They cover parsing, intervals,
dynamic programming, simulation and edge cases. They were written for MAS
Studio, so no download is needed.

`problems.py` has the same problems with a reference solution for each.
`build.py` runs every reference against its tests in the Docker sandbox the
grader uses (`python:3.12-slim`, no network, 10 s), and rewrites the JSON
lines only if all of them pass:

    python3 -I benchmarks/mas-code/build.py

On the Evaluate page, pick the dataset "Coding problems (19)", or load the
file. Records in this shape become code cases, and the grader "Code: run the
tests" runs the answer's last Python block with the tests.
