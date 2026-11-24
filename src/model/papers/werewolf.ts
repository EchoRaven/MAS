// Werewolf: a game of hidden roles. The moderator is code — it runs the
// nights, the days and the votes, and tells each player only what that player
// may know; every choice is made by a player agent that remembers its own game.
import { Builder, native, type TemplateInfo } from "../builder";
import { defaultPlugin } from "../plugins";
import type { SystemDoc } from "../types";

const PLAYERS: [string, string, string][] = [
  ["alice", "Alice", "werewolf"],
  ["bob", "Bob", "werewolf"],
  ["carol", "Carol", "seer"],
  ["dave", "Dave", "witch"],
  ["eve", "Eve", "guard"],
  ["frank", "Frank", "villager"],
  ["grace", "Grace", "villager"],
];

const ROLE_BRIEF: Record<string, string> = {
  werewolf: "You are secretly a WEREWOLF, together with {mates}. At night you choose a villager to kill. By day, hide what you are: blend in, cast suspicion on others, and never admit your role. You win when werewolves are as many as everyone else.",
  seer: "You are secretly the SEER. Each night you may inspect one player and learn whether they are a werewolf. Use what you learn to steer the village's vote, but revealing yourself makes you a target. You win when every werewolf is voted out.",
  witch: "You are secretly the WITCH. You have two potions, each usable once in the game: a healing potion that saves the werewolves' victim of the night, and a poison that kills anyone you choose. You win when every werewolf is voted out or killed.",
  guard: "You are secretly the GUARD. Each night you protect one player from the werewolves (never the same player two nights running). You win when every werewolf is voted out or killed.",
  villager: "You are a VILLAGER. You know nothing secret. Listen, reason about who is lying, and vote out the werewolves. You win when every werewolf is voted out.",
};

