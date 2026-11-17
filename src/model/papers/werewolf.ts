// Werewolf: a game of hidden roles. The moderator is code — it runs the
// nights, the days and the votes, and tells each player only what that player
// may know; every choice is made by a player agent that remembers its own game.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

const PLAYERS: [string, string, string][] = [
  ["alice", "Alice", "werewolf"],
  ["bob", "Bob", "werewolf"],
  ["carol", "Carol", "seer"],
  ["dave", "Dave", "villager"],
  ["eve", "Eve", "villager"],
];

const ROLE_BRIEF: Record<string, string> = {
  werewolf: "You are secretly a WEREWOLF, together with {mates}. At night you choose a villager to kill. By day, hide what you are: blend in, cast suspicion on others, and never admit your role. You win when werewolves are as many as everyone else.",
  seer: "You are secretly the SEER. Each night you may inspect one player and learn whether they are a werewolf. Use what you learn to steer the village's vote, but revealing yourself makes you a target. You win when every werewolf is voted out.",
  villager: "You are a VILLAGER. You know nothing secret. Listen, reason about who is lying, and vote out the werewolves. You win when every werewolf is voted out.",
};

// The rules, as code. Only the players' choices go to models.
const MODERATOR = `const players = ${JSON.stringify(Object.fromEntries(PLAYERS.map(([, n, r]) => [n, r])))};
let alive = Object.keys(players);
const wolves = () => alive.filter((p) => players[p] === "werewolf");
const others = () => alive.filter((p) => players[p] !== "werewolf");
const pick = (reply, from) => from.find((p) => reply.includes(p));
const tally = (votes) => Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
const over = () => (!wolves().length ? "The villagers win: every werewolf is gone." : wolves().length >= others().length ? "The werewolves win: they are as many as everyone else." : "");
const story = [];
for (let day = 1; day <= (ctx.vars.days ?? 3); day++) {
  // night: the werewolves choose a victim, privately
  const votes = {};
  for (const w of wolves()) {
    const r = await tools.call_agent(w, "Night " + day + ". Alive: " + alive.join(", ") + ". Choose one of " + others().join(", ") + " to kill tonight. Reply with the name only.");
    const t = pick(r, others());
    if (t) votes[t] = (votes[t] ?? 0) + 1;
  }
  const victim = tally(votes) ?? others()[0];
  // the seer inspects one player, privately
  if (alive.includes("Carol")) {
    const r = await tools.call_agent("Carol", "Night " + day + ". Choose one player to inspect: " + alive.filter((p) => p !== "Carol").join(", ") + ". Reply with the name only.");
    const who = pick(r, alive.filter((p) => p !== "Carol"));
    if (who) await tools.call_agent("Carol", "Your vision: " + who + " is " + (players[who] === "werewolf" ? "a WEREWOLF" : "not a werewolf") + ". Remember it. Reply OK.");
  }
  alive = alive.filter((p) => p !== victim);
  story.push("Night " + day + ": " + victim + " was killed (" + players[victim] + ").");
  emit("night " + day, victim + " was killed");
  if (over()) break;
  // day: everyone alive speaks, in turn, hearing what was said before them
  const said = [];
  for (const p of alive) {
    const r = await tools.call_agent(p, "Day " + day + ". " + victim + " was found dead this morning. Alive: " + alive.join(", ") + ".\\nSaid so far today:\\n" + (said.join("\\n") || "(nobody has spoken yet)") + "\\nSpeak to the village in at most two sentences.");
    said.push(p + ": " + r.replace(/\\s+/g, " ").slice(0, 300));
  }
  // vote
  const ballots = {};
  for (const p of alive) {
    const r = await tools.call_agent(p, "Day " + day + ". The discussion:\\n" + said.join("\\n") + "\\nVote to eliminate one of " + alive.filter((x) => x !== p).join(", ") + ". Reply with the name only.");
    const t = pick(r, alive.filter((x) => x !== p));
    if (t) ballots[t] = (ballots[t] ?? 0) + 1;
  }
  const out = tally(ballots);
  if (out) {
    alive = alive.filter((p) => p !== out);
    story.push("Day " + day + ": the village voted out " + out + ", who was a " + players[out] + ". (" + JSON.stringify(ballots) + ")");
    emit("vote " + day, out + " voted out — a " + players[out]);
  }
  if (over()) break;
}
return story.join("\\n") + "\\n\\n" + (over() || "No winner after " + (ctx.vars.days ?? 3) + " days. Still alive: " + alive.join(", ") + ".") + "\\nRoles: " + JSON.stringify(players);`;

function build(): SystemDoc {
  const b = new Builder(
    "Werewolf",
    "Five players, two of them secretly werewolves and one a seer. The moderator runs the game as code: at night the werewolves choose a victim and the seer inspects someone, privately; by day everyone speaks in turn and votes someone out. Each player only ever learns what its role allows, and remembers its own game.",
  );
  b.node("host", "human", 0, 160, { name: "Host", role: "Starts the game and reads the outcome", approves: false })
    .agent("moderator", 280, 140, {
      name: "Moderator",
      role: "Runs the game by its rules",
      model: "haiku",
      harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: MODERATOR }, instructions: "Run the game." },
    })
    .edge("host", "moderator", "message", { label: "Start" })
    .edge("moderator", "host", "message", { label: "Outcome" });
  PLAYERS.forEach(([id, name, role], i) => {
    const mates = PLAYERS.filter(([, n, r]) => r === "werewolf" && n !== name).map(([, n]) => n).join(", ");
    b.agent(id, 620, i * 120 - 100, {
      name,
      role: "Player",
      model: "haiku",
      // each player's secret lives in its own instructions; nobody else can read it
      harness: { ...native(), loop: "single_shot", instructions: `You are ${name}, a player in a game of Werewolf with Alice, Bob, Carol, Dave and Eve. ${ROLE_BRIEF[role].replace("{mates}", mates)} Answer exactly what the moderator asks.` },
      context: { budget_total: 60000, history_strategy: "window", history_window: 60, mask_tool_output: false },
    });
    b.edge("moderator", id, "call");
  });
  b.doc.budget = { usd: 1, max_rounds: 120, wallclock_min: 30 };
  return b.doc;
}

export const werewolf: TemplateInfo = {
  id: "paper-werewolf",
  name: "Werewolf",
  summary: "hidden roles · private information · rules as code, choices as agents",
  build,
  paper: { title: "Exploring Large Language Models for Communication Games: An Empirical Study on Werewolf", authors: "Xu et al.", year: 2023, url: "https://arxiv.org/abs/2309.04658" },
  notes: {
    mapped: [
      "The moderator is a custom loop: the game's rules are code (night and day, who may know what, vote tallies, win conditions), and only the players' choices go to models.",
      "Hidden information is per agent: each player's secret role is in its own instructions, and the moderator tells each one only what its role allows — the seer's visions go to the seer alone.",
      "Each player keeps its own history across the whole game (a long window), so it can remember what was said and, for the seer, what it saw.",
    ],
    differs: [
      "The paper's players also retrieve lessons from past games (an experience pool) and reflect before speaking; here each player plays from its own memory of this game only. A memory plugin per player would add the experience pool.",
      "Fewer roles: no witch or guard, and five players instead of seven.",
    ],
  },
};
