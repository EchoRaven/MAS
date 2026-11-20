"""Long-context aggregation: a ledger of ~700 transactions and one question about it.

Each item asks for the total one customer paid. Their purchases (8 to 14 of them) are scattered through the
ledger among ~690 others, including customers with look-alike names (Harlow, Harlowe, Marlow), so a reader must
find every one and add them exactly. The answer is computed here. Run: python3 build.py > ledger-20.jsonl
"""
import json
import random

FAMILIES = [
    ["Harlow", "Harlowe", "Marlow", "Harlan"],
    ["Ashby", "Ashbey", "Asbury", "Ashton"],
    ["Linden", "Lindon", "Lyndon", "Linton"],
    ["Corrigan", "Corrigen", "Carrigan", "Corrick"],
    ["Whitfield", "Whitfeld", "Whitford", "Whitley"],
]
OTHERS = ["Abbott", "Barlow", "Cade", "Dunmore", "Ellery", "Fenwick", "Garrow", "Hale", "Ibsen", "Jarrell", "Keaton",
          "Lomax", "Mercer", "Nash", "Oakes", "Pryor", "Quill", "Rook", "Sable", "Tolland", "Upton", "Vance", "Wren",
          "Yates", "Zeller"]
ITEMS = ["lamp", "kettle", "rug", "chair", "shelf", "mirror", "clock", "vase", "desk", "stool", "blanket", "basket"]


def item(rng: random.Random, n: int):
    family = FAMILIES[n % len(FAMILIES)]
    target = family[rng.randrange(len(family))]
    names = family + rng.sample(OTHERS, 12)
    rows = []
    k = rng.randint(8, 14)
    for _ in range(k):
        rows.append((target, rng.randint(12, 980)))
    while len(rows) < 700:
        name = rng.choice([x for x in names if x != target])
        rows.append((name, rng.randint(12, 980)))
    rng.shuffle(rows)
    lines = []
    for i, (name, amount) in enumerate(rows):
        month, day = rng.randint(1, 12), rng.randint(1, 28)
        lines.append(f"2024-{month:02d}-{day:02d} | order {10000 + i * 7 + rng.randint(0, 6)} | customer {name} | {rng.choice(ITEMS)} | paid ${amount}")
    total = sum(a for nm, a in rows if nm == target)
    question = f"In this ledger, what is the total amount, in dollars, that customer {target} paid across all of their orders? Count only the customer named exactly {target}. Give the number."
    return {"input": f"{question}\n---\n" + "\n".join(lines), "expected": str(total), "orders": k}


if __name__ == "__main__":
    rng = random.Random(20261120)
    for n in range(20):
        it = item(rng, n)
        print(json.dumps({"input": it["input"], "expected": it["expected"]}))
