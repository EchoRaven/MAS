// ReCon on Avalon (Wang et al., "Avalon's Game of Thoughts: Battle Against Deception through Recursive
// Contemplation"): six players, four good (Merlin, Percival, two Loyal Servants) and two evil (Morgana, the Assassin),
// play five quests. Each leader proposes a team, everyone speaks once and votes; the team then plays success or fail
// cards in secret. Three failed quests, or five rejected teams in a row, win for evil; three successful quests leave
// the Assassin one guess at Merlin. With ReCon a player first thinks, privately, what each other player is (first
// order) and how its own words will be read (second order), then says only what it chooses. The rules, the
// roles' knowledge, the votes and the cards are code; every word and choice is an agent's.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"];

const REFEREE = String.raw`const NAMES = ${JSON.stringify(NAMES)};
const ROLES = ["Merlin", "Percival", "Loyal Servant", "Loyal Servant", "Morgana", "Assassin"];
const SIZES = [2, 3, 4, 3, 4];
// recon: "good" (the good side contemplates), "evil", "all" or "none"
const recon = ["good", "evil", "all", "none"].includes(ctx.vars.recon) ? ctx.vars.recon : "none";
// roles shuffled every game
const roles = [...ROLES];
for (let i = roles.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [roles[i], roles[j]] = [roles[j], roles[i]]; }
const evil = (p) => roles[p] === "Morgana" || roles[p] === "Assassin";
const thinks = (p) => recon === "all" || (recon === "good" && !evil(p)) || (recon === "evil" && evil(p));
const who = (pred) => NAMES.filter((_, p) => pred(p));
const knows = (p) => {
  const r = roles[p];
  if (r === "Merlin") return "You know the evil players: " + who(evil).join(" and ") + ". If evil loses the quests, the Assassin may still win by naming you, so do not make it obvious that you know.";
  if (r === "Percival") return "You see Merlin and Morgana but cannot tell which is which: " + who((q) => roles[q] === "Merlin" || roles[q] === "Morgana").join(" and ") + ".";
  if (evil(p)) return "You are evil, with " + who((q) => evil(q) && q !== p).join("") + ". Evil wins with three failed quests; on a quest you may play fail. Hide that you are evil." + (r === "Assassin" ? " If good wins three quests, you name the player you think is Merlin: right, and evil wins." : "");
  return "You know nothing of the others' roles. Good wins with three successful quests (and Merlin not found by the Assassin).";
};
const RULES = "Avalon, six players: " + NAMES.join(", ") + ". Four are good (Merlin, Percival, two Loyal Servants), two evil (Morgana, the Assassin). Five quests, teams of 2, 3, 4, 3, 4. The leader proposes a team, everyone speaks once, then all vote; a majority approves. Five rejected teams in a row: evil wins. On a quest each member plays success or fail in secret (good players always play success); one fail fails the quest. Three failed quests: evil wins. Three successful quests: the Assassin names Merlin; right, evil wins, else good wins.";
const log = [];
const notes = {};
const ask = async (p, task, format) => {
  const own = "You are " + NAMES[p] + ", " + roles[p] + ". " + knows(p);
  const scratch = thinks(p)
    ? "\n\nYour private thoughts from your last turn:\n" + (notes[p] ?? "(none yet)") +
      "\n\nFirst, under 'Think:', reason privately: what is each other player, judging from what they said and did (and how sure are you)? How will the others read what you are about to say or do, and what would it reveal about you? Then, under 'Answer:', give your answer; only the answer is seen."
    : "";
  const raw = String(await tools.call_agent(NAMES[p], RULES + "\n\n" + own + "\n\nWhat has happened:\n" + (log.slice(-40).join("\n") || "(the game begins)") + "\n\n" + task + " " + format + scratch));
  if (thinks(p)) { const cut = raw.search(/answer\s*[:：]/i); notes[p] = (cut >= 0 ? raw.slice(0, cut) : raw).replace(/^\W*think\s*[:：]/i, "").trim().slice(0, 1500); return cut >= 0 ? raw.slice(cut).replace(/^answer\s*[:：]\s*/i, "") : raw; }
  return raw;
};
const namesIn = (t) => { const seen = []; for (const m of String(t).matchAll(new RegExp("\\b(" + NAMES.join("|") + ")\\b", "g"))) if (!seen.includes(m[1])) seen.push(m[1]); return seen; };
let leader = Math.floor(Math.random() * 6), wins = 0, fails = 0, rejected = 0, quest = 0, proposals = 0, approvedEvil = 0, approvals = 0;
let winner = null, reason = "";
while (winner === null) {
  const size = SIZES[quest];
  proposals++;
  const prop = await ask(leader, "You lead quest " + (quest + 1) + ": propose a team of " + size + " (you may include yourself).", "Give one or two sentences of reasons, then a last line 'Team: <" + size + " names>'.");
  const line = String(prop).split("\n").reverse().find((l) => /team\s*[:：]/i.test(l)) ?? String(prop);
  let team = namesIn(line.replace(/^.*team\s*[:：]/i, "")).slice(0, size);
  for (const n of NAMES) if (team.length < size && !team.includes(n)) team.push(n);
  log.push("Quest " + (quest + 1) + ", " + NAMES[leader] + " proposes " + team.join(", ") + ": " + String(prop).replace(/\s+/g, " ").slice(0, 300));
  for (let k = 1; k < 6; k++) {
    const p = (leader + k) % 6;
    const said = await ask(p, NAMES[leader] + " proposed " + team.join(", ") + " for quest " + (quest + 1) + ".", "Say what you think, in one to three sentences.");
    log.push(NAMES[p] + ": " + String(said).replace(/\s+/g, " ").slice(0, 300));
  }
  const votes = [];
  for (let p = 0; p < 6; p++) votes.push(/\bapprove\b/i.test(String(await ask(p, "Vote on the team " + team.join(", ") + ".", "Answer with one line: 'Vote: approve' or 'Vote: reject'.")).split("\n").pop() ?? ""));
  const yes = votes.filter(Boolean).length;
  log.push("Votes on " + team.join(", ") + ": " + NAMES.map((n, p) => n + " " + (votes[p] ? "approve" : "reject")).join(", ") + (yes > 3 ? ": approved" : ": rejected"));
  leader = (leader + 1) % 6;
  if (yes <= 3) { rejected++; if (rejected >= 5) { winner = "evil"; reason = "five teams rejected in a row"; } continue; }
  rejected = 0;
  approvals++;
  const members = team.map((n) => NAMES.indexOf(n));
  if (members.some(evil)) approvedEvil++;
  let failCards = 0;
  for (const p of members) if (evil(p) && /\bfail\b/i.test(String(await ask(p, "You are on quest " + (quest + 1) + " with " + team.join(", ") + ".", "Play your card: one line 'Card: success' or 'Card: fail'.")).split("\n").pop() ?? "")) failCards++;
  const ok = failCards === 0;
  if (ok) wins++; else fails++;
  log.push("Quest " + (quest + 1) + " (" + team.join(", ") + "): " + (ok ? "success" : "failed, " + failCards + " fail card" + (failCards > 1 ? "s" : "")));
  emit("quest " + (quest + 1), team.join(", ") + ": " + (ok ? "success" : "failed"));
  quest++;
  if (fails >= 3) { winner = "evil"; reason = "three quests failed"; }
  else if (wins >= 3) {
    const a = roles.indexOf("Assassin");
    const guess = namesIn(String(await ask(a, "Good has won three quests. Name the player you think is Merlin.", "End with a last line 'Merlin: <name>'.")).split("\n").reverse().find((l) => /merlin\s*[:：]/i.test(l)) ?? "")[0];
    const hit = guess !== undefined && roles[NAMES.indexOf(guess)] === "Merlin";
    winner = hit ? "evil" : "good";
    reason = "the Assassin named " + (guess ?? "nobody") + (hit ? ", Merlin" : ", not Merlin");
    metric("Merlin found", hit ? 1 : 0);
  }
}
metric("good won", winner === "good" ? 1 : 0);
metric("quests succeeded", wins);
metric("approved teams with an evil player %", approvals ? Math.round((100 * approvedEvil) / approvals) : 0);
metric("teams proposed", proposals);
return "Roles: " + NAMES.map((n, p) => n + " " + roles[p]).join(", ") + ". ReCon: " + recon + ".\n" + log.filter((l) => /^Quest \d+ \(/.test(l) || /^Votes/.test(l)).join("\n") +
  "\n\n" + (winner === "good" ? "Good" : "Evil") + " wins: " + reason + ".\nAnswer: " + winner;`;

