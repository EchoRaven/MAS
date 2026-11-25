// Auction Arena (Chen et al.): bidders with budgets compete in ascending auctions for a series of items. The
// auctioneer, the prices, the budgets and the profits are code; every bid of an agent bidder is a model's. A rule
// bidder (bids while the price is below the item's value) is the paper's baseline.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

const BIDDERS: [string, string][] = [
  ["alice", "Alice"],
  ["bob", "Bob"],
  ["carol", "Carol"],
];

// items as the paper's: a starting price and a true value everyone knows, sold one after another
const AUCTIONEER = String.raw`const items = [
  { name: "Silver vase", start: 1000, value: 2000 },
  { name: "Oil painting", start: 2000, value: 6000 },
  { name: "Antique clock", start: 1000, value: 3000 },
  { name: "Gold watch", start: 3000, value: 10000 },
  { name: "Persian rug", start: 1000, value: 4000 },
  { name: "Marble statue", start: 2000, value: 8000 },
];
const budget0 = Number(ctx.vars.budget ?? 20000);
const step = 500;
// rule=false: three agent bidders only; by default a rule bidder joins them (the paper's baseline)
const withRule = !(ctx.vars.rule === false || ctx.vars.rule === "false");
const agents = __NAMES__;
const bidders = withRule ? [...agents, "Rule"] : agents;
const budget = Object.fromEntries(bidders.map((b) => [b, budget0]));
const profit = Object.fromEntries(bidders.map((b) => [b, 0]));
const won = Object.fromEntries(bidders.map((b) => [b, []]));
let overpaid = 0;
// private=true: each bidder values each item differently (0.8 to 1.2 times its listed value, rounded to $100) and
// knows only its own value, the paper's private-value setting; by default every bidder's value is the listed one
const priv = ctx.vars.private === true || ctx.vars.private === "true";
const valueOf = Object.fromEntries(bidders.map((b) => [b, items.map((x) => (priv ? Math.round((x.value * (0.8 + 0.4 * Math.random())) / 100) * 100 : x.value))]));
const story = [];
for (const [k, it] of items.entries()) {
  const leftFor = (b) => items.slice(k + 1).map((x, j) => x.name + " (worth $" + valueOf[b][k + 1 + j] + " to you)").join(", ") || "none";
  let price = it.start, leader = null;
  let active = bidders.filter((b) => budget[b] >= price);
  // rounds: each active bidder other than the leader raises by $500 or withdraws, in a shuffled order
  for (let round = 0; round < 40 && active.length > (leader ? 1 : 0); round++) {
    const order = active.filter((b) => b !== leader).map((b) => [Math.random(), b]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    if (!order.length) break;
    let raised = false;
    for (const b of order) {
      const ask = leader ? price + step : price;
      if (budget[b] < ask) { active = active.filter((x) => x !== b); continue; }
      let yes;
      if (b === "Rule") yes = ask < valueOf.Rule[k];
      else {
        const r = await tools.call_agent(b, "Item " + (k + 1) + " of " + items.length + ": " + it.name + ", worth $" + valueOf[b][k] + " to you" + (priv ? " (others may value it differently)" : "") + ". " +
          (leader ? "The highest bid is $" + price + " (" + (leader === b ? "yours" : "another bidder's") + ")." : "Bidding opens at $" + price + ".") +
          " Your budget left: $" + budget[b] + ". Items still to come: " + leftFor(b) + "." +
          "\nDo you bid $" + ask + "? End with a last line 'Bid' or 'Withdraw'.");
        yes = /\bbid\b/i.test(String(r).split("\n").pop() ?? "") && !/withdraw/i.test(String(r).split("\n").pop() ?? "");
      }
      if (yes) { price = ask; leader = b; raised = true; }
      else active = active.filter((x) => x !== b);
    }
    if (!raised) break;
  }
  if (leader) {
    budget[leader] -= price;
    const v = valueOf[leader][k];
    profit[leader] += v - price;
    won[leader].push(it.name);
    if (price > v) overpaid++;
    story.push(it.name + " (value $" + v + (priv ? " to " + leader : "") + "): " + leader + " for $" + price);
    emit(it.name, leader + " for $" + price);
  } else story.push(it.name + ": unsold");
}
const agentProfit = agents.reduce((s, a) => s + profit[a], 0);
metric("agent bidders' profit", agentProfit);
if (withRule) metric("rule bidder's profit", profit.Rule);
metric("items sold above their value", overpaid);
metric("items won by agents", agents.reduce((s, a) => s + won[a].length, 0));
return story.join("\n") + "\n\nProfit: " + bidders.map((b) => b + " $" + profit[b] + " (" + won[b].length + " items, $" + budget[b] + " left)").join(", ") +
  "\nItems sold above their value: " + overpaid + "\nAnswer: " + agentProfit;`.replace("__NAMES__", JSON.stringify(BIDDERS.map(([, n]) => n)));

