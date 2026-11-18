# HumanEval

`HumanEval.jsonl.gz`: the 164 problems of HumanEval, as published, from
https://github.com/openai/human-eval (`data/HumanEval.jsonl.gz`). Each record
has `task_id`, `prompt` (signature and docstring), `canonical_solution`,
`test` (a `check(candidate)` function) and `entry_point`.

Chen et al., 2021, "Evaluating Large Language Models Trained on Code".
MIT License, Copyright (c) 2021 OpenAI.

Records in this shape are read as code cases; grade them with "Code: run the
tests". Every `canonical_solution` passes its tests in the grader's sandbox
(`python:3.12-slim`, no network, 10 s): 164 of 164, checked 2026-11-18.
