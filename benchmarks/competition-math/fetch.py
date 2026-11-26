"""Recent competition math, fetched at run time (not bundled: MathArena's sets are CC BY-NC-SA 4.0).

  python3 fetch.py aime_2026 > aime-2026.jsonl          # 30 problems, integer answers: grade with number
  python3 fetch.py hmmt_feb_2026 > hmmt-feb-2026.jsonl  # 33 problems, LaTeX answers: grade with math

Each line is {"input": problem + an answer-line instruction, "expected": answer}, from the Hugging Face dataset
MathArena/<name> through its public rows API.
"""
import json
import sys
import urllib.request

name = sys.argv[1]
url = f"https://datasets-server.huggingface.co/rows?dataset=MathArena/{name}&config=default&split=train&offset=0&length=100"
rows = [r["row"] for r in json.loads(urllib.request.urlopen(url, timeout=60).read())["rows"]]
for r in sorted(rows, key=lambda r: r["problem_idx"]):
    print(json.dumps({"input": r["problem"].strip() + "\n\nEnd with a last line 'Answer: <the final answer>'.", "expected": str(r["answer"])}))
print(f"{len(rows)} problems from MathArena/{name}", file=sys.stderr)
