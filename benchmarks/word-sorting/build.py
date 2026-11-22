"""Word sorting in the format of BIG-Bench Hard's word_sorting task, generated from the system word list.

BBH asks "Sort the following words alphabetically: List: oven costume counterpart" and expects the words
sorted, space-separated. This generates 50 such lists of 12 to 20 lowercase words (letters only), seed 0.
Usage: python3 build.py /usr/share/dict/american-english > word-sorting-50.jsonl
"""
import json, random, sys

words = sorted({w.strip() for w in open(sys.argv[1]) if w.strip().isalpha() and w.strip().islower() and 3 <= len(w.strip()) <= 12})
rng = random.Random(0)
for _ in range(50):
    n = rng.randint(12, 20)
    pick = rng.sample(words, n)
    # half the lists share a first letter or two across several words, where sorting needs more than the first letter
    if rng.random() < 0.5:
        pre = rng.choice(pick)[:2]
        same = [w for w in words if w.startswith(pre) and w not in pick]
        pick[: n // 3] = rng.sample(same, min(n // 3, len(same)))
        rng.shuffle(pick)
    print(json.dumps({"input": "Sort the following words alphabetically: List: " + " ".join(pick), "expected": " ".join(sorted(pick))}))
