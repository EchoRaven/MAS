// Repeated games (Akata et al.): an agent plays ten rounds of a two-player game against a fixed strategy, or against
// another agent. The payoffs, the opponents and the scores are code; every move of the agents is a model's.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

// the paper's games, with its neutral option names J and F (no "cooperate" or "defect" to prime the choice);
// payoffs[mine + theirs] = [mine, theirs]
const MODERATOR = String.raw`const game = String(ctx.vars.game ?? "pd");
const rounds = Number(ctx.vars.rounds ?? 10);
const opponent = String(ctx.vars.opponent ?? "defect_once");
// social chain of thought: before choosing, the player predicts the other's move (the paper's remedy)
const predict = ctx.vars.predict === true || ctx.vars.predict === "true";
const payoffs = game === "bos"
  // Battle of the Sexes: both want to coordinate, J is the player's favourite, F the other's
  ? { JJ: [10, 7], FF: [7, 10], JF: [0, 0], FJ: [0, 0] }
  // Prisoner's Dilemma: J is to cooperate, F to defect
  : { JJ: [8, 8], JF: [0, 10], FJ: [10, 0], FF: [5, 5] };
const rules = "You are playing a game repeatedly with another player. In each round you choose Option J or Option F, and so does the other player, at the same time. The points: " +
  (game === "bos"
    ? "if you both choose J, you get 10 and the other gets 7; if you both choose F, you get 7 and the other gets 10; if you choose differently, you both get 0."
    : "if you both choose J, you both get 8; if you choose J and the other F, you get 0 and the other 10; if you choose F and the other J, you get 10 and the other 0; if you both choose F, you both get 5.") +
  " The game lasts " + rounds + " rounds. Your goal is to get as many points as you can over the whole game.";
// the fixed strategies the paper plays against; round counts from 1, last is the player's previous move
const fixed = {
  always_j: () => "J",
  always_f: () => "F",
  // the paper's "defect once" opponent defects in the first round only, then cooperates
  defect_once: (r) => (r === 1 ? "F" : "J"),
  alternate: (r) => (r % 2 ? "J" : "F"),
  // tit for tat: J first, then whatever the player did last round
  tit_for_tat: (r, last) => (r === 1 ? "J" : last),
};
const history = [];
let mine = 0, theirs = 0, coordinated = 0, playerJ = 0, afterTheirF = [];
const ask = async (who, r, past, rulesFor) => {
  const seen = past.length ? "\nThe rounds so far:\n" + past.join("\n") : "";
  const r1 = await tools.call_agent(who, rulesFor + seen + "\nRound " + r + "." + (predict ? " First, predict which option the other player will choose this round, and why, in one sentence. Then choose." : "") + " Reply with your choice on the last line as 'Choice: J' or 'Choice: F'.");
  const m = [...String(r1).matchAll(/choice\W*\s*option\s*([JF])\b|choice\W*\s*([JF])\b/gi)];
  const any = String(r1).match(/\b([JF])\b/g) ?? [];
  return ((m.length ? m[m.length - 1][1] ?? m[m.length - 1][2] : any.length ? any[any.length - 1] : "J") || "J").toUpperCase();
};
// the other agent sees the game from its side: its favourite in Battle of the Sexes is F, as for the player's opponent
const otherRules = game === "bos" ? rules.replace("you get 10 and the other gets 7; if you both choose F, you get 7 and the other gets 10", "you get 7 and the other gets 10; if you both choose F, you get 10 and the other gets 7") : rules;
let lastPlayer = "J";
for (let r = 1; r <= rounds; r++) {
  const pastP = history.map((h, i) => "Round " + (i + 1) + ": you chose " + h.p + ", the other chose " + h.o + "; you got " + h.pp + ", the other " + h.op + ".");
  const p = await ask("Player", r, pastP, rules);
  let o;
  if (opponent === "agent") {
    const pastO = history.map((h, i) => "Round " + (i + 1) + ": you chose " + h.o + ", the other chose " + h.p + "; you got " + h.op + ", the other " + h.pp + ".");
    o = await ask("Other", r, pastO, otherRules);
  } else o = (fixed[opponent] ?? fixed.defect_once)(r, lastPlayer);
  const [pp, op] = payoffs[p + o];
  mine += pp; theirs += op;
  if (p === o) coordinated++;
  if (p === "J") playerJ++;
  // what the player does the round after the other chose F: does it forgive?
  if (r > 1 && history[r - 2].o === "F") afterTheirF.push(p);
  history.push({ p, o, pp, op });
  lastPlayer = p;
  emit("round " + r, "player " + p + ", other " + o);
}
const moves = history.map((h) => h.p + h.o).join(" ");
return "Game: " + (game === "bos" ? "Battle of the Sexes" : "Prisoner's Dilemma") + " against " + opponent + (predict ? ", predicting first" : "") +
  "\nRounds (player, other): " + moves +
  "\nPoints: player " + mine + ", other " + theirs +
  "\nPlayer chose J in " + playerJ + " of " + rounds + " rounds; the same option as the other in " + coordinated + " of " + rounds +
  "\nThe round after the other chose F, the player chose: " + (afterTheirF.join(" ") || "(never)") +
  "\nAnswer: " + (game === "bos" ? coordinated : playerJ);`;

