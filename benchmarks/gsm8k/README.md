# GSM8K sample

`test-sample-100.jsonl`: 100 problems from the GSM8K test set (1,319
problems), drawn at random with seed 20261118 (Python `random.Random(seed).sample`).
Each line keeps the original `question` and `answer`, where the final answer
follows `####`, and adds `index`, the line number in the original file.

Source: https://github.com/openai/grade-school-math (`grade_school_math/data/test.jsonl`).
GSM8K is by OpenAI (Cobbe et al., 2021, "Training Verifiers to Solve Math Word
Problems"), released under the MIT License, Copyright (c) 2021 OpenAI.

Load the file on the Evaluate page ("Load cases from a file…"). Records in this
shape are read as they are: the expected answer is the number after `####`.
Grade them with "Number".