function build(): SystemDoc {
  const b = new Builder(
    "Auction Arena",
    "Bidders with $20,000 each compete in ascending auctions for six items, one after another, each with a starting price and a value known to all. Three agent bidders and a rule bidder that bids while the price is below the value. The auctioneer, prices and budgets are code.",
  );
  b.node("host", "human", 0, 160, { name: "Host", role: "Starts the auction and reads the results", approves: false })
    .agent("auctioneer", 280, 140, { name: "Auctioneer", role: "Runs the auctions by the rules", model: "haiku", harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: AUCTIONEER }, instructions: "Run the auction." } })
    .edge("host", "auctioneer", "message", { label: "Start" })
    .edge("auctioneer", "host", "message", { label: "Results" });
  BIDDERS.forEach(([id, name], i) => {
    b.agent(id, 620, i * 140, {
      name,
      role: "Bidder",
      model: "haiku",
      harness: { ...native(), loop: "single_shot", instructions: `You are ${name}, a bidder in an auction of several items sold one after another. Your goal is to maximise your profit: the total value of the items you win minus what you pay for them, within your budget. Answer exactly what the auctioneer asks.` },
      // the bidder remembers the auction so far, as the paper's bidders keep their plans and the results
      context: { budget_total: 60000, history_strategy: "window", history_window: 40, mask_tool_output: false },
    });
    b.edge("auctioneer", id, "call");
  });
  b.doc.budget = { usd: 1, max_rounds: 400, wallclock_min: 30 };
  return b.doc;
}

export const auctionArena: TemplateInfo = {
  id: "paper-auction-arena",
  name: "Auction Arena",
  summary: "ascending auctions · budgets · agent bidders against a rule bidder",
  build,
  paper: { title: "Put Your Money Where Your Mouth Is: Evaluating Strategic Planning and Execution of LLM Agents in an Auction Arena", authors: "Chen et al.", year: 2023, url: "https://arxiv.org/abs/2310.05746" },
  notes: {
    mapped: [
      "The auctioneer is a custom loop: six items sold in turn, each from its starting price in $500 steps, a bidder dropping out when it withdraws or cannot afford the next bid; the winner pays its last bid. Prices, budgets and profits are code; each agent bidder's bid is a model's.",
      "The rule bidder bids while the price is below the item's value, the paper's baseline; rule=false leaves three agent bidders.",
      "Metrics: the agent bidders' and the rule bidder's profit, items sold above their value (to the winner), items won by agents.",
      "private=true gives each bidder its own value of each item (0.8 to 1.2 times the listed one) and tells it only its own, the paper's private-value setting.",
    ],
    differs: [
      "The paper's bidders plan, reflect and update beliefs between items in a structured way; here each answers each bid with what it remembers of the auction.",
      "By default every bidder values each item the same (the paper's common values); with private=true the values differ by a random factor rather than the paper's own draws.",
    ],
  },
};