// The rules, as code. Only the players' choices go to models.
const MODERATOR = `const players = ${JSON.stringify(Object.fromEntries(PLAYERS.map(([, n, r]) => [n, r])))};
let alive = Object.keys(players);
const wolves = () => alive.filter((p) => players[p] === "werewolf");
const others = () => alive.filter((p) => players[p] !== "werewolf");
const pick = (reply, from) => from.find((p) => reply.includes(p));
const tally = (votes) => Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
// the village's vote: a tie for the most votes eliminates nobody
const verdict = (votes) => { const [first, second] = Object.entries(votes).sort((a, b) => b[1] - a[1]); return first && (!second || first[1] > second[1]) ? first[0] : null; };
const over = () => (!wolves().length ? "The villagers win: every werewolf is gone." : wolves().length >= others().length ? "The werewolves win: they are as many as everyone else." : "");
const story = [];
// how often the village's own ballots (the werewolves' excluded) fall on a werewolf: what the game measures
let hits = 0, cast = 0;
// the witch's two potions, each once a game; whom the guard protected last night (not twice in a row)
const potions = { heal: true, poison: true };
let lastGuarded = null;
// seer_open: the seer is told, privately, to say what she saw (her brief warns that revealing herself makes her a
// target, and she kept quiet in nearly every game): does her knowledge reach the vote when she tells it?
if (ctx.vars.seer_open === true || ctx.vars.seer_open === "true") await tools.call_agent("Carol", "Advice for this game: your visions help the village only if it hears them. When you have seen a werewolf, say plainly by day that you are the seer and whom you saw. Reply OK.");
for (let day = 1; day <= (ctx.vars.days ?? 6); day++) {
  // a new order every night: models pick the first name offered (the werewolves killed the seer, listed first,
  // in a trial game), so a fixed seating would decide the game; it also sets who speaks first
  alive = alive.map((p) => [Math.random(), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  // night: the werewolves choose a victim, privately
  const votes = {};
  for (const w of wolves()) {
    const r = await tools.call_agent(w, "Night " + day + ". Alive: " + alive.join(", ") + ". Choose one of " + others().join(", ") + " to kill tonight. Reply with the name only.");
    const t = pick(r, others());
    if (t) votes[t] = (votes[t] ?? 0) + 1;
  }
  const attacked = tally(votes) ?? others()[0];
  // the guard protects one player, privately
  let guarded = null;
  if (alive.includes("Eve")) {
    const can = alive.filter((p) => p !== lastGuarded);
    guarded = pick(await tools.call_agent("Eve", "Night " + day + ". Choose one player to protect tonight: " + can.join(", ") + (lastGuarded ? " (not " + lastGuarded + ", whom you protected last night)" : "") + ". Reply with the name only."), can) ?? null;
    lastGuarded = guarded;
  }
  let killed = attacked === guarded ? null : attacked;
  // the witch learns the victim and may heal them, and may poison someone, each once a game
  let poisoned = null;
  if (alive.includes("Dave")) {
    if (potions.heal && killed) {
      const r = await tools.call_agent("Dave", "Night " + day + ". The werewolves attacked " + killed + " tonight. Use your one healing potion to save them? Reply YES or NO.");
      if (/\byes\b/i.test(r)) { killed = null; potions.heal = false; }
    }
    if (potions.poison) {
      const can = alive.filter((p) => p !== "Dave");
      const r = await tools.call_agent("Dave", "Night " + day + ". Use your one poison tonight? Reply with one name of " + can.join(", ") + ", or NO to keep it.");
      const t = /^\W*no\b/i.test(r) ? null : pick(r, can);
      if (t) { poisoned = t; potions.poison = false; }
    }
  }
  const dead = [...new Set([killed, poisoned].filter(Boolean))];
  // the seer inspects one player, privately; seer=false withholds her visions (the ablation)
  if (alive.includes("Carol") && ctx.vars.seer !== false && ctx.vars.seer !== "false") {
    const r = await tools.call_agent("Carol", "Night " + day + ". Choose one player to inspect: " + alive.filter((p) => p !== "Carol").join(", ") + ". Reply with the name only.");
    const who = pick(r, alive.filter((p) => p !== "Carol"));
    if (who) await tools.call_agent("Carol", "Your vision: " + who + " is " + (players[who] === "werewolf" ? "a WEREWOLF" : "not a werewolf") + ". Remember it. Reply OK.");
  }
  alive = alive.filter((p) => !dead.includes(p));
  const news = dead.length ? dead.join(" and ") + (dead.length > 1 ? " were" : " was") + " found dead this morning." : "Nobody died in the night.";
  story.push("Night " + day + ": " + (dead.length ? dead.map((p) => p + " died (" + players[p] + (p === poisoned ? ", poisoned" : "") + ")").join("; ") : "nobody died (" + attacked + " attacked, " + (attacked === guarded ? "guarded" : "healed") + ")") + ".");
  emit("night " + day, news);
  if (over()) break;
  // day: everyone alive speaks, in turn, hearing what was said before them
  const said = [];
  for (const p of alive) {
    const r = await tools.call_agent(p, "Day " + day + ". " + news + " Alive: " + alive.join(", ") + ".\\nSaid so far today:\\n" + (said.join("\\n") || "(nobody has spoken yet)") + "\\nSpeak to the village in at most two sentences.");
    said.push(p + ": " + r.replace(/\\s+/g, " ").slice(0, 300));
  }
  // vote
  const ballots = {};
  for (const p of alive) {
    const r = await tools.call_agent(p, "Day " + day + ". The discussion:\\n" + said.join("\\n") + "\\nVote to eliminate one of " + alive.filter((x) => x !== p).join(", ") + ". Reply with the name only.");
    const t = pick(r, alive.filter((x) => x !== p));
    if (t) ballots[t] = (ballots[t] ?? 0) + 1;
    if (t && players[p] !== "werewolf") { cast++; if (players[t] === "werewolf") hits++; }
  }
  const out = verdict(ballots);
  if (!out) {
    story.push("Day " + day + ": the vote was tied, so nobody was voted out. (" + JSON.stringify(ballots) + ")");
    emit("vote " + day, "tied — nobody voted out");
  }
  if (out) {
    alive = alive.filter((p) => p !== out);
    story.push("Day " + day + ": the village voted out " + out + ", who was a " + players[out] + ". (" + JSON.stringify(ballots) + ")");
    emit("vote " + day, out + " voted out — a " + players[out]);
  }
  if (over()) break;
}
const result = story.join("\\n") + "\\n\\n" + (over() || "No winner after " + (ctx.vars.days ?? 6) + " days. Still alive: " + alive.join(", ") + ".") + "\\nVillage ballots on werewolves: " + hits + " of " + cast + ".\\nRoles: " + JSON.stringify(players);
return result;`;

// The experience pool: after the game every player, the dead too, is shown how it went and draws one lesson for its
// role, which its memory keeps (only a reply that starts "Lesson:" is stored) and shows it in later games.
const MODERATOR_EXPERIENCE = MODERATOR.replace(
  "return result;",
  `for (const p of Object.keys(players)) {
  await tools.call_agent(p, "The game is over.\\n" + result + "\\nYou were " + p + ", a " + players[p] + ". In one sentence, what will you do differently, or again, the next time you play this role? Start your reply with Lesson:");
}
return result;`,
);

