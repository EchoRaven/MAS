"""Long-context lookup at four times the length: 20 ledgers of 2,800 transactions (~175,000 characters, ~45,000
tokens), each asking what one order (from the middle half) paid. The ledgers are built as in build.py, longer.
Run: python3 build_lookup_long.py > ledger-lookup-long-20.jsonl
"""
import json
import random

from build import FAMILIES, ITEMS, OTHERS

if __name__ == "__main__":
    rng = random.Random(20261122)
    for n in range(20):
        names = FAMILIES[n % len(FAMILIES)] + rng.sample(OTHERS, 12)
        rows = []
        for i in range(2800):
            month, day = rng.randint(1, 12), rng.randint(1, 28)
            rows.append(f"2024-{month:02d}-{day:02d} | order {10000 + i * 7 + rng.randint(0, 6)} | customer {rng.choice(names)} | {rng.choice(ITEMS)} | paid ${rng.randint(12, 980)}")
        row = rows[rng.randrange(len(rows) // 4, 3 * len(rows) // 4)]
        order = row.split(" | ")[1].split()[1]
        paid = row.rsplit("$", 1)[1]
        assert sum(1 for r in rows if f"| order {order} |" in r) == 1
        question = f"In this ledger, how many dollars did order {order} pay? Give the number."
        print(json.dumps({"input": f"{question}\n---\n" + "\n".join(rows), "expected": paid}))
