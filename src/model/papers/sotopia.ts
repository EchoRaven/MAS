// SOTOPIA (Zhou et al.): two characters, each with a private social goal, talk in a scenario; an evaluator scores
// how far each reached its goal (0 to 10) and what the talk did to their relationship (-5 to 5). The follow-up "Is
// this the real life?" (Zhou et al. 2024) found that one model writing the whole dialogue, knowing both goals,
// scores higher than two agents who each know only their own: mode=script is that comparison. Turns, leaving and the
// scores are code; every line and every judgement is an agent's.
import { Builder, native, type TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";

const REFEREE = String.raw`// scenarios written for this template (not SOTOPIA's own): each goal is private and they pull apart
const SCENARIOS = [
  { setting: "Two flatmates in their shared kitchen on a Sunday evening.",
    a: { name: "Lena", goal: "Get Omar to agree to take over the weekly bin and recycling duty for the next month, because you start night shifts." },
    b: { name: "Omar", goal: "You have exams for the next three weeks; avoid taking on any extra chores, but keep things friendly with Lena." } },
  { setting: "A small bookshop; a customer brings a book back to the counter.",
    a: { name: "Priya", goal: "Return a book you bought two months ago and read once, and get a full cash refund (the shop's policy is 30 days, store credit only)." },
    b: { name: "Tom", goal: "You run the shop. Follow the 30-day, store-credit-only policy, but keep Priya as a loyal customer." } },
  { setting: "Two colleagues at the coffee machine the morning after a team meeting.",
    a: { name: "Grace", goal: "Find out, without asking directly, whether Ben is the one who told the manager your project is behind schedule." },
    b: { name: "Ben", goal: "You did mention Grace's delay to the manager, out of worry. Keep that to yourself unless asked directly, and offer Grace help." } },
  { setting: "Two neighbours meet on the stairs of their building.",
    a: { name: "Marco", goal: "Borrow Sofia's car for this Saturday to help a friend move house." },
    b: { name: "Sofia", goal: "You need your car on Saturday morning for a dentist appointment. Help Marco if you can without giving up the appointment." } },
  { setting: "Two old friends planning a joint birthday dinner over the phone.",
    a: { name: "Jun", goal: "Have the dinner at the new, expensive sushi restaurant you have been wanting to try." },
    b: { name: "Amara", goal: "You are saving money this month; get the dinner held somewhere that costs under $25 a person, without telling Jun why." } },
  { setting: "A volunteer coordinator and a volunteer at the end of a charity shift.",
    a: { name: "Helen", goal: "Persuade David to lead next week's food drive, which needs someone for six hours on Saturday." },
    b: { name: "David", goal: "You can give at most two hours next week. Stay a committed volunteer in Helen's eyes." } },
];
const pick = String(ctx.vars.scenarios ?? "all");
const chosen = pick === "all" ? SCENARIOS.map((_, i) => i) : pick.split(",").map((s) => Number(s.trim()) - 1).filter((i) => SCENARIOS[i]);
const turns = Number(ctx.vars.turns ?? 10);
const script = ctx.vars.mode === "script";
const num = (t, key, lo, hi) => { const m = [...String(t).matchAll(new RegExp(key + "[^\\w\\n-]*(-?\\d+(?:\\.\\d+)?)", "gi"))]; if (!m.length) return null; const v = Number(m[m.length - 1][1]); return Math.max(lo, Math.min(hi, v)); };
const story = [];
const goals = { a: [], b: [] }, rel = [];
for (const i of chosen) {
  const s = SCENARIOS[i];
  const brief = (me, other) => "You are " + me.name + ". " + s.setting + " You are talking with " + other.name + ".\nYour goal (" + other.name + " does not know it): " + me.goal;
  let said = [];
  if (script) {
    // one writer who knows both goals writes the whole conversation
    const r = await tools.call_agent("Writer", "Write a realistic conversation of at most " + turns + " lines. " + s.setting + "\n" + s.a.name + "'s private goal: " + s.a.goal + "\n" + s.b.name + "'s private goal: " + s.b.goal +
      "\nEach character knows only their own goal. Write one line per message, each as 'Name: message', " + s.a.name + " first.");
    said = String(r).split("\n").map((l) => l.trim()).filter((l) => new RegExp("^\\**(" + s.a.name + "|" + s.b.name + ")\\**:").test(l)).slice(0, turns).map((l) => l.replace(/\*/g, "").slice(0, 400));
  } else {
    let left = false;
    for (let t = 0; t < turns && !left; t++) {
      const [me, other] = t % 2 === 0 ? [s.a, s.b] : [s.b, s.a];
      const r = await tools.call_agent(me === s.a ? "Character A" : "Character B", brief(me, other) + "\n\nThe conversation so far:\n" + (said.join("\n") || "(nothing yet: you speak first)") +
        "\n\nWrite your next message to " + other.name + ", one to three sentences, as " + me.name + " would say it. If the conversation is over for you, end with a last line 'Leave'.");
      const text = String(r).trim();
      left = /^\W*leave\W*$/i.test(text.split("\n").pop() ?? "");
      said.push(me.name + ": " + text.replace(/\n\W*leave\W*$/i, "").replace(/\s+/g, " ").slice(0, 400) + (left ? " [leaves]" : ""));
    }
  }
  const j = await tools.call_agent("Evaluator", "Here is a conversation. " + s.setting + "\n" + said.join("\n") +
    "\n\n" + s.a.name + "'s private goal was: " + s.a.goal + "\n" + s.b.name + "'s private goal was: " + s.b.goal +
    "\n\nJudge strictly from what was said. Answer with exactly three lines:\nA goal: <0-10, how far " + s.a.name + " reached their goal>\nB goal: <0-10, how far " + s.b.name + " reached theirs>\nRelationship: <-5 to 5, how the conversation changed their relationship>");
  const ga = num(j, "A goal", 0, 10), gb = num(j, "B goal", 0, 10), r = num(j, "Relationship", -5, 5);
  if (ga !== null) goals.a.push(ga);
  if (gb !== null) goals.b.push(gb);
  if (r !== null) rel.push(r);
  emit("scenario " + (i + 1), s.a.name + " " + ga + ", " + s.b.name + " " + gb + ", relationship " + r + " (" + said.length + " lines)");
  story.push("Scenario " + (i + 1) + " (" + s.a.name + " and " + s.b.name + ", " + said.length + " lines): goals " + ga + " and " + gb + ", relationship " + r);
}
const mean = (xs) => (xs.length ? Math.round((10 * xs.reduce((x, y) => x + y, 0)) / xs.length) / 10 : null);
const both = [...goals.a, ...goals.b];
if (both.length) metric("goal completion", mean(both));
if (goals.a.length) metric("first speaker's goal", mean(goals.a));
if (goals.b.length) metric("second speaker's goal", mean(goals.b));
if (rel.length) metric("relationship", mean(rel));
return story.join("\n") + "\n\nMode: " + (script ? "one writer knowing both goals" : "two agents, each knowing only its own goal") +
  "\nGoal completion (0-10): " + mean(both) + "; relationship (-5 to 5): " + mean(rel) + "\nAnswer: " + mean(both);`;

function build(): SystemDoc {
  const b = new Builder(
    "SOTOPIA: social goals",
    "Two characters, each with a private social goal, talk in a scenario; an evaluator scores how far each got (0 to 10) and the relationship (-5 to 5). mode=script has one writer, knowing both goals, write the whole conversation instead.",
  );
  b.node("host", "human", 0, 160, { name: "Host", role: "Starts the scenarios and reads the scores", approves: false })
    .agent("referee", 280, 140, { name: "Referee", role: "Runs the scenarios, the turns and the scoring", model: "haiku", harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: REFEREE }, instructions: "Run the scenarios." } })
    .edge("host", "referee", "message", { label: "Start" })
    .edge("referee", "host", "message", { label: "Scores" });
  for (const [id, name, y, role] of [
    ["char_a", "Character A", 0, "Speaks first, toward a private goal"],
    ["char_b", "Character B", 120, "Answers, toward a private goal"],
    ["writer", "Writer", 240, "Writes the whole conversation (mode=script)"],
    ["evaluator", "Evaluator", 360, "Scores goals and relationship"],
  ] as const) {
    b.agent(id, 620, y, {
      name,
      role,
      model: "haiku",
      harness: { ...native(), loop: "single_shot", instructions: "Answer exactly what you are asked." },
      // each prompt carries the scenario and the conversation so far: nothing else is remembered
      context: { budget_total: 20000, history_strategy: "window", history_window: 2, mask_tool_output: false },
    });
    b.edge("referee", id, "call");
  }
  b.doc.budget = { usd: 0.5, max_rounds: 100, wallclock_min: 15 };
  return b.doc;
}

export const sotopia: TemplateInfo = {
  id: "paper-sotopia",
  name: "SOTOPIA: social goals",
  summary: "two characters with private goals talk · an evaluator scores each goal · agents or one omniscient writer",
  build,
  paper: { title: "SOTOPIA: Interactive Evaluation for Social Intelligence in Language Agents", authors: "Zhou et al.", year: 2024, url: "https://arxiv.org/abs/2310.11667" },
  notes: {
    mapped: [
      "The referee is a custom loop: the characters alternate for up to 10 messages (run variable turns), either may leave, and each sees only its own goal.",
      "An evaluator agent scores each character's goal completion (0 to 10) and the relationship (-5 to 5), two of SOTOPIA's seven dimensions.",
      "mode=script is the comparison of the follow-up paper (Zhou et al. 2024, 'Is this the real life?'): one writer who knows both goals writes the whole conversation.",
      "Run variable scenarios: 'all' (six) or a list such as '1,3'.",
    ],
    differs: [
      "Six scenarios written for this template stand in for SOTOPIA's 90 drawn from its character and relationship library.",
      "Five of the seven dimensions (believability, knowledge, secrets, social rules, financial benefit) are not scored.",
      "One model plays both characters and the evaluator.",
    ],
  },
};