function build(): SystemDoc {
  const b = new Builder(
    "Repeated games",
    "An agent plays ten rounds of the Prisoner's Dilemma or the Battle of the Sexes against a fixed strategy (defect once, always one option, alternate, tit for tat) or against another agent. The rules and the opponents are code.",
  );
  b.node("host", "human", 0, 160, { name: "Host", role: "Starts the game and reads the outcome", approves: false })
    .agent("referee", 280, 140, { name: "Referee", role: "Runs the rounds by the rules", model: "haiku", harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: MODERATOR }, instructions: "Run the game." } })
    .edge("host", "referee", "message", { label: "Start" })
    .edge("referee", "host", "message", { label: "Outcome" });
  for (const [id, name, y] of [["player", "Player", 60], ["other", "Other", 260]] as const) {
    b.agent(id, 620, y, {
      name,
      role: "Plays the game",
      model: "haiku",
      harness: { ...native(), loop: "single_shot", instructions: "You are a player in a game. Answer exactly what you are asked." },
      // each round's prompt carries the whole history, as in the paper; the agent's own memory of earlier calls is not needed
      context: { budget_total: 20000, history_strategy: "window", history_window: 2, mask_tool_output: false },
    });
    b.edge("referee", id, "call");
  }
  b.doc.budget = { usd: 0.5, max_rounds: 60, wallclock_min: 15 };
  return b.doc;
}

export const repeatedGames: TemplateInfo = {
  id: "paper-repeated-games",
  name: "Repeated games",
  summary: "Prisoner's Dilemma · Battle of the Sexes · fixed opponents · predicting first",
  build,
  paper: { title: "Playing repeated games with Large Language Models", authors: "Akata et al.", year: 2023, url: "https://arxiv.org/abs/2305.16867" },
  notes: {
    mapped: [
      "The referee is a custom loop: the payoffs, the fixed opponents and the scores are code; each move of the player (and of the other, with opponent=agent) is a model's.",
      "The options are named J and F, as in the paper, so no word like cooperate or defect primes the choice; each round's prompt states the rules and the whole history.",
      "Run variables: game (pd or bos), opponent (defect_once, always_j, always_f, alternate, tit_for_tat, agent), rounds (10), predict=true for the paper's social chain of thought (predict the other's move, then choose).",
    ],
    differs: [
      "The paper plays many games of 2×2 payoffs and every pairing of models; here two games, a few fixed opponents, and one model at a time.",
      "Its answer is scored from the model's completion of a prompt; here from a 'Choice: J/F' line.",
    ],
  },
};
