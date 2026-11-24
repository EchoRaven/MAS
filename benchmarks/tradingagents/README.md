# TradingAgents backtest

A daily trading decision from prices alone, scored against the next day's move, in the form of TradingAgents'
backtest (Xiao et al. 2024: AAPL, GOOGL and AMZN, daily decisions, cumulative return, Sharpe ratio and maximum
drawdown against buy and hold).

The prices are not bundled. `backtest.py fetch DIR AAPL GOOGL AMZN` downloads a year of daily prices from Yahoo's
public chart endpoint into `DIR` (kept out of the repository, for example under `.data/market`), and
`backtest.py cases DIR 40 30 > cases.jsonl` writes one case per ticker and trading day for the last 40 days before
the last close, each showing the 30 trading days up to it (date, open, high, low, close, volume). `expected` holds
the ticker, the date and the next day's return, for scoring; run with grader `none`.

`backtest.py score EVAL.json …` reads evaluations as `GET /api/evals/:id` returns them and backtests each: the last
"Answer: BUY / SELL / HOLD" of a case is its action; BUY holds the stock for the next day, SELL holds cash, HOLD
keeps the last position (cash at the start), a long-only reading of the three actions.

Run `paper-tradingagents-backtest` (the firm with no approval step; its analysts are told to use only the prices
given) against `baseline` (one agent, one call). The paper's analysts also read news, social media and filings,
which are not connected here; and choose days after the models' training, so a model cannot recall the prices.
