"""TradingAgents backtest: daily decisions from prices alone, scored against the next day's move.

  python3 backtest.py fetch DIR AAPL GOOGL AMZN      download a year of daily prices (Yahoo's chart endpoint) into DIR
  python3 backtest.py cases DIR DAYS LOOKBACK         one case per ticker and trading day, the last DAYS days before the
                                                      last close, each showing the LOOKBACK days up to it (JSON lines)
  python3 backtest.py score EVAL.json [EVAL.json …]   a long-only backtest per evaluation (as GET /api/evals/:id returns)

The prices are not bundled: they are fetched when needed. A decision on day t sees closes up to t; it earns the move
from t's close to the next close. BUY holds the stock, SELL holds cash, HOLD keeps the last position (cash at the
start), as the paper's long-only reading of the three actions.
"""
import json
import math
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def fetch(out: Path, tickers):
    out.mkdir(parents=True, exist_ok=True)
    for t in tickers:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?range=1y&interval=1d"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        (out / f"{t}.json").write_bytes(urllib.request.urlopen(req, timeout=60).read())
        print("fetched", t, file=sys.stderr)


def bars(path: Path):
    r = json.loads(path.read_text())["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    rows = []
    for i, ts in enumerate(r["timestamp"]):
        if None in (q["open"][i], q["high"][i], q["low"][i], q["close"][i]):
            continue
        rows.append({"date": datetime.fromtimestamp(ts, timezone.utc).date().isoformat(), "open": q["open"][i], "high": q["high"][i], "low": q["low"][i], "close": q["close"][i], "volume": q["volume"][i] or 0})
    # today's bar may be an unfinished day: drop a bar dated today
    if rows and rows[-1]["date"] == datetime.now(timezone.utc).date().isoformat():
        rows.pop()
    return rows


def cases(src: Path, days: int, lookback: int):
    for f in sorted(src.glob("*.json")):
        t = f.stem
        rows = bars(f)
        # each decision day needs a next close to be scored
        for i in range(len(rows) - 1 - days, len(rows) - 1):
            seen = rows[i - lookback + 1 : i + 1]
            table = "\n".join(f"{r['date']}, {r['open']:.2f}, {r['high']:.2f}, {r['low']:.2f}, {r['close']:.2f}, {r['volume']}" for r in seen)
            nxt = rows[i + 1]["close"] / rows[i]["close"] - 1
            print(json.dumps({
                "input": f"Ticker: {t}. It is {rows[i]['date']}, after the close. Decide the trade for the next trading day.\nDaily prices for the last {lookback} trading days (date, open, high, low, close, volume):\n{table}",
                "expected": json.dumps({"ticker": t, "date": rows[i]["date"], "next_return": round(nxt, 6)}),
            }))


# the last answer line, as the platform's grader reads one ("Answer:", "Final answer:", "Final:"), in any case: a
# single agent writes "Final: Buy"
ACTION = re.compile(r"(?:final answer|answer|final|decision)\W*\s*(buy|sell|hold)\b", re.I)


def action(output: str):
    m = ACTION.findall(output or "")
    if m:
        return m[-1].upper()
    m = re.findall(r"\b(buy|sell|hold)\b", output or "", re.I)
    return m[-1].upper() if m else None


def stats(rets):
    n = len(rets)
    cum = math.prod(1 + r for r in rets) - 1
    mean = sum(rets) / n
    sd = math.sqrt(sum((r - mean) ** 2 for r in rets) / (n - 1)) if n > 1 else 0
    peak, dd, v = 1.0, 0.0, 1.0
    for r in rets:
        v *= 1 + r
        peak = max(peak, v)
        dd = max(dd, 1 - v / peak)
    return {"return": cum, "sharpe": mean / sd * math.sqrt(252) if sd else 0.0, "max_drawdown": dd}


def score(paths):
    for p in paths:
        e = json.loads(Path(p).read_text())
        e = e.get("eval", e)
        by = {}
        missing = 0
        for c in e["cases"]:
            x = json.loads(c["expected"])
            a = action(c.get("output") or "")
            missing += a is None
            by.setdefault(x["ticker"], []).append((x["date"], a, x["next_return"]))
        # direction: a BUY before a rise or a SELL before a fall is a hit; HOLD calls no direction
        calls = [(a, r) for ds in by.values() for _, a, r in ds if a in ("BUY", "SELL") and r != 0]
        hits = sum(1 for a, r in calls if (a == "BUY") == (r > 0))
        n = len(calls)
        # two-sided binomial p against a coin
        k = min(hits, n - hits)
        p = min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n) if n else 1.0
        print(f"{e['id']} {e.get('system_name')} · no action in {missing} of {len(e['cases'])} · direction right {hits} of {n} calls (p {p:.2f} against a coin)")
        for t, days in sorted(by.items()):
            days.sort()
            pos, strat, hold, acts = 0, [], [], {"BUY": 0, "SELL": 0, "HOLD": 0, None: 0}
            for _, a, r in days:
                acts[a] += 1
                pos = 1 if a == "BUY" else 0 if a == "SELL" else pos
                strat.append(pos * r)
                hold.append(r)
            s, h = stats(strat), stats(hold)
            print(f"  {t}: {len(days)} days, BUY {acts['BUY']} SELL {acts['SELL']} HOLD {acts['HOLD']}"
                  f" · return {s['return']:+.1%} (buy and hold {h['return']:+.1%}) · Sharpe {s['sharpe']:.2f} ({h['sharpe']:.2f})"
                  f" · max drawdown {s['max_drawdown']:.1%} ({h['max_drawdown']:.1%})")


if __name__ == "__main__":
    cmd, *rest = sys.argv[1:]
    if cmd == "fetch":
        fetch(Path(rest[0]), rest[1:])
    elif cmd == "cases":
        cases(Path(rest[0]), int(rest[1]), int(rest[2]))
    elif cmd == "score":
        score(rest)
