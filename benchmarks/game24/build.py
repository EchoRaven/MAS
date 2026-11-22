"""Game of 24 problems, generated: four numbers from 1 to 13 that can make 24 with + - * / and parentheses.

Meta-Prompting (Suzgun & Kalai 2024) and Tree of Thoughts use the 100 hardest of 4nums.com's 1,362 games
(ranked 901-1,000 by human solving time). This generates its own: every multiset of four numbers from 1 to 13 is
solved exhaustively, and the 50 with the fewest distinct solutions (ties broken at random, seed 0) are kept, as a
stand-in for "hardest". Usage: python3 build.py > game24-50.jsonl
"""
import itertools, json, random
from fractions import Fraction

def solutions(nums):
    found = set()
    def go(items):
        if len(items) == 1:
            if items[0][0] == 24:
                found.add(items[0][1])
            return
        for i, j in itertools.permutations(range(len(items)), 2):
            (a, ea), (b, eb) = items[i], items[j]
            rest = [items[k] for k in range(len(items)) if k not in (i, j)]
            cands = [(a + b, f"({ea} + {eb})"), (a - b, f"({ea} - {eb})"), (a * b, f"({ea} * {eb})")]
            if b != 0:
                cands.append((a / b, f"({ea} / {eb})"))
            for v, e in cands:
                go(rest + [(v, e)])
    go([(Fraction(n), str(n)) for n in nums])
    return found

games = []
for combo in itertools.combinations_with_replacement(range(1, 14), 4):
    s = solutions(combo)
    if s:
        games.append((len(s), combo, sorted(s, key=len)[0]))
rng = random.Random(0)
rng.shuffle(games)
games.sort(key=lambda g: g[0])
for n, combo, example in games[:50]:
    nums = " ".join(map(str, combo))
    print(json.dumps({"input": f"Let's play a game called 24. You'll be given four integers, and your objective is to use each number only once, combined with any of the four arithmetic operations (addition, subtraction, multiplication, and division) and parentheses, to achieve a total of 24. For example, if the input is 4, 7, 8, and 8, the output could be 7 * 8 - 4 * 8 = 24. You only need to find one feasible solution!\nInput: {', '.join(map(str, combo))}", "expected": nums, "example": example, "solutions": n}))
