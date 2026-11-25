// Negotiation with AI feedback (Fu et al.): a seller and a buyer bargain over a balloon; after each deal a critic
// gives the seller advice, which it takes into the next negotiation. The turns, the offers, the deal and the
// accumulated advice are code; every message is an agent's.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

const REFEREE = String.raw`const games = Number(ctx.vars.games ?? 4);
// a buyer told to pay "$10 or less" held to it and no game of four closed in 10 messages; one who would "rather buy
// than walk away" paid $35 for a $20 balloon: 16 messages, and a buyer who wants it but not above the list price
const turns = Number(ctx.vars.turns ?? 16);
// feedback=false: no critic between games, the control for how prices drift on their own
const feedback = !(ctx.vars.feedback === false || ctx.vars.feedback === "false");
const offerOf = (t) => { const m = [...String(t).matchAll(/offer\W*\s*\$?\s*(\d+(?:\.\d+)?)/gi)]; return m.length ? Number(m[m.length - 1][1]) : null; };
const accepts = (t) => /\b(accept|deal)\b/i.test(String(t).split("\n").pop() ?? "") && !/\bnot? (accept|deal)\b/i.test(String(t));
const advice = [];
const prices = [];
const story = [];
for (let g = 1; g <= games; g++) {
  const said = [];
  let last = { seller: null, buyer: null };
  let price = null;
  for (let t = 0; t < turns && price === null; t++) {
    const who = t % 2 === 0 ? "Seller" : "Buyer";
    const other = who === "Seller" ? "buyer" : "seller";
    const brief = who === "Seller"
      ? "You are selling a balloon. Its listed price is $20. Get as high a price as you can." + (advice.length ? "\nAdvice from your coach, from earlier negotiations:\n" + advice.map((a, i) => (i + 1) + ". " + a).join("\n") : "")
      : "You are buying a balloon, listed at $20. You want it, and would like to pay as little as you can: $10 would be ideal. You will not pay more than the listed $20, but below that you would rather buy it than walk away.";
    const r = await tools.call_agent(who, brief + "\n\nThe negotiation so far:\n" + (said.join("\n") || "(nothing yet: you open)") +
      "\n\nWrite your next message to the " + other + " in one or two sentences. End with a last line 'Offer: $N' for a price you propose, or 'Accept' to take the " + other + "'s last offer.");
    const text = String(r).replace(/\s+/g, " ").slice(0, 400);
    said.push(who + ": " + text);
    const theirs = last[other];
    if (accepts(r) && theirs !== null) price = theirs;
    else { const o = offerOf(r); if (o !== null) last[who.toLowerCase()] = o; }
  }
  prices.push(price);
  story.push("Game " + g + ": " + (price === null ? "no deal in " + turns + " messages" : "deal at $" + price) + " (" + said.length + " messages)" + (g === 1 ? "\n  " + said.join("\n  ") : ""));
  emit("game " + g, price === null ? "no deal" : "deal at $" + price);
  // the critic reads the negotiation and gives the seller three suggestions, kept for every later game
  if (feedback && g < games) {
    const c = await tools.call_agent("Critic", "You are a coach for the seller of a balloon (listed at $20). Here is a negotiation it just had:\n" + said.join("\n") + "\nResult: " + (price === null ? "no deal" : "sold at $" + price) +
      ".\nGive the seller three short, specific suggestions to get a higher price next time, one per line.");
    advice.push(...String(c).split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 3));
  }
}
const deals = prices.filter((p) => p !== null);
metric("deals %", Math.round((100 * deals.length) / games));
if (deals.length) metric("mean deal price", Math.round((100 * deals.reduce((s, p) => s + p, 0)) / deals.length) / 100);
metric("per game, no sale as 0", Math.round((100 * deals.reduce((s, p) => s + p, 0)) / games) / 100);
return story.join("\n") + "\n\nPrices by game: " + prices.map((p) => (p === null ? "none" : "$" + p)).join(", ") +
  "\nMean deal price: " + (deals.length ? "$" + (deals.reduce((s, p) => s + p, 0) / deals.length).toFixed(2) : "none") +
  "\nAnswer: " + (prices[prices.length - 1] ?? 0);`;

function build(): SystemDoc {
  const b = new Builder(
    "Negotiation with AI feedback",
    "A seller and a buyer bargain over a balloon listed at $20. After each deal a critic gives the seller three suggestions, kept for every later negotiation. Do the seller's prices rise game after game?",
  );
  b.node("host", "human", 0, 160, { name: "Host", role: "Starts the games and reads the prices", approves: false })
    .agent("referee", 280, 140, { name: "Referee", role: "Runs the negotiations by the rules", model: "haiku", harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: REFEREE }, instructions: "Run the negotiations." } })
    .edge("host", "referee", "message", { label: "Start" })
    .edge("referee", "host", "message", { label: "Prices" });
  for (const [id, name, y] of [["seller", "Seller", 0], ["buyer", "Buyer", 160], ["critic", "Critic", 320]] as const) {
    b.agent(id, 620, y, {
      name,
      role: id === "critic" ? "Coaches the seller" : "Negotiates",
      model: "haiku",
      harness: { ...native(), loop: "single_shot", instructions: "Answer exactly what you are asked." },
      // each prompt carries the whole negotiation and the advice: no memory between games but what the referee gives
      context: { budget_total: 20000, history_strategy: "window", history_window: 2, mask_tool_output: false },
    });
    b.edge("referee", id, "call");
  }
  b.doc.budget = { usd: 0.5, max_rounds: 100, wallclock_min: 15 };
  return b.doc;
}

export const negotiation: TemplateInfo = {
  id: "paper-negotiation",
  name: "Negotiation with AI feedback",
  summary: "seller and buyer bargain · a critic coaches the seller between games · do prices rise?",
  build,
  paper: { title: "Improving Language Model Negotiation with Self-Play and In-Context Learning from AI Feedback", authors: "Fu et al.", year: 2023, url: "https://arxiv.org/abs/2305.10142" },
  notes: {
    mapped: [
      "The referee is a custom loop: turns alternate seller and buyer, each message ends with an offer or an acceptance, and a deal is the last offer accepted; prices are code.",
      "After each game the critic reads the negotiation and gives three suggestions, which accumulate and are shown to the seller in every later game, as the paper's in-context feedback.",
      "Run variables: games (4), turns (16 messages a game), feedback=false for the control without a critic.",
    ],
    differs: [
      "The paper's players are several models in every pairing, and it also coaches the buyer; here one model plays all three parts and only the seller is coached.",
      "The deal is detected from an 'Offer: $N' or 'Accept' line rather than by a moderator model.",
    ],
  },
};
