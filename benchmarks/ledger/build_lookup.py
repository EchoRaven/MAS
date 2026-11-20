"""Long-context lookup: the same 20 ledgers as ledger-20.jsonl, each asked about one order.

Where ledger-20 asks for a total over 8 to 14 scattered orders (aggregation), this asks what one order, named by
its number, paid: the answer is on a single line somewhere in ~44,000 characters (a needle). The order is picked
from the middle half of the ledger, where long inputs are said to be read worst. Run:
python3 build_lookup.py > ledger-lookup-20.jsonl
"""
import json
import random
import re

if __name__ == "__main__":
    rng = random.Random(20261121)
    for line in open("ledger-20.jsonl"):
        item = json.loads(line)
        doc = item["input"].split("\n---\n", 1)[1]
        rows = doc.split("\n")
        row = rows[rng.randrange(len(rows) // 4, 3 * len(rows) // 4)]
        m = re.match(r"\S+ \| order (\d+) \| customer (\w+) \| (\w+) \| paid \$(\d+)$", row)
        order, customer, thing, paid = m.groups()
        # order numbers are unique in a ledger (consecutive bases 7 apart, an offset under 7)
        assert sum(1 for r in rows if f"| order {order} |" in r) == 1
        question = f"In this ledger, how many dollars did order {order} pay? Give the number."
        print(json.dumps({"input": f"{question}\n---\n{doc}", "expected": paid}))
