// TradingAgents: a trading firm as agents — analysts report in parallel, bull
// and bear researchers debate, a trader proposes a trade, a risk team debates
// it, and a fund manager approves before anything is executed.
import { Builder, native, type TemplateInfo } from "../builder";
import { port } from "../ports";
import type { SystemDoc } from "../types";

const ANALYSTS: [string, string, string][] = [
  ["fundamentals", "Fundamentals analyst", "Assess the company's financial health: revenue, margins, debt, cash flow, valuation."],
  ["sentiment", "Sentiment analyst", "Assess what investors and the public feel about the company right now, and why."],
  ["news", "News analyst", "Assess recent news and macroeconomic events that bear on the company."],
  ["technical", "Technical analyst", "Assess the price action: trend, momentum, support and resistance, volatility."],
];
const RISK: [string, string, string][] = [
  ["risky", "Aggressive risk analyst", "Argue for taking the opportunity: what upside does caution give away?"],
  ["neutral", "Neutral risk analyst", "Weigh both sides evenly and argue for a balanced position."],
  ["safe", "Conservative risk analyst", "Argue for protecting capital: what could go wrong, and how badly?"],
];

// in a backtest the analysts see only the prices in the request: the news, sentiment and fundamentals analysts
// must not invent what they were not given (the paper's data feeds are not connected)
const ONLY_GIVEN = " Use only the data in the request. Where it has nothing for your part (no news, no filings, no posts), say so and keep your outlook neutral rather than guessing.";

