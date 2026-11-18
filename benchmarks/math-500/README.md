# MATH-500

`test.jsonl`: the 500 MATH test problems used in "Let's Verify Step by Step",
from https://github.com/openai/prm800k (`prm800k/math_splits/test.jsonl`).
Each record has `problem`, `solution` (a worked solution ending in
`\boxed{…}`), `answer`, `subject`, `level` (1–5) and `unique_id`.

Hendrycks et al., 2021, "Measuring Mathematical Problem Solving With the MATH
Dataset"; the 500-problem split is from Lightman et al., 2023. MIT License,
Copyright (c) 2023 OpenAI.

Grade with "Math (LaTeX)": the last `\boxed{}` (or the final answer line) is
compared with `answer` after the MATH benchmark's normalisation. Checked
2026-11-18: each problem's own `solution` grades right against its `answer`
(500 of 500), and a solution graded against another problem's answer passes
only when the two answers really are equal (3 of 500 pairs).