/** each player's own lessons, kept across games (scope agent), the five most recent shown before every answer */
function experiencePool() {
  const p = defaultPlugin("memory");
  p.name = "Experience pool";
  p.spec.scope = "agent";
  p.spec.retrieval = {
    rewrite: { use: "none", params: {} },
    search: [{ use: "recent", params: { k: 5 } }],
    fuse: { use: "rrf", params: {} },
    filters: [],
    rerank: { use: "none", params: {} },
    select: { use: "top_k", params: { k: 5 } },
    format: { use: "bullets", params: {} },
  };
  p.spec.memory = {
    extract: { use: "rules", params: { patterns: "Reply: Lesson:[^\\n]+" } },
    classify: { use: "none", params: {} },
    merge: { use: "append", params: {} },
    retain: { use: "forever", params: {} },
    consolidate: { use: "none", params: {} },
  };
  return p;
}

function build(experience = false): SystemDoc {
  const b = new Builder(
    "Werewolf",
    "Seven players, as in the paper: two secretly werewolves, a seer, a witch, a guard and two villagers. The moderator runs the game as code: at night the werewolves choose a victim, the guard protects someone, the witch may heal the victim or poison anyone (each once), and the seer inspects someone, all privately; by day everyone speaks in turn and votes someone out. Each player only ever learns what its role allows, and remembers its own game.",
  );
  b.node("host", "human", 0, 160, { name: "Host", role: "Starts the game and reads the outcome", approves: false })
    .agent("moderator", 280, 140, {
      name: "Moderator",
      role: "Runs the game by its rules",
      model: "haiku",
      harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: experience ? MODERATOR_EXPERIENCE : MODERATOR }, instructions: "Run the game." },
    })
    .edge("host", "moderator", "message", { label: "Start" })
    .edge("moderator", "host", "message", { label: "Outcome" });
  if (experience) b.doc.nodes.push({ id: "pool", position: { x: 940, y: 260 }, data: experiencePool() } as never);
  PLAYERS.forEach(([id, name, role], i) => {
    const mates = PLAYERS.filter(([, n, r]) => r === "werewolf" && n !== name).map(([, n]) => n).join(", ");
    b.agent(id, 620, i * 120 - 100, {
      name,
      role: "Player",
      model: "haiku",
      // each player's secret lives in its own instructions; nobody else can read it
      harness: { ...native(), loop: "single_shot", instructions: `You are ${name}, a player in a game of Werewolf with ${PLAYERS.map(([, n]) => n).filter((n) => n !== name).join(", ")}. ${ROLE_BRIEF[role].replace("{mates}", mates)} Answer exactly what the moderator asks.` },
      context: { budget_total: 60000, history_strategy: "window", history_window: 60, mask_tool_output: false },
    });
    b.edge("moderator", id, "call");
    if (experience) b.edge(id, "pool", "access", { access: "read_write", binding: { mode: "auto_inject", read: { budget_tokens: 600 }, write: { when: "after_turn" } } } as never);
  });
  b.doc.budget = { usd: 1, max_rounds: 300, wallclock_min: 30 };
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
      "Hidden information is per agent: each player's secret role is in its own instructions, and the moderator tells each one only what its role allows — the seer's visions go to the seer alone, the night's victim to the witch alone.",
      "Each player keeps its own history across the whole game (a long window), so it can remember what was said and, for the seer, what it saw.",
    ],
    differs: [
      "The paper's players also retrieve lessons from past games (an experience pool) and reflect before speaking. Here the plain game plays from each player's memory of this game only; the experience-pool variant keeps one lesson per player per game (scope agent) and shows the five most recent, not the paper's retrieval by situation and score.",
      "The paper's roles (two werewolves, seer, witch, guard, two villagers), but fixed to names; the seating is shuffled every night instead, as models pick the first name offered. seer=false withholds the seer's visions and seer_open advises her to tell them, ablations the paper does not run.",
    ],
  },
};

export const werewolfExperience: TemplateInfo = {
  ...werewolf,
  id: "paper-werewolf-experience",
  name: "Werewolf (experience pool)",
  summary: "the same game, with each player's lessons from earlier games carried into the next",
  build: () => build(true),
};
