# MMLU (sample of 500)

`test-sample-500.jsonl`: 500 questions drawn at random (seed 20261118,
Python `random.Random(seed).sample`) from the 14,042 MMLU test questions, in
their original order. Each line keeps `subject`, `question`, `choices` (four
options) and `answer` (the index of the right one), and adds `index`, the
row in the full test split.

Source: the `cais/mmlu` dataset (config `all`, split `test`) on Hugging Face,
read through its datasets-server API. Hendrycks et al., 2021, "Measuring
Massive Multitask Language Understanding". MIT License.

Records in this shape are read as multiple choice: the options are lettered
A–D and the expected answer is the letter. Grade with "Final answer".
