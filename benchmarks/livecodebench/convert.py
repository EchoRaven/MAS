"""LiveCodeBench (code_generation_lite) as code cases with stdin/stdout tests, for the platform's code grader.

  curl -L -o test6.jsonl https://huggingface.co/datasets/livecodebench/code_generation_lite/resolve/main/test6.jsonl
  python3 -I convert.py test6.jsonl --platform atcoder --difficulty hard > lcb-v6-atcoder-hard.jsonl

Not bundled: fetched when needed. Each case is the problem statement with an instruction to write a whole Python
program; `expected` is a code spec with io tests: the public ones and up to --private (10) of the hidden ones whose
input is under --max-input (100,000) characters, so a case stays small. The hidden tests are stored as
base64(zlib(pickle(json))); they are unpickled by an unpickler that refuses every class lookup, so the file can hold
only plain strings, lists and dicts and no code runs. LeetCode problems (a class with a method) are left out: they
are not stdin programs.
"""
import argparse
import base64
import io
import json
import pickle
import sys
import zlib


class DataOnly(pickle.Unpickler):
    def find_class(self, module, name):
        raise pickle.UnpicklingError(f"refusing {module}.{name}: only plain data is read")


def hidden(blob: str):
    raw = zlib.decompress(base64.b64decode(blob))
    return json.loads(DataOnly(io.BytesIO(raw)).load())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--platform", default="atcoder")
    ap.add_argument("--difficulty", default="hard")
    ap.add_argument("--private", type=int, default=10)
    ap.add_argument("--max-input", type=int, default=100_000)
    a = ap.parse_args()
    n = 0
    for line in open(a.file):
        r = json.loads(line)
        if r["platform"] != a.platform or (a.difficulty != "all" and r["difficulty"] != a.difficulty):
            continue
        tests = [t for t in json.loads(r["public_test_cases"]) if t.get("testtype") == "stdin"]
        priv = [t for t in hidden(r["private_test_cases"]) if t.get("testtype") == "stdin" and len(t["input"]) < a.max_input]
        tests += priv[: a.private]
        if not tests:
            continue
        spec = {"kind": "code", "test": "", "io": [{"input": t["input"], "output": t["output"]} for t in tests], "seconds": 120, "per_test": 6}
        prompt = (r["question_content"].strip() + "\n\nWrite a complete Python 3 program that reads the input from standard input and prints the answer "
                  "to standard output, using only Python's standard library (no numpy). Put the whole program in one ```python block.")
        print(json.dumps({"input": prompt, "expected": json.dumps(spec), "id": r["question_id"], "date": r["contest_date"][:10]}))
        n += 1
    print(f"{n} problems", file=sys.stderr)


main()