/** backtest: no person approves (an evaluation runs unattended) and the risk manager ends with the final action */
function build(backtest = false): SystemDoc {
  const b = new Builder(
    backtest ? "TradingAgents (backtest)" : "TradingAgents",
    "A trading firm as agents. Four analysts report in parallel; a bull and a bear researcher debate the reports and a research manager writes the investment plan; a trader turns it into a trade; three risk analysts debate the trade; the risk manager adjusts it; and a fund manager — a person — approves it before it is placed.",
  );
  b.schema({
    id: "Trade",
    description: "A proposed trade",
    json_schema: '{\n  "type": "object",\n  "required": ["action", "size_pct", "rationale"],\n  "properties": {\n    "action": { "enum": ["BUY", "SELL", "HOLD"] },\n    "size_pct": { "type": "number", "minimum": 0, "maximum": 100 },\n    "rationale": { "type": "string" }\n  }\n}',
  });
  b.node("client", "human", 0, 220, { name: "Client", role: "Names the stock and the date", approves: false });

  // 1. analysts, in parallel, joined once all four have reported
  ANALYSTS.forEach(([id, name, task], i) =>
    b.agent(id, 260, i * 130, { name, role: task.split(":")[0], model: "haiku", harness: { ...native(), loop: "single_shot", instructions: `${task} Write a short report ending with your outlook: bullish, bearish or neutral.${backtest ? ONLY_GIVEN : ""}` } }),
  );
  b.node("reports", "function", 540, 200, {
    name: "All four reports",
    join: "all",
    fn: { lang: "js", code: "return { role: 'user', text: Object.entries(input).map(([k, v]) => '## ' + k + '\\n' + (v.text ?? v)).join('\\n\\n') };" },
    interface: { inputs: ANALYSTS.map(([id]) => port(id, "message", { required: true })), outputs: [port("out", "message")] },
  });

  // 2. the bull and the bear debate the reports, round after round
  b.group("research", 800, 160, { name: "Investment debate", iterate: { max_rounds: 2, until: null, feed: "input_and_output" }, interface: { inputs: [port("reports", "message")], outputs: [port("debate", "message")] } })
    .agent("bull", 0, 0, { name: "Bull researcher", role: "Argues to buy", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Make the strongest evidence-based case for investing, answering the bear's last points directly." } }, "research")
    .agent("bear", 320, 0, { name: "Bear researcher", role: "Argues against", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Make the strongest evidence-based case against investing, answering the bull's last points directly." } }, "research")
    .edge("research", "bull", "message")
    .edge("bull", "bear", "handoff", { carry: "full" })
    .edge("bear", "research", "handoff", { carry: "full" })
    .agent("research_manager", 1120, 160, { name: "Research manager", role: "Judges the debate", model: "opus", harness: { ...native(), loop: "single_shot", instructions: "You judge the investment debate. Decide which side argued better, and write an investment plan: the stance, the reasons, and what would change your mind." } });

  // 3. the trader turns the plan into a trade
  b.agent("trader", 1400, 160, {
    name: "Trader",
    role: "Proposes the trade",
    model: "sonnet",
    interface: { inputs: [port("in", "message")], outputs: [port("out", "json", { schema: "Trade" })] },
    pipeline: { pre: [], post: [{ id: "p1", op: "parse_json", name: "Parse trade", schema: "Trade", on_fail: "retry", max_retries: 2 }] },
    harness: { ...native(), loop: "single_shot", instructions: "Turn the investment plan into one concrete trade: action, size as a percentage of the portfolio, and the rationale." },
  });

  // 4. the risk team debates the trade, one view after another
  b.group("risk", 1680, 160, { name: "Risk debate", iterate: { max_rounds: 1, until: null, feed: "output" }, interface: { inputs: [port("trade", "message")], outputs: [port("assessment", "message")] } });
  RISK.forEach(([id, name, stance], i) => b.agent(id, i * 300, 0, { name, role: stance.split(":")[0], model: "haiku", harness: { ...native(), loop: "single_shot", instructions: `${stance} Respond to the proposed trade and to the other analysts so far.` } }, "risk"));
  b.edge("risk", "risky", "message").edge("risky", "neutral", "handoff", { carry: "full" }).edge("neutral", "safe", "handoff", { carry: "full" }).edge("safe", "risk", "handoff", { carry: "full" });

  // 5. the risk manager adjusts the trade, and the fund manager approves it
  if (backtest)
    b.agent("risk_manager", 1960, 160, { name: "Risk manager", role: "Decides the final trade", model: "opus", harness: { ...native(), loop: "single_shot", instructions: "Weigh the risk debate and decide the final trade for the next trading day (it may be smaller than proposed, or HOLD). End with a last line exactly 'Answer: BUY', 'Answer: SELL' or 'Answer: HOLD'." } });
  else
    b.agent("risk_manager", 1960, 160, { name: "Risk manager", role: "Decides the final trade", model: "opus", harness: { ...native(), instructions: "Weigh the risk debate and decide the final trade (it may be smaller than proposed, or HOLD). Before it can be placed, ask the fund manager to approve it. Then report the decision and whether it was approved." } })
      .node("fund_manager", "human", 2240, 300, { name: "Fund manager", role: "Approves trades before they are placed", approves: true });
  b.edge("client", "fundamentals", "message", { label: "Ticker and date" });
  for (const [id] of ANALYSTS.slice(1)) b.edge("client", id, "message");
  for (const [id] of ANALYSTS) b.edge(id, "reports", "message", { target_port: id });
  b.edge("reports", "research", "message")
    .edge("research", "research_manager", "message")
    .edge("research_manager", "trader", "message", { label: "Investment plan" })
    .edge("trader", "risk", "message", { transform: { lang: "template", code: "Proposed trade: {{input.action}} {{input.size_pct}}% of the portfolio.\nRationale: {{input.rationale}}" } })
    .edge("risk", "risk_manager", "message")
    .edge("risk_manager", "client", "message", { label: "Decision" });
  if (!backtest) b.edge("risk_manager", "fund_manager", "call", { label: "Approve the trade?" });
  b.doc.entry = { node: "client" };
  b.doc.budget = { usd: 2, max_rounds: 30, wallclock_min: 20 };
  return b.doc;
}

export const tradingagents: TemplateInfo = {
  id: "paper-tradingagents",
  name: "TradingAgents",
  summary: "analyst team · bull/bear debate · trader · risk debate · human approval",
  build,
  paper: { title: "TradingAgents: Multi-Agents LLM Financial Trading Framework", authors: "Xiao et al.", year: 2024, url: "https://arxiv.org/abs/2412.20138" },
  notes: {
    mapped: [
      "The firm's teams are the paper's: four analysts work in parallel and a join-all function waits for every report.",
      "The bull and bear researchers debate in a group that repeats for two rounds; a full handoff carries the whole debate between them and out to the research manager, who judges it and writes the plan.",
      "The trader's trade is structured output (a Trade schema: action, size, rationale), parsed and checked before the risk team sees it.",
      "The risk team's three views follow one another in a group, each handed what was said before; the risk manager decides the final trade and must get a person's approval (a call to the fund manager) before it is placed.",
    ],
    differs: [
      "The analysts have no market data here: they reason from what the models know. Connect data sources as tools (an MCP env for prices, news and filings) to give them the paper's inputs.",
      "No order is placed: the decision is reported. The backtest variant decides one day from the prices given, with no approval step, and benchmarks/tradingagents scores its decisions against the next day's moves (long only).",
    ],
  },
};

// a day's decision from prices alone, scored against the next day's move (benchmarks/tradingagents)
export const tradingagentsBacktest: TemplateInfo = {
  ...tradingagents,
  id: "paper-tradingagents-backtest",
  name: "TradingAgents (backtest)",
  summary: "the same firm deciding one trading day from the prices given, with no approval step: for backtests",
  build: () => build(true),
};
