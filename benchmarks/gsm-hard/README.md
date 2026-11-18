# GSM-Hard

`gsmhardv2.jsonl`: 1,319 GSM8K test problems with their numbers replaced by
much larger ones, from https://huggingface.co/datasets/reasoning-machines/gsm-hard
(`gsmhardv2.jsonl`, the corrected version). Each record has `input` (the
question), `code` (a program that computes the answer) and `target` (the answer).

Gao et al., 2023, "PAL: Program-aided Language Models". MIT License.

Records in this shape are read as `{input, expected}` with the target as the
expected answer; grade them with "Number". The targets are often non-integer
or very large, so exact arithmetic (a code tool) matters more than on GSM8K.