function build(): SystemDoc {
  const b = new Builder(
    "ReCon: Avalon",
    "Six players in Avalon, four good and two evil, roles shuffled each game: leaders propose teams, everyone speaks and votes, teams play secret cards, and the Assassin may guess Merlin. Run variable recon (none, good, evil, all) has those players first think privately about the others' roles and how their own words will be read.",
  );
  b.node("host", "human", 0, 260, { name: "Host", role: "Starts the game and reads who won", approves: false })
    .agent("referee", 280, 240, { name: "Referee", role: "Holds the roles, runs the quests and counts votes and cards", model: "haiku", harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: REFEREE }, instructions: "Run the game." } })
    .edge("host", "referee", "message", { label: "Start" })
    .edge("referee", "host", "message", { label: "Who won" });
  NAMES.forEach((name, i) => {
    b.agent(name.toLowerCase(), 620, i * 100, {
      name,
      role: "Plays the role it is dealt",
      model: "haiku",
      harness: { ...native(), loop: "single_shot", instructions: "Answer exactly what you are asked." },
      // each prompt carries the rules, the player's role and knowledge, and the game so far: nothing else is remembered
      context: { budget_total: 30000, history_strategy: "window", history_window: 2, mask_tool_output: false },
    });
    b.edge("referee", name.toLowerCase(), "call");
  });
  b.doc.budget = { usd: 0.5, max_rounds: 200, wallclock_min: 20 };
  return b.doc;
}

export const avalon: TemplateInfo = {
  id: "paper-avalon-recon",
  name: "ReCon: Avalon",
  summary: "six players, hidden roles · teams, votes, secret cards, the Assassin's guess · private contemplation for one side",
  build,
  paper: { title: "Avalon's Game of Thoughts: Battle Against Deception through Recursive Contemplation", authors: "Wang et al.", year: 2023, url: "https://arxiv.org/abs/2310.01320" },
  notes: {
    mapped: [
      "A custom loop holds the shuffled roles and each role's knowledge (Merlin sees evil, Percival sees Merlin and Morgana, evil see each other), and runs proposals, one speech each, votes, secret cards and the Assassin's guess by the rules.",
      "Run variable recon: the players on that side first write private thoughts (first order: what each other player is; second order: how its own words will be read), kept for their next turn; only what follows 'Answer:' is seen.",
      "Metrics: whether good won, quests succeeded, whether the Assassin found Merlin, the share of approved teams with an evil player.",
    ],
    differs: [
      "The paper's ReCon also refines a first draft of speech in a second pass; here the thinking and the answer are one call.",
      "Good players' cards are always success (as in the rules); evil players choose. One model plays everyone.",
    ],
  },
};
