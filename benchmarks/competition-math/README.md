# Recent competition math

Problems from competitions held after the models' training, so a strong model is not at the ceiling and cannot
recall the answers: AIME 2026 (30 problems, integer answers) and HMMT February 2026 (33, answers in LaTeX). From
MathArena's sets on Hugging Face (`MathArena/aime_2026`, `MathArena/hmmt_feb_2026`), licensed CC BY-NC-SA 4.0,
so they are fetched when needed and not bundled: `python3 fetch.py aime_2026 > aime-2026.jsonl`.

Load the JSON lines as a dataset (Datasets → New, or `POST /api/datasets`) and grade AIME with `number`, HMMT with
`math` (which compares LaTeX expressions).
