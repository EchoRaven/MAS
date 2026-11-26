// @vitest-environment node
// End-to-end runs on the built-in test model: real scheduling, edges,
// functions, plugins, people and budgets; only the model text is canned.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TEMPLATES } from "@/model/templates";
import { Builder, native } from "@/model/builder";
import { port } from "@/model/ports";
import type { RunEvent, RunRecord } from "@/run/events";
import type { AgentData, SystemDoc } from "@/model/types";
import type { Config } from "../config";
import { Store } from "../store/files";
import { Secrets } from "../store/secrets";
import { resetMock } from "./models/mock";
import { RunManager } from "./runs";
import { replicaCount } from "./engine";
import { validate } from "@/model/validate";
import { roundsOf } from "@/run/rounds";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-test-"));
const config: Config = { host: "127.0.0.1", port: 0, dataDir: dir, token: "t", allowLocalExec: false, docker: "/nonexistent/docker", parallelism: 4 };
const store = new Store(dir);
const runs = new RunManager(store, new Secrets(dir), config);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Run to the end, answering every person's request with `answer`. */
async function run(doc: SystemDoc, input = "Hello", opts: { mock?: boolean; vars?: Record<string, unknown>; answer?: (r: { kind: string; text: string }) => { approved?: boolean; text?: string } } = {}): Promise<{ rec: RunRecord; events: RunEvent[] }> {
  resetMock();
  store.putSystem(doc);
  const rec = runs.start(doc, { input, mock: opts.mock ?? true, vars: opts.vars });
  const answer = opts.answer ?? (() => ({ approved: true, text: "ok" }));
  const seen = new Set<string>();
  for (let i = 0; i < 2000 && runs.isActive(rec.id); i++) {
    for (const e of store.events(rec.id)) {
      if (e.type === "human_request" && !seen.has(e.request.id)) {
        seen.add(e.request.id);
        runs.answer(rec.id, e.request.id, answer(e.request));
      }
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  return { rec: runs.get(rec.id)!, events: store.events(rec.id) };
}

const errors = (events: RunEvent[]) => events.filter((e) => e.type === "log" && e.level === "error").map((e) => (e as { text: string }).text);
const usages = (events: RunEvent[], node?: string) => events.filter((e) => e.type === "usage" && (!node || e.node === node));

describe("runtime", () => {
  it("runs human -> agent -> human and returns the reply", async () => {
    const b = new Builder("Echo", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 300, 0, { name: "Helper", role: "assistant", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "Help." } })
      .edge("me", "a", "message")
      .edge("a", "me", "message");
    const { rec, events } = await run(b.doc, "What is 2+2?");
    expect(errors(events)).toEqual([]);
    expect(rec.status).toBe("finished");
    const out = events.find((e) => e.type === "output");
    expect(out && "text" in out && out.text).toContain("Helper");
    expect(out && "text" in out && out.text).toContain("2+2");
  });

  it("calls another agent through a call edge, as a tool", async () => {
    const b = new Builder("Call", "");
    b.agent("boss", 0, 0, { name: "Boss", model: "boss_m", harness: { ...native(), instructions: "" } })
      .agent("w", 300, 0, { name: "Worker", model: "w_m", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .edge("boss", "w", "call");
    b.doc.models.push({ id: "w_m", provider: "mock", model: "mock", api: {}, price_in: 0, price_out: 0, modalities: ["text"] });
    b.doc.models.push({ id: "boss_m", provider: "mock", model: "mock", api: { params: { script: [{ tool: "ask_w", input: { request: "compute" } }, "Final: {{input}}"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "go", { mock: false });
    expect(errors(events)).toEqual([]);
    expect(events.some((e) => e.type === "message" && e.kind === "call" && e.to === "w")).toBe(true);
    expect(events.some((e) => e.type === "message" && e.kind === "reply" && e.from === "w")).toBe(true);
    expect(events.some((e) => e.type === "tool" && e.tool === "ask_w" && !e.error)).toBe(true);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toContain("Worker");
  });

  it("a full handoff carries the whole conversation along a chain", async () => {
    const b = new Builder("Chain", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false });
    for (const [i, name] of ["First", "Second", "Third"].entries())
      b.agent(`a${i}`, 200 + i * 200, 0, { name, model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "" } });
    b.edge("me", "a0", "message").edge("a0", "a1", "handoff", { carry: "full" }).edge("a1", "a2", "handoff", { carry: "full" }).edge("a2", "me", "message");
    const { events } = await run(b.doc, "the brief");
    expect(errors(events)).toEqual([]);
    const seen = usages(events).map((e) => (e as { tokens_in: number }).tokens_in);
    // each agent is handed everything said before it, so its context grows
    expect(seen).toHaveLength(3);
    expect(seen[1]).toBeGreaterThan(seen[0]);
    expect(seen[2]).toBeGreaterThan(seen[1]);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toContain("Third");
  });

  it("a custom loop calls agents by name, and an empty name calls no one", async () => {
    const b = new Builder("Names", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("boss", 200, 0, {
        name: "Boss",
        model: "sonnet",
        harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: "const a = await tools.call_agent('', 'x');\nconst b = await tools.call_agent('Computer Terminal', 'run it');\nreturn a.slice(0, 18) + ' | ' + b;" }, instructions: "" },
      })
      .agent("terminal", 400, 0, { name: "ComputerTerminal", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .agent("coder", 400, 200, { name: "Coder", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .edge("me", "boss", "message")
      .edge("boss", "me", "message")
      .edge("boss", "coder", "call")
      .edge("boss", "terminal", "call");
    const { events } = await run(b.doc, "go");
    expect(errors(events)).toEqual([]);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toMatch(/^No call edge to "" \| ComputerTerminal/);
    // nobody was called for the empty name; the terminal was found by a loose spelling
    expect(events.filter((e) => e.type === "message" && e.kind === "call").map((e) => (e as { to: string }).to)).toEqual(["terminal"]);
  });

  it("Auction Arena: the last bidder pays its bid, budgets bind, overpaying is counted", async () => {
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const auction = async (replies: Record<string, string>, vars: Record<string, unknown>) => {
      const doc = TEMPLATES.find((t) => t.id === "paper-auction-arena")!.build();
      doc.models.push(...Object.entries(replies).map(([id, r]) => mock(`m_${id}`, [r])), mock("m_auc", ["ok"]));
      for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = n.id === "auctioneer" ? "m_auc" : `m_${n.id}`;
      const { events } = await run(doc, "Start the auction.", { mock: false, vars });
      expect(errors(events)).toEqual([]);
      return { out: (events.find((e) => e.type === "output") as { text: string }).text, metrics: events.filter((e) => e.type === "metric") as { name: string; value: number }[] };
    };
    // one bidder bids, the others withdraw: it takes every item at its starting price, $10,000 for $33,000 of value
    const solo = await auction({ alice: "Bid", bob: "Withdraw", carol: "Withdraw" }, { rule: false });
    expect(solo.out).toContain("Silver vase (value $2000): Alice for $1000");
    expect(solo.out).toContain("Alice $23000 (6 items, $10000 left)");
    expect(solo.metrics.find((m) => m.name === "agent bidders' profit")?.value).toBe(23000);
    // two who always bid, with $5,000 each: the vase goes for the whole budget, above its value
    const war = await auction({ alice: "Bid", bob: "Bid", carol: "Withdraw" }, { rule: false, budget: 5000 });
    expect(war.out).toMatch(/Silver vase \(value \$2000\): (Alice|Bob) for \$5000/);
    expect(war.metrics.find((m) => m.name === "items sold above their value")?.value).toBe(1);
    // the rule bidder bids only below the value: against bidders who withdraw it takes each item at its start
    const rule = await auction({ alice: "Withdraw", bob: "Withdraw", carol: "Withdraw" }, {});
    expect(rule.out).toContain("Gold watch (value $10000): Rule for $3000");
    expect(rule.metrics.find((m) => m.name === "rule bidder's profit")?.value).toBe(23000);
  });

  it("Negotiation: an accepted offer is the deal, a game without one is no deal, the critic's advice reaches the seller", async () => {
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const haggle = async (scripts: Record<string, string[]>, vars: Record<string, unknown>) => {
      const doc = TEMPLATES.find((t) => t.id === "paper-negotiation")!.build();
      doc.models.push(...Object.entries(scripts).map(([id, sc]) => mock(`m_${id}`, sc)), mock("m_ref", ["ok"]));
      for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = n.id === "referee" ? "m_ref" : `m_${n.id}`;
      const { events } = await run(doc, "Start.", { mock: false, vars });
      expect(errors(events)).toEqual([]);
      return { out: (events.find((e) => e.type === "output") as { text: string }).text, events };
    };
    // the buyer counters once, then accepts the seller's $18: the deal is the offer accepted, not the buyer's own
    const deal = await haggle({ seller: ["A fine balloon. Offer: $18"], buyer: ["Too much. Offer: $10", "Fine.\nAccept"], critic: ["Open higher.\nHold firm.\nStress quality."] }, { games: 2 });
    expect(deal.out).toContain("Game 1: deal at $18 (4 messages)");
    expect(deal.out).toContain("Prices by game: $18, $18");
    // the critic's three suggestions are in the seller's prompt in game 2
    const toSeller = deal.events.filter((e) => e.type === "message" && (e as { to?: string }).to === "seller").map((e) => (e as { text: string }).text);
    expect(toSeller.some((t) => t.includes("Advice from your coach") && t.includes("1. Open higher.") && t.includes("3. Stress quality."))).toBe(true);
    // neither ever accepts: no deal after the limit of messages
    const none = await haggle({ seller: ["Offer: $20"], buyer: ["Offer: $10"], critic: ["x"] }, { games: 1, turns: 6 });
    expect(none.out).toContain("Game 1: no deal in 6 messages");
    expect(none.out).toContain("Mean deal price: none");
  });

  it("Repeated games: the payoffs, the fixed opponents and the scores", async () => {
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const play = async (reply: string, vars: Record<string, unknown>) => {
      const doc = TEMPLATES.find((t) => t.id === "paper-repeated-games")!.build();
      doc.models.push(mock("m_play", [reply]));
      for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = "m_play";
      const { events } = await run(doc, "Start the game.", { mock: false, vars });
      expect(errors(events)).toEqual([]);
      return (events.find((e) => e.type === "output") as { text: string }).text;
    };
    // always J against "defect once": 0 against 10 in round 1, then 8 each for nine rounds
    const pd = await play("Choice: J", { game: "pd", opponent: "defect_once" });
    expect(pd).toContain("Rounds (player, other): JF JJ JJ JJ JJ JJ JJ JJ JJ JJ");
    expect(pd).toContain("Points: player 72, other 82");
    expect(pd).toContain("The round after the other chose F, the player chose: J");
    // "Choice: Option F" is read as F; against tit for tat F answers F from round 2: 10, then 5 a round
    const tft = await play("I think so. Choice: Option F", { game: "pd", opponent: "tit_for_tat", rounds: 3 });
    expect(tft).toContain("Rounds (player, other): FJ FF FF");
    expect(tft).toContain("Points: player 20, other 10");
    // Battle of the Sexes, always J against an alternating partner: coordinated in the odd rounds, 10 and 7 each time
    const bos = await play("Choice: J", { game: "bos", opponent: "alternate" });
    expect(bos).toContain("the same option as the other in 5 of 10");
    expect(bos).toContain("Points: player 50, other 35");
  });

  it("Werewolf's rules: the guard's protection, the witch's potions, the vote and the guard's no-twice rule", async () => {
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const doc = TEMPLATES.find((t) => t.id === "paper-werewolf")!.build();
    // each player's replies, in the order it is asked (a script repeats its last entry): chosen so that the game is
    // the same whatever the shuffled seating
    const scripts: Record<string, string[]> = {
      alice: ["Dave"], // night 1: kill the witch
      bob: ["Dave", "Hello.", "Dave", "Eve"], // night 1 kill, speech, vote (Dave is dead: no ballot), night 2 kill the guard
      carol: ["Alice"], // the seer inspects and votes Alice
      dave: ["NO"], // the witch neither heals nor poisons
      eve: ["Frank"], // the guard protects Frank, and cannot on night 2
      frank: ["Alice"],
      grace: ["Alice"],
    };
    doc.models.push(...Object.entries(scripts).map(([id, sc]) => mock(`m_${id}`, sc)), mock("m_mod", ["ok"]));
    for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = n.id === "moderator" ? "m_mod" : `m_${n.id}`;
    const { events } = await run(doc, "Start the game.", { mock: false, vars: { days: 2 } });
    expect(errors(events)).toEqual([]);
    const out = (events.find((e) => e.type === "output") as { text: string }).text;
    expect(out).toContain("Night 1: Dave died (witch).");
    expect(out).toContain("Day 1: the village voted out Alice, who was a werewolf.");
    expect(out).toContain("Night 2: Eve died (guard).");
    expect(out).toContain("Day 2: the vote was tied, so nobody was voted out.");
    expect(out).toContain("No winner after 2 days.");
    // the village's ballots on day 1: Carol, Frank and Grace on Alice, Eve on Frank (the werewolves' are not counted)
    expect(out).toContain("Village ballots on werewolves: 3 of 4.");
  });

  it("GovSim's fishery: sustainable catches keep the lake, one greedy fisher collapses it in month 3", async () => {
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const fishery = (catches: Record<string, string>) => {
      const doc = TEMPLATES.find((t) => t.id === "paper-govsim")!.build();
      doc.models.push(...Object.entries(catches).map(([id, c]) => mock(id, [`Catch: ${c}`])));
      for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = n.id === "moderator" ? "fair" : n.id === "luke" ? "luke" : "fair";
      return doc;
    };
    const outcome = async (doc: SystemDoc, vars: Record<string, unknown> = {}) => {
      const { events } = await run(doc, "Start the fishery.", { mock: false, vars });
      expect(errors(events)).toEqual([]);
      return (events.find((e) => e.type === "output") as { text: string }).text;
    };
    // ten tons each is half the lake, which doubles back to 100: every month alike
    const fair = await outcome(fishery({ fair: "10", luke: "10" }));
    expect(fair).toContain("The lake survived all 12 months.");
    expect(fair).toContain("Total caught: 600 tons (efficiency 100%), equality 1.00");
    // 20 for one: 100 → 40 left → 80 → 20 left → 40, and month 3 asks 60 of 40: nothing is left
    const greedy = await outcome(fishery({ fair: "10", luke: "20" }), { talk: false });
    expect(greedy).toContain("Month 2: 80 tons; caught 60");
    expect(greedy).toContain("The lake collapsed in month 3.");
    expect(greedy).toContain("Survived months: 2");
    // fractional catches stay in tenths of a ton (no 63.599999999999994)
    const tenths = await outcome(fishery({ fair: "3.3", luke: "3.3" }), { months: 2, talk: false });
    expect(tenths).toContain("caught 16.5");
    expect(tenths).not.toMatch(/\d\.\d{3,}/);
  });

  it("DyLAN keeps the best-ranked agents for the next layer and stops at two thirds", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-dylan")!.build();
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    // two agents say 1, two say 2: no two-thirds majority in the first layer
    doc.models.push(mock("ones", ["Final: 1"]), mock("twos", ["Final: 2"]), mock("rank", [JSON.stringify({ scores: { a1: 5, a2: 4, a3: 1, a4: 2 }, summary: "a1 and a2 are right" })]));
    for (const n of doc.nodes) {
      if (n.data.kind === "agent") n.data.model = n.id === "a1" || n.id === "a2" ? "ones" : "twos";
      if (n.id === "ranker" && n.data.kind === "model") n.data.model = "rank";
    }
    const { events } = await run(doc, "What is 2 - 1?", { mock: false });
    expect(errors(events)).toEqual([]);
    const turns = (id: string) => usages(events, id).length;
    // layer 1: all four; layer 2: only the two the ranker kept
    expect([turns("a1"), turns("a2"), turns("a3"), turns("a4")]).toEqual([2, 2, 1, 1]);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toContain("CONSENSUS after layer 2: 1");
    expect(out.text).toContain('"a1":5');
  });

  it("DyLAN stops in the first layer when the answers agree in different words", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-dylan")!.build();
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    doc.models.push(mock("long", ["Final: nine"]), mock("short", ["Final: 9"]));
    for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = n.id === "a1" || n.id === "a2" ? "long" : "short";
    const { events } = await run(doc, "sheep", { mock: false });
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toContain("CONSENSUS after layer 1: 9");
  });

  it("ReConcile discusses until the seats agree, showing each seat the others' reasons", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-reconcile")!.build();
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    doc.models.push(mock("hasty", ["Half the draws have a red. Answer: 1/2\nConfidence: 0.9", "The others are right. Answer: 1/3\nConfidence: 0.95"]), mock("careful", ["3 of the 9 cases. Answer: 1/3\nConfidence: 0.8"]));
    for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = n.id === "claude" ? "hasty" : "careful";
    const { events } = await run(doc, "Two balls, at least one red: both red?", { mock: false });
    expect(errors(events)).toEqual([]);
    expect(usages(events, "claude").length).toBe(2);
    // round 2's input carries the grouped answers with everyone's reasoning
    const round2 = events.filter((e): e is Extract<RunEvent, { type: "message" }> => e.type === "message" && e.to === "claude")[1];
    expect(round2.text).toContain('Answer "1/2", given by Claude (confidence 0.9)');
    expect(round2.text).toContain("GPT's reasoning: 3 of the 9 cases.");
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toMatch(/^Answer: 1\/3/);
    expect(out.text).toContain("Consensus in round 2");
  });

  it("ReConcile's vote weighs recalibrated confidence, so one sure seat can outvote two unsure ones", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-reconcile")!.build();
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    doc.models.push(mock("sure", ["Answer: A\nConfidence: 1.0"]), mock("unsure", ["Answer: B\nConfidence: 0.7"]));
    for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = n.id === "claude" ? "sure" : "unsure";
    const { events } = await run(doc, "A or B?", { mock: false });
    expect(usages(events, "claude").length).toBe(4);
    const out = events.find((e) => e.type === "output") as { text: string };
    // 1.0 → 1.0 against 0.7 → 0.3 twice
    expect(out.text).toMatch(/^Answer: A/);
    expect(out.text).toContain("No consensus after 4 rounds. Weighted vote: A 1.0, B 0.6.");
  });

  it("MedAgents gathers specialties, then revises the report until every expert votes yes", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-medagents")!.build();
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    doc.models = doc.models.filter((m) => m.id !== "sonnet");
    doc.models.push(
      mock("sonnet", ['{"domains": ["Cardiology", "Nephrology", "Pharmacology"]}']),
      mock("analyst", ["Analysis: {{input}}"]),
      mock("writer", ["REPORT v1"]),
      mock("agree", ["Vote: yes"]),
      mock("doubter", ["Vote: no. Mention the potassium.", "Vote: yes"]),
      mock("fixer", ["REVISED REPORT: REPORT v2 with potassium"]),
      mock("judge", ["B: hyperkalaemia"]),
    );
    const use: Record<string, string> = { e1: "analyst", e2: "analyst", e3: "analyst", summariser: "writer", r1: "agree", r2: "doubter", r3: "agree", reviser: "fixer", decider: "judge" };
    for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = use[n.id];
    const { events } = await run(doc, "ACE inhibitor plus spironolactone: what to watch?", { mock: false });
    expect(errors(events)).toEqual([]);
    // each expert is told its specialty
    const toE2 = events.find((e): e is Extract<RunEvent, { type: "message" }> => e.type === "message" && e.to === "e2")!;
    expect(toE2.text).toMatch(/^You are an expert in Nephrology/);
    // round 1: the doubter says no, the reviser fixes it; round 2: all yes
    expect(usages(events, "r2").length).toBe(2);
    expect(usages(events, "reviser").length).toBe(1);
    const toDecider = events.find((e): e is Extract<RunEvent, { type: "message" }> => e.type === "message" && e.to === "decider")!;
    expect(toDecider.text).toBe("AGREED REPORT:\nREPORT v2 with potassium");
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toBe("B: hyperkalaemia");
  });

  it("DyLAN counts \"1,098,240\" and \"1/221\" as themselves, not as 1", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-dylan")!.build();
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    doc.models.push(mock("big", ["Final: 1,098,240"]), mock("frac", ["Final: 1/221"]), mock("rank", [JSON.stringify({ scores: { a1: 5, a2: 5, a3: 1, a4: 1 }, summary: "" })]));
    for (const n of doc.nodes) {
      if (n.data.kind === "agent") n.data.model = n.id === "a1" || n.id === "a2" ? "big" : "frac";
      if (n.id === "ranker" && n.data.kind === "model") n.data.model = "rank";
    }
    const { events } = await run(doc, "?", { mock: false });
    const out = events.find((e) => e.type === "output") as { text: string };
    // two against two is no consensus in layer 1; the two "big" agents agree in layer 2
    expect(out.text).toContain("CONSENSUS after layer 2: 1098240");
    expect(out.text).toMatch(/\nFinal: 1098240$/);
  });

  it("self-consistency samples five times and takes the majority", async () => {
    const doc = TEMPLATES.find((t) => t.id === "self-consistency")!.build();
    doc.models = doc.models.filter((m) => m.id !== "sonnet");
    doc.models.push({ id: "sonnet", provider: "mock", model: "mock", api: { params: { script: ["so… Final: 7", "Final: 8", "Final: **7**", "Final: 8", "Final: 7."] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(doc, "?", { mock: false });
    expect(errors(events)).toEqual([]);
    expect(events.filter((e) => e.type === "usage").length).toBe(5);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toBe("Votes: 7 ×3, 8 ×2\nFinal: 7");
  });

  it("ReConcile gives no vote to a seat that gave no answer", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-reconcile")!.build();
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    doc.models.push(mock("silent", ["I am not sure."]), mock("sure", ["Answer: 9\nConfidence: 0.7"]));
    for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = n.id === "claude" ? "sure" : "silent";
    const { events } = await run(doc, "?", { mock: false });
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toMatch(/^Answer: 9\n/);
    expect(out.text).toContain("Weighted vote: 9 0.3.");
  });

  it("AutoAgents redrafts until both observers approve, then creates one agent per step", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-autoagents")!.build();
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    doc.models.push(
      mock("aa_planner", ["Agents: Coder. Plan: 1. Coder writes it.", "Agents: Coder, Tester. Plan: 1. Coder writes it. 2. Tester tests it."]),
      mock("aa_agents", ["Missing a tester.", "APPROVED"]),
      mock("aa_plan", ["APPROVED"]),
      mock("aa_action", [{ tool: "spawn_subagents", input: { tasks: ["You are Coder. Write it."] } }, { tool: "spawn_subagents", input: { tasks: ["You are Tester. Test it."] } }, "Final: written and tested"]),
      mock("aa_generated", ["done: {{input}}"]),
    );
    const use: Record<string, string> = { planner: "aa_planner", agent_observer: "aa_agents", plan_observer: "aa_plan", action_observer: "aa_action", generated: "aa_generated" };
    for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = use[n.id];
    const { events } = await run(doc, "Build a CLI calculator", { mock: false });
    expect(errors(events)).toEqual([]);
    expect([usages(events, "planner").length, usages(events, "agent_observer").length]).toEqual([2, 2]);
    // the second draft was written with the agent observer's feedback in view
    const toPlanner = events.filter((e): e is Extract<RunEvent, { type: "message" }> => e.type === "message" && e.to === "planner");
    expect(toPlanner[1].text).toContain("Agent observer: Missing a tester.");
    // the approved draft reaches the action observer, which creates an agent per step
    const toAction = events.find((e): e is Extract<RunEvent, { type: "message" }> => e.type === "message" && e.to === "action_observer")!;
    expect(toAction.text).toMatch(/^APPROVED DRAFT:\nAgents: Coder, Tester/);
    expect(events.filter((e) => e.type === "spawn").length).toBe(2);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toBe("Final: written and tested");
  });

  describe("Exchange-of-Thought", () => {
    const eotRun = async (paradigm: string, scripts: Record<string, string[]>) => {
      const doc = TEMPLATES.find((t) => t.id === "paper-eot")!.build();
      for (const a of ["a", "b", "c"]) {
        doc.models.push({ id: `eot_${a}`, provider: "mock", model: "mock", api: { params: { script: scripts[a] } }, price_in: 0, price_out: 0, modalities: ["text"] });
        doc.nodes.find((n) => n.id === a)!.data = { ...(doc.nodes.find((n) => n.id === a)!.data as AgentData), model: `eot_${a}` };
      }
      const { events } = await run(doc, "Q?", { mock: false, vars: { paradigm } });
      const to = (id: string) => events.filter((e): e is Extract<RunEvent, { type: "message" }> => e.type === "message" && e.to === id).map((e) => e.text);
      return { events, to, out: (events.find((e) => e.type === "output") as { text: string }).text };
    };

    it("Report: the spokes see only the hub, and agreement ends the exchange", async () => {
      // "1." and "1" are the same answer
      const { to, out, events } = await eotRun("report", { a: ["Final: 1"], b: ["Final: 2", "Final: 1."], c: ["Final: 3", "Final: 1"] });
      expect(errors(events)).toEqual([]);
      const b2 = to("b")[1];
      expect(b2).toContain("## Agent A (confidence 1.00)");
      expect(b2).not.toContain("## Agent C");
      expect(to("a")[1]).toContain("## Agent B");
      expect(to("a")[1]).toContain("## Agent C");
      expect(out).toBe("Paradigm: report. All three agree after round 2.\nFinal: 1");
    });

    it("Relay: each agent sees only the one before it in the ring", async () => {
      const { to } = await eotRun("relay", { a: ["Final: 1"], b: ["Final: 2", "Final: 1"], c: ["Final: 3", "Final: 1"] });
      expect(to("a")[1]).toMatch(/## Agent C[\s\S]*$/);
      expect(to("a")[1]).not.toContain("## Agent B");
      expect(to("b")[1]).toContain("## Agent A");
      expect(to("b")[1]).not.toContain("## Agent C");
    });

    it("without agreement, four rounds end in a vote weighted by confidence", async () => {
      // A wavers between 1 and 5, ending on 1; B and C hold 2 throughout
      const { out } = await eotRun("memory", { a: ["Final: 1", "Final: 5", "Final: 5", "Final: 1"], b: ["Final: 2"], c: ["Final: 2"] });
      expect(out).toBe("Paradigm: memory. No agreement after round 4; vote weighted by confidence.\nFinal: 2");
    });
  });

  it("Agents' Room: a planner's notes in the scratchpad are what the writer reads", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-agents-room")!.build();
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    doc.models.push(
      mock("ar_orch", [{ tool: "ask_conflict", input: { request: "a lighthouse story" } }, { tool: "ask_exposition", input: { request: "a lighthouse story" } }, "Final story: The keeper kept the light."]),
      mock("ar_conflict", [{ tool: "write_file", input: { path: "notes/conflict.md", content: "The keeper must choose between the light and his brother." } }, "Conflict noted."]),
      mock("ar_exposition", [{ tool: "read_file", input: { path: "notes/conflict.md" } }, { tool: "write_file", input: { path: "story/1-exposition.md", content: "The keeper kept the light." } }, "The keeper kept the light."]),
    );
    const use: Record<string, string> = { orchestrator: "ar_orch", conflict: "ar_conflict", exposition: "ar_exposition" };
    for (const n of doc.nodes) if (n.data.kind === "agent" && use[n.id]) n.data.model = use[n.id];
    const { events } = await run(doc, "Write a short story about a lighthouse keeper.", { mock: false });
    expect(errors(events)).toEqual([]);
    const tools = events.filter((e): e is Extract<RunEvent, { type: "tool" }> => e.type === "tool");
    const read = tools.find((t) => t.tool === "read_file")!;
    expect(read.result).toContain("choose between the light and his brother");
    expect(tools.filter((t) => t.tool === "write_file").length).toBe(2);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toBe("Final story: The keeper kept the light.");
  });

  it("STORM: a spawned interviewer questions the expert through its call edge", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-storm")!.build();
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    doc.models.push(
      mock("st_curator", [{ tool: "spawn_subagents", input: { tasks: ["You are an editor who cares about history. The topic is tea."] } }, "Interview notes, history: first drunk in China, around 2737 BC."]),
      mock("st_interviewer", [{ tool: "ask_expert", input: { request: "When was tea first drunk?" } }, "Notes: first drunk in China [https://example.org/tea]."]),
      mock("st_expert", ["Around 2737 BC, in China. Source: https://example.org/tea"]),
      mock("st_outliner", ["Outline: 1. History"]),
      mock("st_writer", ["Tea was first drunk in China [1].\n\nReferences\n1. https://example.org/tea"]),
    );
    const use: Record<string, string> = { curator: "st_curator", interviewer: "st_interviewer", expert: "st_expert", outliner: "st_outliner", writer: "st_writer" };
    for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = use[n.id];
    const { events } = await run(doc, "Tea", { mock: false });
    expect(errors(events)).toEqual([]);
    expect(events.filter((e) => e.type === "spawn").length).toBe(1);
    const asked = events.filter((e): e is Extract<RunEvent, { type: "tool" }> => e.type === "tool" && e.tool === "ask_expert");
    expect(asked.length).toBe(1);
    expect(asked[0].result).toContain("2737 BC");
    expect(usages(events, "expert").length).toBe(1);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toMatch(/^Tea was first drunk in China \[1\]/);
  });

  it("Virtual Lab: the PI opens, scientists then the critic speak each round, and the PI's summary ends the meeting", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-virtual-lab")!.build();
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    doc.models.push(
      mock("vl_pi", ["Agenda: pick a nanobody design approach.", "Round 1: ESM scoring is settled.", "Round 2: add AlphaFold checks.", "Summary: ESM + AlphaFold + Rosetta pipeline; next, design 92 candidates. TERMINATE"]),
      mock("vl_sci", ["My proposal."]),
      mock("vl_critic", ["The controls are missing."]),
    );
    for (const n of doc.nodes) if (n.data.kind === "agent") n.data.model = n.id === "pi" ? "vl_pi" : n.id === "critic" ? "vl_critic" : "vl_sci";
    const { events } = await run(doc, "Design nanobodies that bind the newest SARS-CoV-2 variant.", { mock: false });
    const speakers = events.filter((e) => e.type === "usage").map((e) => (e as { node: string }).node);
    expect(errors(events)).toEqual([]);
    // the PI opens and closes, and synthesises after each of the 3 rounds; everyone else speaks once a round
    expect([usages(events, "pi").length, usages(events, "immunologist").length, usages(events, "ml").length, usages(events, "compbio").length, usages(events, "critic").length]).toEqual([4, 3, 3, 3, 3]);
    expect(speakers.slice(0, 6)).toEqual(["pi", "immunologist", "ml", "compbio", "critic", "pi"]);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toMatch(/^Summary: ESM \+ AlphaFold/);
  });

  describe("rooms", () => {
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    // a room with a person who opens it and the given agents, each on its own scripted model
    const roomDoc = (policy: "round_robin" | "mention" | "selector" | "free", agents: [string, string, unknown[]][], extra: { selector?: string; termination?: string[] } = {}) => {
      const b = new Builder("Room", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false }).room("chat", 0, 0, "chat", { policy, history: "since_join", ...(extra.selector ? { selector: extra.selector } : {}) });
      b.edge("me", "chat", "access", { access: "read_write", binding: { mode: "tool", write: { when: "agent_tool" } } });
      for (const [id, name, script] of agents) {
        b.agent(id, 0, 0, { name, role: name, model: `m_${id}`, harness: { ...native(), loop: "single_shot", instructions: `You are ${name}.` } });
        b.doc.models.push(mock(`m_${id}`, script));
        b.edge(id, "chat", "access", { access: extra.selector === id ? "read" : "read_write" });
      }
      b.doc.budget = { usd: 1, max_rounds: 12, wallclock_min: 2 };
      b.doc.termination = extra.termination ?? [];
      return b.doc;
    };
    const posts = (events: RunEvent[]) => events.filter((e): e is Extract<RunEvent, { type: "message" }> => e.type === "message" && e.to === "chat").map((e) => e.from);

    it("round robin: everyone in the order they joined, again and again", async () => {
      const doc = roomDoc("round_robin", [["a", "Ann", ["a1", "a2"]], ["b", "Bo", ["b1", "b2"]], ["c", "Cy", ["c1", "c2 TERMINATE"]]]);
      const { events } = await run(doc, "go", { mock: false });
      expect(posts(events)).toEqual(["me", "a", "b", "c", "a", "b", "c"]);
      expect((events.find((e) => e.type === "output") as { text: string }).text).toBe("c2 TERMINATE");
    });

    it("mention: only whoever is @named answers, and the talk ends when nobody is named", async () => {
      const doc = roomDoc("mention", [["a", "Ann", ["@Cy what do you think?"]], ["b", "Bo", ["I was not asked."]], ["c", "Cy", ["I agree."]]]);
      const { events } = await run(doc, "@Ann please start", { mock: false });
      expect(posts(events)).toEqual(["me", "a", "c"]);
      expect(usages(events, "b").length).toBe(0);
    });

    it("selector: the moderator picks the next speaker, by its whole id, never itself", async () => {
      // "rewriter" contains "writer": a substring match would pick the wrong one
      const doc = roomDoc(
        "selector",
        [
          ["mod", "Moderator", ["rewriter", "writer"]],
          ["writer", "Writer", ["draft TERMINATE"]],
          ["rewriter", "Rewriter", ["better draft"]],
        ],
        { selector: "mod" },
      );
      const { events } = await run(doc, "write something", { mock: false });
      expect(posts(events)).toEqual(["me", "rewriter", "writer"]);
    });

    it("selector: never hands the turn to a person, and a manager that picks no one ends the talk with its last message", async () => {
      const doc = roomDoc(
        "selector",
        [
          ["mod", "Moderator", ["Me", "nobody, it is done"]],
          ["writer", "Writer", ["The answer is 155."]],
        ],
        { selector: "mod" },
      );
      const { events } = await run(doc, "write something", { mock: false });
      // the manager names the person first: not a candidate, so the person's opening post goes to the first agent that is not the manager
      expect(events.some((e) => e.type === "human_request")).toBe(false);
      const out = events.find((e) => e.type === "output") as { text: string } | undefined;
      expect(out?.text).toBe("The answer is 155.");
      expect(events.some((e) => e.type === "transform" && (e as { detail?: string }).detail === "the manager picked no one")).toBe(true);
    });

    it("ends a conversation after a set number of posts (posts in termination)", async () => {
      const doc = roomDoc("round_robin", [["a", "Ann", ["a1", "a2", "a3"]], ["b", "Bo", ["b1", "b2", "b3"]]], { termination: ["posts >= 4"] });
      const { events } = await run(doc, "go", { mock: false });
      // the person's opening post counts: me, a, b, a — then it ends, and the fourth post is the answer
      expect(posts(events)).toEqual(["me", "a", "b", "a"]);
      expect((events.find((e) => e.type === "output") as { text: string }).text).toBe("a2");
    });

    it("min_posts: a TERMINATE before the set length is ignored, and the conversation ends at it", async () => {
      const doc = roomDoc("round_robin", [["a", "Ann", ["a1 TERMINATE", "a2"]], ["b", "Bo", ["b1", "b2"]]], { termination: ["posts >= 5"] });
      (doc.nodes.find((n) => n.id === "chat")!.data as { room: { min_posts?: number } }).room.min_posts = 5;
      const { events } = await run(doc, "go", { mock: false });
      expect(posts(events)).toEqual(["me", "a", "b", "a", "b"]);
      expect((events.find((e) => e.type === "output") as { text: string }).text).toBe("b2");
    });

    it("free: every other agent hears each post, and a termination expression ends it", async () => {
      const doc = roomDoc("free", [["a", "Ann", ["from a", "a again"]], ["b", "Bo", ["DONE from b"]]], { termination: ['text.includes("DONE")'] });
      const { events } = await run(doc, "go", { mock: false });
      const out = events.find((e) => e.type === "output") as { text: string };
      expect(out.text).toContain("DONE");
      expect(events.some((e) => e.type === "transform" && (e as { label: string }).label === "conversation ended")).toBe(true);
    });
  });

  describe("gates", () => {
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    // me -> writer -[gated]-> reviewer -> me; the reviewer echoes what it got
    const gated = (gate: Record<string, unknown>, writer: unknown[], extra: (b: Builder) => void = () => undefined) => {
      const b = new Builder("Gate", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: true })
        .agent("writer", 0, 0, { name: "Writer", model: "g_writer", harness: { ...native(), loop: "single_shot", instructions: "Write." } })
        .agent("reviewer", 0, 0, { name: "Reviewer", model: "g_reviewer", harness: { ...native(), loop: "single_shot", instructions: "Review." } })
        .edge("me", "writer", "message")
        .edge("writer", "reviewer", "message", { gate: { name: "good enough", on_fail: "block", escalate_after: 3, ...gate } as never })
        .edge("reviewer", "writer", "message", { filter: "false" })
        .edge("reviewer", "me", "message");
      b.doc.models.push(mock("g_writer", writer), mock("g_reviewer", ["Reviewed: {{input}}"]));
      extra(b);
      b.doc.budget = { usd: 1, max_rounds: 20, wallclock_min: 2 };
      return b.doc;
    };
    const gateEvents = (events: RunEvent[]) => events.filter((e) => e.type === "gate").map((e) => (e as { passed: boolean }).passed);
    const output = (events: RunEvent[]) => (events.find((e) => e.type === "output") as { text: string } | undefined)?.text;

    it("expr: a value that fails is blocked and never arrives", async () => {
      const { events } = await run(gated({ condition: 'expr: text.includes("APPROVED")' }, ["draft one"]), "go", { mock: false });
      expect(gateEvents(events)).toEqual([false]);
      expect(usages(events, "reviewer").length).toBe(0);
      expect(output(events)).toBeUndefined();
    });

    it("route back: a failure goes back to the sender with the reason, and the revision passes", async () => {
      const { events } = await run(gated({ condition: 'expr: text.includes("v2")', on_fail: "route_back" }, ["v1", "v2"]), "go", { mock: false });
      expect(gateEvents(events)).toEqual([false, true]);
      const toWriter = events.filter((e): e is Extract<RunEvent, { type: "message" }> => e.type === "message" && e.to === "writer");
      expect(toWriter.some((m) => /did not pass "good enough"/.test(m.text))).toBe(true);
      expect(output(events)).toBe("Reviewed: v2");
    });

    it("route back: after escalate_after failures a person decides, and their yes lets it through", async () => {
      const { events } = await run(gated({ condition: 'expr: text.includes("v9")', on_fail: "route_back", escalate_after: 2 }, ["v1"]), "go", { mock: false, answer: () => ({ approved: true }) });
      expect(usages(events, "writer").length).toBe(2);
      expect(events.some((e) => e.type === "human_request" && e.request.kind === "approval" && /failed 2 times/.test(e.request.text))).toBe(true);
      expect(output(events)).toBe("Reviewed: v1");
    });

    it("judge: an agent's FAIL blocks, its PASS lets through", async () => {
      const judged = (verdict: string) =>
        gated({ condition: "judge: judge" }, ["the draft"], (b) => {
          b.agent("judge", 0, 0, { name: "Judge", model: "g_judge", harness: { ...native(), loop: "single_shot", instructions: "Judge." } });
          b.doc.models.push(mock("g_judge", [verdict]));
        });
      expect(output((await run(judged("FAIL: too short"), "go", { mock: false })).events)).toBeUndefined();
      expect(output((await run(judged("PASS, fine"), "go", { mock: false })).events)).toBe("Reviewed: the draft");
    });

    it("require approval: a failed gate asks a person, and a no blocks it", async () => {
      const { events } = await run(gated({ condition: 'expr: text.includes("APPROVED")', on_fail: "require_approval" }, ["draft"]), "go", { mock: false, answer: () => ({ approved: false, text: "no" }) });
      expect(events.some((e) => e.type === "human_request" && e.request.kind === "approval" && /Gate "good enough" failed/.test(e.request.text))).toBe(true);
      expect(output(events)).toBeUndefined();
    });
  });

  describe("policies", () => {
    const mock = (id: string, script: unknown[], price = 0) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: price, price_out: price, modalities: ["text"] });
    // me -> a -> b -> me, each agent on its own scripted model
    const chain = (policies: SystemDoc["policies"], scripts: { a: unknown[]; b: unknown[] }, price = 0) => {
      const b = new Builder("Policies", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: true })
        .agent("a", 0, 0, { name: "A", model: "p_a", harness: { ...native(), loop: "react", max_steps: 3, instructions: "" } })
        .agent("b", 0, 0, { name: "B", model: "p_b", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .edge("me", "a", "message")
        .edge("a", "b", "message")
        .edge("b", "me", "message");
      b.doc.models.push(mock("p_a", scripts.a, price), mock("p_b", scripts.b, price));
      b.doc.policies = policies;
      return b.doc;
    };
    const logs = (events: RunEvent[]) => events.filter((e) => e.type === "log").map((e) => (e as { text: string }).text);
    const outputs = (events: RunEvent[]) => events.filter((e) => e.type === "output").map((e) => (e as { text: string }).text);

    it("output, terminate: the value that meets the condition ends the run as its answer", async () => {
      const { rec, events } = await run(chain([{ id: "p1", on: "output(a)", condition: 'text.includes("FINAL")', action: "terminate" }], { a: ["FINAL answer: 42"], b: ["should not run"] }), "go", { mock: false });
      expect(outputs(events)).toEqual(["FINAL answer: 42"]);
      expect(usages(events, "b").length).toBe(0);
      expect(runs.get(rec.id)).toMatchObject({ status: "finished", reason: "Policy p1" });
    });

    it("output, block: the value is held back; and a policy on one component leaves the others alone", async () => {
      const { events } = await run(chain([{ id: "p1", on: "output(b)", condition: 'text.includes("secret")', action: "block" }], { a: ["the secret plan"], b: ["the secret plan, reviewed"] }), "go", { mock: false });
      // a's output (with "secret") still reached b; b's was blocked
      expect(usages(events, "b").length).toBe(1);
      expect(outputs(events)).toEqual([]);
      expect(logs(events).some((t) => /Policy p1 .*blocked/.test(t))).toBe(true);
    });

    it("usage: notify once, and terminate past a limit", async () => {
      const notified = await run(chain([{ id: "n1", on: "usage", condition: "tokens > 0", action: "notify" }], { a: ["one"], b: ["two"] }), "go", { mock: false });
      expect(logs(notified.events).filter((t) => t.startsWith("Policy n1")).length).toBe(1);
      const stopped = await run(chain([{ id: "t1", on: "usage", condition: "usd > 0", action: "terminate" }], { a: ["one"], b: ["two"] }, 1000), "go", { mock: false });
      expect(usages(stopped.events, "b").length).toBe(0);
      expect(runs.get(stopped.rec.id)?.reason).toBe("Policy t1");
    });

    it("tool, block: the call fails with the policy's name", async () => {
      const doc = chain([{ id: "nomem", on: "tool", condition: 'tool == "memory_write"', action: "block" }], { a: [{ tool: "memory_write", input: { text: "x" } }, "done"], b: ["ok"] });
      doc.nodes.push({ id: "mem", position: { x: 0, y: 0 }, data: { ...(TEMPLATES.find((t) => t.id === "supervisor")!.build().nodes.find((n) => n.data.kind === "plugin" && (n.data as { preset?: string }).preset === "memory")!.data) } });
      doc.edges.push({ id: "e_mem", source: "a", source_port: "res", target: "mem", target_port: "res", kind: "access", access: "read_write", binding: { mode: "tool", read: { top_k: 5, budget_tokens: 2000 }, write: { when: "agent_tool" } } } as never);
      const { events } = await run(doc, "go", { mock: false });
      const call = events.find((e): e is Extract<RunEvent, { type: "tool" }> => e.type === "tool" && e.tool === "memory_write");
      expect(call?.error).toBe(true);
      expect(call?.result).toContain("blocked by policy nomem");
    });
  });

  it("finish: with 'agents can end the run', an agent's finish ends it with that answer; without it there is no such tool", async () => {
    const doc = () => {
      const b = new Builder("Finish", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("a", 0, 0, { name: "A", model: "f_a", harness: { ...native(), loop: "react", max_steps: 3, instructions: "" } })
        .agent("b", 0, 0, { name: "B", model: "f_b", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .edge("me", "a", "message")
        .edge("a", "b", "message")
        .edge("b", "me", "message");
      b.doc.models.push(
        { id: "f_a", provider: "mock", model: "mock", api: { params: { script: [{ tool: "finish", input: { answer: "42, and done" } }, "carry on"] } }, price_in: 0, price_out: 0, modalities: ["text"] },
        { id: "f_b", provider: "mock", model: "mock", api: { params: { script: ["B ran"] } }, price_in: 0, price_out: 0, modalities: ["text"] },
      );
      return b.doc;
    };
    const on = doc();
    on.termination = ["agents_can_finish"];
    const { rec, events } = await run(on, "go", { mock: false });
    expect(events.filter((e) => e.type === "output").map((e) => (e as { text: string }).text)).toEqual(["42, and done"]);
    expect(usages(events, "b").length).toBe(0);
    expect(runs.get(rec.id)).toMatchObject({ status: "finished", reason: "A called finish" });
    const off = doc();
    // the old keyword, which every system made from the blank default has, does not turn it on
    off.termination = ["any_agent_calls_finish"];
    const second = await run(off, "go", { mock: false });
    // no finish tool: nothing ends the run early, and B gets its turn
    expect(second.events.some((e) => e.type === "tool" && e.tool === "finish" && !e.error)).toBe(false);
    expect(usages(second.events, "b").length).toBe(1);
    expect(second.events.filter((e) => e.type === "output").map((e) => (e as { text: string }).text)).toEqual(["B ran"]);
  });

  it("concurrency: parallel runs turns at once; queue and coalesce do not", async () => {
    // a function sends three messages at once to one agent whose turns take 100 ms
    const doc = (concurrency: "parallel" | "queue" | "coalesce") => {
      const b = new Builder("Fan", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .node("fan", "function", 0, 0, { name: "Fan out", fn: { lang: "js", code: "return { x: 'one', y: 'two', z: 'three' };" }, interface: { inputs: [port("in", "text")], outputs: [port("x", "text"), port("y", "text"), port("z", "text")] } })
        .agent("w", 0, 0, { name: "Worker", model: "slow", concurrency, harness: { ...native(), loop: "single_shot", instructions: "" } })
        .edge("me", "fan", "message")
        .edge("fan", "w", "message", { source_port: "x" })
        .edge("fan", "w", "message", { source_port: "y" })
        .edge("fan", "w", "message", { source_port: "z" });
      b.doc.models.push({ id: "slow", provider: "mock", model: "mock", api: { params: { script: ["done: {{input}}"], delay_ms: 100 } }, price_in: 0, price_out: 0, modalities: ["text"] });
      return b.doc;
    };
    const overlap = (events: RunEvent[]) => {
      let now = 0;
      let most = 0;
      for (const e of events) {
        if (e.type !== "status" || e.node !== "w") continue;
        if (e.status === "working") most = Math.max(most, ++now);
        if (e.status === "done") now--;
      }
      return most;
    };
    const par = await run(doc("parallel"), "go", { mock: false });
    expect(usages(par.events, "w").length).toBe(3);
    expect(overlap(par.events)).toBe(3);
    const queued = await run(doc("queue"), "go", { mock: false });
    expect(usages(queued.events, "w").length).toBe(3);
    expect(overlap(queued.events)).toBe(1);
    // coalesce: the first turn starts alone; what arrived meanwhile is merged into one more
    const merged = await run(doc("coalesce"), "go", { mock: false });
    expect(overlap(merged.events)).toBe(1);
    expect(usages(merged.events, "w").length).toBeLessThan(3);
  });

  it("budgets: the system's ends the run; an agent's own stops only that agent", async () => {
    const doc = (budget: { system?: number; agent?: number }) => {
      const b = new Builder("Budget", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("a", 0, 0, { name: "A", model: "pricey", ...(budget.agent != null ? { budget_usd: budget.agent } : {}), harness: { ...native(), loop: "react", max_steps: 4, instructions: "" } })
        .agent("b", 0, 0, { name: "B", model: "cheap", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .edge("me", "a", "message")
        .edge("me", "b", "message");
      // each call to "pricey" costs far more than a cent
      b.doc.models.push(
        { id: "pricey", provider: "mock", model: "mock", api: { params: { script: [{ tool: "memory_search", input: { query: "x" } }, "a done"] } }, price_in: 10000, price_out: 10000, modalities: ["text"] },
        { id: "cheap", provider: "mock", model: "mock", api: { params: { script: ["b done"] } }, price_in: 0, price_out: 0, modalities: ["text"] },
      );
      b.doc.budget = { usd: budget.system ?? null, max_rounds: 20, wallclock_min: 2 };
      return b.doc;
    };
    const whole = await run(doc({ system: 0.01 }), "go", { mock: false });
    expect(runs.get(whole.rec.id)).toMatchObject({ status: "finished", reason: "Over budget" });
    const own = await run(doc({ agent: 0.01 }), "go", { mock: false });
    const warned = own.events.filter((e) => e.type === "log" && e.level === "warn").map((e) => (e as { text: string }).text);
    expect(warned.some((t) => /A is over its budget: it stops here/.test(t))).toBe(true);
    expect(own.events.filter((e) => e.type === "output").map((e) => (e as { text: string }).text)).toContain("b done");
  });

  it("concurrency: interrupt cuts the turn short and starts over with both messages", async () => {
    const doc = (concurrency: "interrupt" | "queue") => {
      const b = new Builder("Interrupt", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .node("fan", "function", 0, 0, { name: "Fan out", fn: { lang: "js", code: "return { now: 'first news', later: 'second news' };" }, interface: { inputs: [port("in", "text")], outputs: [port("now", "text"), port("later", "text")] } })
        .node("relay", "model", 0, 0, { name: "Slow relay", model: "relay", system_prompt: "", prompt: "{{input}}", temperature: null, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } })
        .agent("w", 0, 0, { name: "Worker", model: "slow_w", concurrency, harness: { ...native(), loop: "single_shot", instructions: "" } })
        .edge("me", "fan", "message")
        .edge("fan", "w", "message", { source_port: "now" })
        .edge("fan", "relay", "message", { source_port: "later" })
        .edge("relay", "w", "message")
        .edge("w", "me", "message");
      b.doc.models.push(
        { id: "relay", provider: "mock", model: "mock", api: { params: { script: ["{{input}}"], delay_ms: 50 } }, price_in: 0, price_out: 0, modalities: ["text"] },
        { id: "slow_w", provider: "mock", model: "mock", api: { params: { script: ["handled: {{input}}"], delay_ms: 200 } }, price_in: 0, price_out: 0, modalities: ["text"] },
      );
      return b.doc;
    };
    const cut = await run(doc("interrupt"), "go", { mock: false });
    expect(errors(cut.events)).toEqual([]);
    expect(cut.events.some((e) => e.type === "log" && /interrupted by a new message/.test((e as { text: string }).text))).toBe(true);
    // the cut-short turn never finished its model call; one turn read both messages
    expect(usages(cut.events, "w").length).toBe(1);
    const toW = cut.events.filter((e): e is Extract<RunEvent, { type: "message" }> => e.type === "message" && e.to === "w");
    expect(toW.length).toBe(2);
    const outs = cut.events.filter((e) => e.type === "output").map((e) => (e as { text: string }).text);
    expect(outs.length).toBe(1);
    expect(outs[0]).toContain("first news");
    expect(outs[0]).toContain("second news");
    // queue, for contrast: two full turns, one per message
    const queued = await run(doc("queue"), "go", { mock: false });
    expect(usages(queued.events, "w").length).toBe(2);
  });

  describe("composition", () => {
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const outs = (events: RunEvent[]) => events.filter((e) => e.type === "output").map((e) => (e as { text: string }).text);

    it("a group called like a tool answers with its output", async () => {
      const b = new Builder("Group call", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("boss", 0, 0, { name: "Boss", model: "c_boss", harness: { ...native(), loop: "react", max_steps: 3, instructions: "" } })
        .group("team", 0, 0, { name: "Team", interface: { inputs: [port("q", "message")], outputs: [port("a", "text")] } })
        .node("work", "function", 0, 0, { name: "Work", fn: { lang: "js", code: 'return "answer to " + String(input?.text ?? input);' }, interface: { inputs: [port("in", "message")], outputs: [port("out", "text")] } }, "team")
        .edge("me", "boss", "message")
        .edge("boss", "team", "call")
        .edge("team", "work", "message")
        .edge("work", "team", "message")
        .edge("boss", "me", "message");
      b.doc.models.push(mock("c_boss", [{ tool: "ask_team", input: { request: "the plan" } }, "Boss heard: {{input}}"]));
      const { events } = await run(b.doc, "go", { mock: false });
      expect(errors(events)).toEqual([]);
      const asked = events.find((e): e is Extract<RunEvent, { type: "tool" }> => e.type === "tool" && e.tool === "ask_team");
      expect(asked?.result).toBe("answer to the plan");
      expect(outs(events)).toEqual(["Boss heard: answer to the plan"]);
    });

    it("with several handoffs, the agent's transfer_to choice is the only one that runs", async () => {
      const b = new Builder("Handoffs", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("router", 0, 0, { name: "Router", model: "c_router", harness: { ...native(), loop: "react", max_steps: 3, instructions: "" } })
        .agent("billing", 0, 0, { name: "Billing", model: "c_billing", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .agent("tech", 0, 0, { name: "Tech", model: "c_tech", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .edge("me", "router", "message")
        .edge("router", "billing", "handoff")
        .edge("router", "tech", "handoff")
        .edge("billing", "me", "message")
        .edge("tech", "me", "message");
      b.doc.models.push(mock("c_router", [{ tool: "transfer_to_tech", input: {} }, "This is for tech."]), mock("c_billing", ["billing here"]), mock("c_tech", ["tech here"]));
      const { events } = await run(b.doc, "my laptop will not boot", { mock: false });
      expect(errors(events)).toEqual([]);
      expect(usages(events, "billing").length).toBe(0);
      expect(outs(events)).toEqual(["tech here"]);
    });

    it("an output pipeline that parses JSON asks again when the reply is not JSON", async () => {
      const b = new Builder("Parse", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("a", 0, 0, { name: "A", model: "c_json", interface: { inputs: [port("in", "message")], outputs: [port("out", "json")] }, pipeline: { pre: [], post: [{ id: "p1", op: "parse_json", name: "Parse", on_fail: "retry", max_retries: 2 }] }, harness: { ...native(), loop: "single_shot", instructions: "" } } as never)
        .node("f", "function", 0, 0, { name: "Read ok", fn: { lang: "js", code: 'return "ok is " + input.ok;' }, interface: { inputs: [port("in", "json")], outputs: [port("out", "text")] } })
        .edge("me", "a", "message")
        .edge("a", "f", "message")
        .edge("f", "me", "message");
      b.doc.models.push(mock("c_json", ["Sure! Here it is: not json at all", '{"ok": true}']));
      const { events } = await run(b.doc, "go", { mock: false });
      expect(usages(events, "a").length).toBe(2);
      expect(outs(events)).toEqual(["ok is true"]);
    });

    it("a person in the middle is asked, and their reply is what goes on", async () => {
      const b = new Builder("Person", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("a", 0, 0, { name: "A", model: "c_a", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .node("checker", "human", 0, 0, { name: "Checker", role: "Checks drafts", approves: false })
        .agent("b", 0, 0, { name: "B", model: "c_b", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .edge("me", "a", "message")
        .edge("a", "checker", "message")
        .edge("checker", "b", "message")
        .edge("b", "me", "message");
      b.doc.models.push(mock("c_a", ["draft one"]), mock("c_b", ["B got: {{input}}"]));
      const { events } = await run(b.doc, "go", { mock: false, answer: () => ({ text: "looks fine, ship it" }) });
      expect(events.some((e) => e.type === "human_request" && e.request.kind === "input" && e.request.text === "draft one")).toBe(true);
      expect(outs(events)).toEqual(["B got: looks fine, ship it"]);
    });
  });

  describe("agent loops", () => {
    const mock = (id: string, script: unknown[]) => ({ id, provider: "mock" as const, model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const loopDoc = (loop: string, loop_params: Record<string, string | number | boolean>, models: ReturnType<typeof mock>[]) => {
      const b = new Builder("Loop", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("a", 0, 0, { name: "A", model: models[0].id, harness: { ...native(), loop: loop as never, max_steps: 3, loop_params, instructions: "Do the task." } })
        .edge("me", "a", "message")
        .edge("a", "me", "message");
      b.doc.models.push(...models);
      return b.doc;
    };
    const out = (events: RunEvent[]) => (events.find((e) => e.type === "output") as { text: string }).text;
    const labels = (events: RunEvent[]) => events.filter((e) => e.type === "transform" && (e as { at?: string }).at === "a").map((e) => `${(e as { label: string }).label}: ${(e as { detail: string }).detail}`);

    it("tree search keeps the candidate the evaluator scores highest, however it writes the scores", async () => {
      for (const scoring of ["0 3\n1 9\n2 4", "[0] 3\n[1] 9\n[2] 4", "Candidate 0: 3/10\nCandidate 1: 9/10\nCandidate 2: 4/10", "0=3, 1=9, 2=4"]) {
        const doc = loopDoc("tree_search", { branches: 3, depth: 1, evaluator: "ev" }, [mock("cands", ["first idea", "second idea", "third idea"]), mock("ev", [scoring])]);
        const { events } = await run(doc, "go", { mock: false });
        expect(out(events), scoring).toBe("second idea");
      }
    });

    it("reflexion retries with the critic's lessons until the critic says OK", async () => {
      const doc = loopDoc("reflexion", { max_trials: 3, critic: "crit" }, [mock("actor", ["answer v1", "answer v2"]), mock("crit", ["It misses the edge case.", '"OK"'])]);
      const { events } = await run(doc, "go", { mock: false });
      expect(out(events)).toBe("answer v2");
      expect(usages(events, "a").length).toBe(4); // two answers, two critiques
      expect(labels(events)).toEqual(["critique 1: It misses the edge case.", 'critique 2: "OK"']);
    });

    it("plan and execute writes a plan, follows it, and re-plans once when the result reports a failure", async () => {
      const doc = loopDoc("plan_execute", { planner: "planner" }, [mock("doer", ["I was unable to finish.", "Done, all steps."]), mock("planner", ["1. Try it.", "1. Try it another way."])]);
      const { events } = await run(doc, "go", { mock: false });
      expect(out(events)).toBe("Done, all steps.");
      expect(labels(events)).toEqual(["plan: 1. Try it.", "re-plan: 1. Try it another way."]);
    });
  });

  describe("hooks", () => {
    // me -> a -> me; a can call the function f (ask_f), which echoes what it is asked
    const hooked = (hooks: Record<string, string>, script: unknown[]) => {
      const b = new Builder("Hooks", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("a", 0, 0, { name: "A", model: "h_a", hooks: Object.fromEntries(Object.entries(hooks).map(([k, code]) => [k, { lang: "js", code }])), harness: { ...native(), loop: "react", max_steps: 3, instructions: "Base instructions." } } as never)
        .node("f", "function", 0, 0, { name: "Echo", fn: { lang: "js", code: 'return "echo: " + String(input?.text ?? input);' }, interface: { inputs: [port("in", "message")], outputs: [port("out", "text")] } })
        .edge("me", "a", "message")
        .edge("a", "f", "call")
        .edge("a", "me", "message");
      b.doc.models.push({ id: "h_a", provider: "mock", model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
      return b.doc;
    };
    const toolEvent = (events: RunEvent[]) => events.find((e): e is Extract<RunEvent, { type: "tool" }> => e.type === "tool" && e.tool === "ask_f");
    const out = (events: RunEvent[]) => (events.find((e) => e.type === "output") as { text: string } | undefined)?.text;

    it("before_tool can block a call or rewrite its arguments", async () => {
      const blocked = await run(hooked({ before_tool: "return event.tool.name === 'ask_f' ? null : event;" }, [{ tool: "ask_f", input: { request: "hi" } }, "after: {{input}}"]), "go", { mock: false });
      expect(toolEvent(blocked.events)).toMatchObject({ error: true, result: expect.stringContaining("blocked by the before_tool hook") });
      const rewritten = await run(hooked({ before_tool: "return { ...event, args: { request: 'rewritten' } };" }, [{ tool: "ask_f", input: { request: "hi" } }, "after: {{input}}"]), "go", { mock: false });
      expect(toolEvent(rewritten.events)?.result).toBe("echo: rewritten");
    });

    it("after_tool can rewrite a result; after_model can rewrite the reply", async () => {
      const { events } = await run(hooked({ after_tool: "return { ...event, result: event.result.toUpperCase() };", after_model: "return { text: event.text.replace('after', 'AFTER') };" }, [{ tool: "ask_f", input: { request: "hi" } }, "after: {{input}}"]), "go", { mock: false });
      expect(toolEvent(events)?.result).toBe("ECHO: HI");
      expect(out(events)).toBe("AFTER: ECHO: HI");
    });

    it("before_model may return only what it changes; the rest of the call stays", async () => {
      const { events } = await run(hooked({ before_model: "return { system: event.system + ' Be brief.' };" }, ["fine: {{input}}"]), "go", { mock: false });
      expect(errors(events)).toEqual([]);
      expect(out(events)).toBe("fine: go");
    });
  });

  describe("output stages", () => {
    // me -> a -> (out | alt) -> me; a's reply goes through its output stages
    const staged = (post: unknown[], script: unknown[], json = false) => {
      const b = new Builder("Stages", "");
      b.schema({ id: "Ok", description: "", json_schema: '{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}' });
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("a", 0, 0, { name: "A", model: "s_a", interface: { inputs: [port("in", "message")], outputs: [port("out", json ? "json" : "text"), port("alt", "text")] }, pipeline: { pre: [], post }, harness: { ...native(), loop: "single_shot", instructions: "" } } as never)
        .node("tag", "function", 0, 0, { name: "Tag alt", fn: { lang: "js", code: 'return "via alt: " + String(input?.text ?? input);' }, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } })
        .edge("me", "a", "message")
        .edge("a", "me", "message", { source_port: "out" })
        .edge("a", "tag", "message", { source_port: "alt" })
        .edge("tag", "me", "message");
      b.doc.models.push({ id: "s_a", provider: "mock", model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] });
      return b.doc;
    };
    // an agent with two outputs and no routing sends on both; read the direct one
    const outs = (events: RunEvent[]) => events.filter((e) => e.type === "output").map((e) => (e as { text: string }).text);
    const direct = (events: RunEvent[]) => events.filter((e) => e.type === "output").map((e) => (e as { text: string }).text).filter((t) => !t.startsWith("via alt: "));

    it("redact hides emails, phone numbers, card numbers and keys, each by its own name", async () => {
      const text = "Mail ann@example.com or call +1 415 555 0100. Card 4111 1111 1111 1111. Keys sk-abcdefghijklmnop1234 and AIzaSyA1234567890abcdefghijklmnopqrstuv and AQ.Xx00exampleexampleexample0001.";
      const { events } = await run(staged([{ id: "r", op: "redact", name: "Redact" }], [text]), "go", { mock: false });
      expect(direct(events)).toEqual(["Mail [email] or call [phone]. Card [card]. Keys [secret] and [secret] and [secret]."]);
    });

    it("validate: a reply that breaks the schema is dropped, or passed on raw with a warning", async () => {
      const bad = '{"ok": "yes"}';
      const dropped = await run(staged([{ id: "p", op: "parse_json", name: "Parse" }, { id: "v", op: "validate", name: "Check", schema: "Ok", on_fail: "drop" }], [bad], true), "go", { mock: false });
      expect(direct(dropped.events)).toEqual([]);
      const fallback = await run(staged([{ id: "p", op: "parse_json", name: "Parse" }, { id: "v", op: "validate", name: "Check", schema: "Ok", on_fail: "fallback" }], [bad], true), "go", { mock: false });
      expect(fallback.events.some((e) => e.type === "log" && e.level === "warn" && /Check/.test((e as { text: string }).text))).toBe(true);
      expect(direct(fallback.events).length).toBe(1);
    });

    it("route sends the reply out of the port its function names", async () => {
      const route = { id: "rt", op: "route", name: "Route", fn: { lang: "js", code: 'return String(input?.text ?? input).includes("urgent") ? { alt: input } : { out: input };' } };
      expect(outs((await run(staged([route], ["urgent: fix it"]), "go", { mock: false })).events)).toEqual(["via alt: urgent: fix it"]);
      expect(outs((await run(staged([route], ["all calm"]), "go", { mock: false })).events)).toEqual(["all calm"]);
    });
  });

  it("a knowledge source cannot reach outside the knowledge folder, not even a folder whose name starts the same", async () => {
    const kdir = process.env.MAS_KNOWLEDGE_DIR ?? path.join(dir, "knowledge");
    fs.mkdirSync(kdir, { recursive: true });
    fs.writeFileSync(path.join(kdir, "ok.md"), "Lighthouses guide ships at night.");
    fs.mkdirSync(`${kdir}-backup`, { recursive: true });
    fs.writeFileSync(path.join(`${kdir}-backup`, "secret.md"), "The admin password is hunter2.");
    const b = new Builder("Knowledge", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 0, 0, { name: "A", model: "k_a", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .plugin("kb", "knowledge", 0, 0, { name: "KB", sources: ["ok.md", `../${path.basename(kdir)}-backup/secret.md`] })
      .edge("me", "a", "message")
      .edge("a", "me", "message")
      .edge("a", "kb", "access", { access: "read" });
    b.doc.models.push({ id: "k_a", provider: "mock", model: "mock", api: { params: { script: ["answered"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "What guides ships, and what is the password?", { mock: false });
    expect(events.some((e) => e.type === "log" && /outside the knowledge folder/.test((e as { text: string }).text))).toBe(true);
    expect(JSON.stringify(events)).not.toContain("hunter2");
  });

  it("a call held by the request limit makes the run say why it pauses", async () => {
    const { setRateWindow } = await import("./models");
    const http = await import("node:http");
    const server = http.createServer((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    setRateWindow(300);
    try {
      const b = new Builder("Limited", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("a", 0, 0, { name: "A", model: "limited", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .agent("b", 0, 0, { name: "B", model: "limited", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .edge("me", "a", "message")
        .edge("a", "b", "message")
        .edge("b", "me", "message");
      // one request per window: the second agent's call has to wait
      b.doc.models.push({ id: "limited", provider: "openai_compatible", model: "x", api: { base_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, params: { rpm: 1 } }, price_in: 0, price_out: 0, modalities: ["text"] });
      const { events } = await run(b.doc, "go", { mock: false });
      expect(errors(events)).toEqual([]);
      expect(events.some((e) => e.type === "log" && /^Waiting \d+s: at most 1 requests a minute to openai_compatible/.test((e as { text: string }).text))).toBe(true);
      expect(events.filter((e) => e.type === "output").length).toBe(1);
    } finally {
      setRateWindow(60_000);
      server.close();
    }
  });

  describe("run control", () => {
    // me -> a -> b -> me, both agents slow
    const slow = (delay = 300) => {
      const b = new Builder("Slow", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("a", 0, 0, { name: "A", model: "slow_c", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .agent("b", 0, 0, { name: "B", model: "slow_c", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .edge("me", "a", "message")
        .edge("a", "b", "message")
        .edge("b", "me", "message");
      b.doc.models.push({ id: "slow_c", provider: "mock", model: "mock", api: { params: { script: ["done"], delay_ms: delay } }, price_in: 0, price_out: 0, modalities: ["text"] });
      return b.doc;
    };
    const until = async (id: string) => {
      for (let i = 0; i < 400 && runs.isActive(id); i++) await new Promise((r) => setTimeout(r, 10));
    };

    it("stop: a run stopped mid-way ends at once, as stopped, and nothing after it runs", async () => {
      const doc = slow();
      store.putSystem(doc);
      const rec = runs.start(doc, { input: "go" });
      await new Promise((r) => setTimeout(r, 100));
      runs.stop(rec.id);
      await until(rec.id);
      expect(runs.get(rec.id)).toMatchObject({ status: "stopped", reason: "Stopped" });
      expect(store.events(rec.id).filter((e) => e.type === "usage").length).toBe(0);
    });

    it("time limit: a run that goes past wallclock_min ends with that reason", async () => {
      const doc = slow();
      doc.budget = { ...doc.budget, wallclock_min: 0.005 }; // 0.3 s
      store.putSystem(doc);
      const rec = runs.start(doc, { input: "go" });
      await until(rec.id);
      expect(runs.get(rec.id)).toMatchObject({ status: "finished", reason: "Time limit reached" });
    });

    it("a run waiting for a person can be stopped, and its question is withdrawn", async () => {
      const b = new Builder("Waits", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("a", 0, 0, { name: "A", model: "w_a", harness: { ...native(), loop: "single_shot", instructions: "" } })
        .node("checker", "human", 0, 0, { name: "Checker", role: "", approves: false })
        .edge("me", "a", "message")
        .edge("a", "checker", "message")
        .edge("checker", "me", "message");
      b.doc.models.push({ id: "w_a", provider: "mock", model: "mock", api: { params: { script: ["please check"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
      store.putSystem(b.doc);
      const rec = runs.start(b.doc, { input: "go" });
      for (let i = 0; i < 200 && !(runs.get(rec.id)?.pending?.length); i++) await new Promise((r) => setTimeout(r, 10));
      expect(runs.get(rec.id)?.status).toBe("waiting");
      runs.stop(rec.id);
      await until(rec.id);
      expect(runs.get(rec.id)).toMatchObject({ status: "stopped", pending: [] });
    });

    it("after a restart, runs that were going are marked stopped, with the reason", () => {
      const rec = { id: "run_cut", system_id: "s", system_name: "S", input: "x", status: "running" as const, started_at: new Date().toISOString(), usd: 0, tokens: 0, events: 0, pending: [] };
      store.putRun(rec);
      runs.recover();
      expect(store.getRun("run_cut")).toMatchObject({ status: "stopped", reason: "Server restarted during the run" });
    });
  });

  it("web_search is not offered where it cannot run (non-Anthropic models), and the run says so once", async () => {
    const b = new Builder("Search", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 0, 0, { name: "A", model: "ws", tools: ["web_search"], harness: { ...native(), loop: "react", max_steps: 3, instructions: "" } })
      .edge("me", "a", "message")
      .edge("a", "me", "message");
    // the agent tries the tool anyway: it is not there, so the attempt fails without a provider round trip
    b.doc.models.push({ id: "ws", provider: "mock", model: "mock", api: { params: { script: [{ tool: "web_search", input: { query: "x" } }, "answered from what I know"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "go", { mock: false });
    const warns = events.filter((e) => e.type === "log" && /web_search is left out/.test((e as { text: string }).text));
    expect(warns.length).toBe(1);
    const call = events.find((e): e is Extract<RunEvent, { type: "tool" }> => e.type === "tool" && e.tool === "web_search");
    expect(call === undefined || call.error).toBe(true);
  });

  it("Werewolf keeps secrets: a vision reaches the seer alone, and night choices only the werewolves", async () => {
    const { events } = await run(TEMPLATES.find((t) => t.id === "paper-werewolf")!.build(), "Begin the game.");
    expect(errors(events)).toEqual([]);
    const calls = events.filter((e): e is Extract<typeof e, { type: "message" }> => e.type === "message" && e.kind === "call");
    const visions = calls.filter((e) => e.text.startsWith("Your vision"));
    expect(visions.length).toBeGreaterThan(0);
    expect(new Set(visions.map((e) => e.to))).toEqual(new Set(["carol"]));
    const kills = calls.filter((e) => /to kill tonight/.test(e.text));
    expect(kills.length).toBeGreaterThan(0);
    expect([...new Set(kills.map((e) => e.to))].every((p) => p === "alice" || p === "bob")).toBe(true);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toMatch(/Roles: /);
  });

  it("a stop condition can read a message as text", async () => {
    const b = new Builder("Until", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .group("loop", 200, 0, { name: "Loop", iterate: { max_rounds: 5, until: 'output.includes("DONE")', feed: "output" } })
      .agent("w", 0, 0, { name: "W", model: "w", harness: { ...native(), loop: "single_shot", instructions: "" } }, "loop")
      .edge("me", "loop", "message")
      .edge("loop", "w", "message")
      .edge("w", "loop", "message")
      .edge("loop", "me", "message");
    b.doc.models.push({ id: "w", provider: "mock", model: "mock", api: { params: { script: ["draft", "DONE: final"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "go", { mock: false });
    // round 1 says "draft", round 2 says "DONE": it stops at round 2 instead of running all 5
    expect(usages(events, "w")).toHaveLength(2);
    expect(events.some((e) => e.type === "transform" && e.label === "rounds done" && /holds/.test(e.detail))).toBe(true);
  });

  it("iterate.over tries the items of a list in turn, each with its own inner rounds, until one passes", async () => {
    const b = new Builder("Plans", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .group("plans", 200, 0, { name: "Plans", iterate: { max_rounds: 10, over: "JSON.parse(input).sort((a, b) => b.c - a.c).map((p) => p.name)", until: 'output.includes("PASS")' } })
      .group("repair", 0, 0, { name: "Repair", iterate: { max_rounds: 2, until: 'output.includes("PASS")', feed: "output" } }, "plans")
      .agent("w", 0, 0, { name: "W", model: "w", harness: { ...native(), loop: "single_shot", instructions: "" } }, "repair")
      .edge("me", "plans", "message")
      .edge("plans", "repair", "message")
      .edge("repair", "w", "message")
      .edge("w", "repair", "message")
      .edge("repair", "plans", "message")
      .edge("plans", "me", "message");
    // the best plan fails both of its repair rounds; the second passes at once; the third is never tried
    b.doc.models.push({ id: "w", provider: "mock", model: "mock", api: { params: { script: ["broken 1", "broken 2", "PASS with plan B"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const plans = JSON.stringify([{ name: "plan C", c: 0.2 }, { name: "plan A", c: 0.9 }, { name: "plan B", c: 0.5 }]);
    const { events } = await run(b.doc, plans, { mock: false });
    expect(errors(events)).toEqual([]);
    const calls = events.filter((e): e is Extract<typeof e, { type: "message" }> => e.type === "message" && e.to === "w").map((e) => e.text);
    expect(calls).toEqual(["plan A", "broken 1", "plan B"]);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toBe("PASS with plan B");
    const tries = events.filter((e): e is Extract<typeof e, { type: "transform" }> => e.type === "transform" && e.at === "plans");
    expect(tries[0]).toMatchObject({ label: "round 1 of ≤3", detail: expect.stringContaining("item 1 of 3") });
    expect(tries.some((e) => e.label === "round 2 of ≤3" && /item 2 of 3/.test(e.detail))).toBe(true);
    expect(tries.some((e) => e.label === "rounds done" && /holds \(round 2\)/.test(e.detail))).toBe(true);
  });

  it("an agent's instructions read run variables: {{vars.k ?? 3}} is the run's k, or 3", async () => {
    const doc = () => {
      const b = new Builder("Vars", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("w", 200, 0, { name: "W", model: "w", harness: { ...native(), loop: "single_shot", instructions: "Write {{vars.k ?? 3}} plans for {{input}}." } })
        .edge("me", "w", "message")
        .edge("w", "me", "message");
      b.doc.models.push({ id: "w", provider: "mock", model: "mock", api: { params: { script: ["{{system}}"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
      return b.doc;
    };
    const told = async (vars?: Record<string, unknown>) => ((await run(doc(), "go", { mock: false, vars })).events.find((e) => e.type === "output") as { text: string }).text;
    expect(await told({ k: 5 })).toContain("Write 5 plans for {{input}}.");
    expect(await told()).toContain("Write 3 plans");
  });

  it("a function component calls a connected env's tool with ctx.tool, with no model, as a tool event", async () => {
    const b = new Builder("Fn tool", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("run", "function", 200, 0, { name: "Runner", fn: { lang: "js", code: 'const r = await ctx.tool("run_sql", { sql: "SELECT 6 * 7 AS n" });\nreturn "ran: " + r.replace(/\\s+/g, " ");' } })
      .node("db", "env", 200, 200, { name: "DB", env_kind: "database", image: "", db: { mode: "tools", templates: [], tables: [], read_only: true, row_limit: 10, model: null, fn: null } })
      .edge("me", "run", "message")
      .edge("run", "me", "message")
      .edge("run", "db", "access", { access: "read" });
    const { events } = await run(b.doc, "go", { mock: false });
    expect(errors(events)).toEqual([]);
    const tool = events.find((e) => e.type === "tool") as { node: string; tool: string; result: string } | undefined;
    expect(tool).toMatchObject({ node: "run", tool: "run_sql" });
    expect((events.find((e) => e.type === "output") as { text: string }).text).toMatch(/ran: .*"n": 42/);
    expect(events.filter((e) => e.type === "usage")).toHaveLength(0);
  });

  it("a function in a room replies on its own when it has something to say, and stays silent otherwise", async () => {
    const b = new Builder("Room fn", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("coder", 200, 0, { name: "Coder", model: "w", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .node("proxy", "function", 200, 200, { name: "Proxy", fn: { lang: "js", code: 'return /```/.test(String(input)) ? "output: 42" : null;' } })
      .node("chat", "env", 400, 100, { name: "Chat", env_kind: "room", image: "", room: { policy: "round_robin", history: "persistent" } })
      .edge("me", "chat", "access", { access: "read_write" })
      .edge("coder", "chat", "access", { access: "read_write" })
      .edge("proxy", "chat", "access", { access: "read_write" });
    b.doc.termination = ['text.includes("DONE")'];
    b.doc.models.push({ id: "w", provider: "mock", model: "mock", api: { params: { script: ["```python\nprint(6*7)\n```", "The answer is 42. DONE"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "compute 6*7", { mock: false });
    expect(errors(events)).toEqual([]);
    const said = events.filter((e): e is Extract<typeof e, { type: "message" }> => e.type === "message" && e.to === "chat").map((e) => `${e.from}: ${e.text.split("\n")[0]}`);
    expect(said).toEqual(["me: compute 6*7", "coder: ```python", "proxy: output: 42", "coder: The answer is 42. DONE"]);
    expect(events.some((e) => e.type === "transform" && e.at === "proxy" && e.detail === "stays silent")).toBe(true);
  });

  it("ctx.state keeps what a system's code learned from one run to the next", async () => {
    const b = new Builder("Learns", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("count", "function", 200, 0, { name: "Count", fn: { lang: "js", code: 'const n = (ctx.state.get("runs") ?? 0) + 1;\nctx.state.set("runs", n);\nreturn "run " + n;' } })
      .edge("me", "count", "message")
      .edge("count", "me", "message");
    const doc = { ...b.doc, id: "sys_learns" };
    const out = async () => ((await run(doc, "go", { mock: false })).events.find((e) => e.type === "output") as { text: string }).text;
    expect(await out()).toBe("run 1");
    expect(await out()).toBe("run 2");
  });

  it("an agent whose env cannot start fails its turn instead of acting without it", async () => {
    const b = new Builder("No env", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 200, 0, { name: "Walker", model: "w", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .node("town", "env", 200, 200, {
        name: "Town",
        env_kind: "service",
        image: "",
        manifest: { contract: "mas-env/1", id: "t", name: "Town", source: { format: "mas-env" }, kind: "service", runtime: { services: [] }, lifecycle: { health: "http://127.0.0.1:9/health" }, exposes: { mcp: { transport: "http", url: "http://127.0.0.1:9/mcp", auth: "none", tools: ["look"] }, http: [] } },
      })
      .edge("me", "a", "message")
      .edge("a", "me", "message")
      .edge("a", "town", "access", { access: "read_write" });
    b.doc.models.push({ id: "w", provider: "mock", model: "mock", api: { params: { script: ["I walk to the park."] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "go", { mock: false });
    expect(errors(events).join(" ")).toMatch(/Town is unavailable, so Walker cannot act in it/);
    expect(events.some((e) => e.type === "output" && /walk to the park/.test((e as { text: string }).text))).toBe(false);
  });

  it("a function calls connected components with ctx.call: control flow in code, each call a message", async () => {
    const b = new Builder("Fn call", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("loop", "function", 200, 0, { name: "Loop", fn: { lang: "js", code: 'let x = Number(String(input?.text ?? input));\nfor (let i = 0; i < 2; i++) x = Number(await ctx.call("Adder", String(x)));\nconst said = await ctx.call("judge", "is " + x + " right?");\nreturn "x = " + x + "; judge: " + said;' } })
      .node("add", "function", 400, 0, { name: "Adder", fn: { lang: "js", code: "return Number(String(input?.text ?? input)) + 10;" } })
      .node("judge", "model", 400, 200, { name: "Judge", model: "j", system_prompt: "", prompt: "{{input}}", temperature: null, max_tokens: null, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } })
      .edge("me", "loop", "message")
      .edge("loop", "me", "message")
      .edge("loop", "add", "call")
      .edge("loop", "judge", "call");
    b.doc.models.push({ id: "j", provider: "mock", model: "mock", api: { params: { script: ["yes"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "1", { mock: false });
    expect(errors(events)).toEqual([]);
    expect((events.find((e) => e.type === "output") as { text: string }).text).toBe("x = 21; judge: yes");
    const msgs = events.filter((e): e is Extract<typeof e, { type: "message" }> => e.type === "message");
    expect(msgs.filter((m) => m.kind === "call").map((m) => m.to)).toEqual(["add", "add", "judge"]);
    expect(msgs.filter((m) => m.kind === "reply").map((m) => `${m.from}: ${m.text}`)).toEqual(["add: 11", "add: 21", "judge: yes"]);
    // its own answer goes to its message edge only, not to what it calls
    expect(msgs.filter((m) => m.from === "loop" && m.kind !== "call").map((m) => m.to)).toEqual(["me"]);
  });

  it("tells an agent with a sandbox where a long input is saved, and says nothing for a short one", async () => {
    const build = () => {
      const b = new Builder("Box note", "");
      b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
        .agent("a", 200, 0, { name: "Coder", model: "echo_box", harness: { ...native(), loop: "single_shot", instructions: "Compute." } })
        .node("box", "env", 200, 200, { name: "Box", env_kind: "sandbox", image: "python:3.12-slim", lifecycle: "per_run" })
        .edge("me", "a", "message")
        .edge("a", "me", "message")
        .edge("a", "box", "access", { access: "read_write" });
      b.doc.models.push({ id: "echo_box", provider: "mock", model: "mock", api: { params: { script: ["{{system}} || {{input}}"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
      return b.doc;
    };
    const long = "What is the total?\n---\n" + "2024-01-02 | customer Ashby | paid $12\n".repeat(80);
    const said = async (input: string) => ((await run(build(), input, { mock: false })).events.find((e) => e.type === "output") as { text: string }).text;
    expect(await said(long)).toMatch(/saved in Box at \/work\/input\.txt/);
    expect(await said("What is 6 * 7?")).not.toMatch(/input\.txt/);
  });

  it("ctx.call names what a function can call when the name is not one of them", async () => {
    const b = new Builder("Fn call miss", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("loop", "function", 200, 0, { name: "Loop", fn: { lang: "js", code: 'return await ctx.call("Nobody", "hi");' } })
      .node("add", "function", 400, 0, { name: "Adder", fn: { lang: "js", code: "return 1;" } })
      .edge("me", "loop", "message")
      .edge("loop", "me", "message")
      .edge("loop", "add", "call");
    const { events } = await run(b.doc, "1", { mock: false });
    expect(errors(events).join(" ")).toMatch(/no call connection to Nobody \(it can call Adder\)/);
  });

  it("ctx.tool names what a function is connected to when the tool is not there", async () => {
    const b = new Builder("Fn tool", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("run", "function", 200, 0, { name: "Runner", fn: { lang: "js", code: 'return await ctx.tool("bash", { command: "id" });' } })
      .node("db", "env", 200, 200, { name: "DB", env_kind: "database", image: "", db: { mode: "tools", templates: [], tables: [], read_only: true, row_limit: 10, model: null, fn: null } })
      .edge("me", "run", "message")
      .edge("run", "me", "message")
      .edge("run", "db", "access", { access: "read" });
    const { events } = await run(b.doc, "go", { mock: false });
    expect(errors(events).join(" ")).toMatch(/no tool bash on what Runner is connected to \(it has run_sql\)/);
  });

  it("iterate.over that finds no list runs the whole input once, and says why", async () => {
    const b = new Builder("Plans", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .group("plans", 200, 0, { name: "Plans", iterate: { max_rounds: 3, over: "input.plans" } })
      .agent("w", 0, 0, { name: "W", model: "w", harness: { ...native(), loop: "single_shot", instructions: "" } }, "plans")
      .edge("me", "plans", "message")
      .edge("plans", "w", "message")
      .edge("w", "plans", "message")
      .edge("plans", "me", "message");
    b.doc.models.push({ id: "w", provider: "mock", model: "mock", api: { params: { script: ["done"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "just text", { mock: false });
    expect(usages(events, "w")).toHaveLength(1);
    expect(events.some((e) => e.type === "log" && e.level === "warn" && /iterate.over input.plans gave no list/.test(e.text))).toBe(true);
  });

  it("Chain-of-Agents reads a long input part by part, then the manager answers once", async () => {
    const doc = "word ".repeat(1400); // 7000 characters: three parts of 3000
    const { events } = await run(TEMPLATES.find((t) => t.id === "paper-chain-of-agents")!.build(), "What is it about?\n---\n" + doc);
    expect(errors(events)).toEqual([]);
    expect(usages(events, "worker")).toHaveLength(3);
    expect(usages(events, "manager")).toHaveLength(1);
    // every worker call carries the question, and none carries the whole document
    const toWorker = events.filter((e) => e.type === "message" && e.kind === "call" && (e as { to: string }).to === "worker") as { text: string }[];
    expect(toWorker.every((e) => e.text.startsWith("Question: What is it about?") && e.text.length < 4000)).toBe(true);
  });

  it("memory written by the platform: no write tool for the agent, its work shown, its cost its own", async () => {
    const b = new Builder("Mem", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 300, 0, { name: "Helper", model: "sonnet", harness: { ...native(), instructions: "" } })
      .plugin("mem", "memory", 300, 200, {})
      .edge("me", "a", "message")
      .edge("a", "me", "message")
      .edge("a", "mem", "access", { access: "read_write" });
    b.doc.edges.find((e) => e.target === "mem")!.binding = { mode: "auto_inject", read: { top_k: 5 }, write: { when: "after_turn" } };
    const { agentTools } = await import("./agent/tools");
    const { Hub } = await import("./resources/hub");
    const { Models } = await import("./models");
    const rc = { doc: b.doc, byId: new Map(b.doc.nodes.map((n) => [n.id, n])), models: new Models(b.doc.models, new Secrets(dir), true), emit: () => undefined, store, config, runId: "t", vars: {} } as unknown as import("./context").RunCtx;
    const { tools } = await agentTools({ rc, hub: new Hub(rc), call: async () => "", spawn: async () => "", finish: () => undefined }, b.doc.nodes.find((n) => n.id === "a") as never, new Set());
    expect(tools.map((t) => t.name)).toEqual(["memory_search"]);
    const { events } = await run(b.doc, "I like tea");
    expect(errors(events)).toEqual([]);
    expect(events.some((e) => e.type === "transform" && e.label.startsWith("remember") && /found/.test(e.detail))).toBe(true);
    // the extraction and classification calls are billed to the memory, not to the agent
    expect(usages(events, "mem").length).toBeGreaterThan(0);
    expect(usages(events, "a")).toHaveLength(1);
  });

  it("a database's tools describe its tables, and SQL is pulled out of what a model writes", async () => {
    const { DatabaseEnv } = await import("./resources/envs/database");
    expect(DatabaseEnv.statements("Here you go:\n```sql\n-- revenue\nSELECT 1;\nSELECT 2\n```")).toEqual(["SELECT 1", "SELECT 2"]);
    expect(DatabaseEnv.statements("DELETE FROM orders")).toEqual([]);
    const { DatabaseSync } = await import("node:sqlite");
    const file = path.join(dir, "shop.sqlite");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), total REAL);");
    db.close();
    const b = new Builder("DB", "");
    b.agent("a", 0, 0, { name: "A", model: "sonnet", harness: { ...native(), instructions: "" } })
      .node("shop", "env", 0, 200, { name: "Shop", env_kind: "database", image: `sqlite:${file}`, db: { mode: "text_to_sql", templates: [], tables: [], read_only: true, row_limit: 10, model: null, fn: null } })
      .edge("a", "shop", "access", { access: "read" });
    const { Hub } = await import("./resources/hub");
    const { Models } = await import("./models");
    const rc = { doc: b.doc, byId: new Map(b.doc.nodes.map((n) => [n.id, n])), models: new Models(b.doc.models, new Secrets(dir), true), emit: () => undefined, store, config, runId: "t", vars: {} } as unknown as import("./context").RunCtx;
    const hub = new Hub(rc);
    const tools = await hub.get("shop").tools(b.doc.edges[0]);
    expect(tools.find((t) => t.name === "run_sql")!.description).toContain("customers(id, name); orders(id, customer_id→customers, total)");
    expect(await tools.find((t) => t.name === "run_sql")!.run({ sql: "DROP TABLE orders" }, { node: "a" }).catch((e) => e.message)).toMatch(/read-only/);
    await hub.closeAll();
  });

  it("a custom loop sees every agent call it made in ctx.history", async () => {
    const b = new Builder("History", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("boss", 200, 0, { name: "Boss", model: "sonnet", harness: { ...native(), loop: "custom", loop_fn: { lang: "js", code: "await tools.call_agent('Coder', 'write it');\nawait tools.call_agent('Coder', 'again');\nreturn ctx.history.map((h) => h.speaker).join(',');" }, instructions: "" } })
      .agent("coder", 400, 0, { name: "Coder", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .edge("me", "boss", "message")
      .edge("boss", "me", "message")
      .edge("boss", "coder", "call");
    const { events } = await run(b.doc, "go");
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toBe("Coder,Coder");
  });

  it("an agent that runs out of steps still answers", async () => {
    const b = new Builder("Steps", "");
    // it calls a tool every step and never answers on its own; the forced final answer comes back empty
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 200, 0, { name: "Busy", model: "busy", tools: ["fetch"], harness: { ...native(), max_steps: 2, instructions: "" } })
      .edge("me", "a", "message")
      .edge("a", "me", "message");
    b.doc.models.push({ id: "busy", provider: "mock", model: "mock", api: { params: { script: [{ text: "Looking it up.", tool: "fetch", input: { url: "https://example.invalid" } }, { tool: "fetch", input: { url: "https://example.invalid" } }, ""] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "go", { mock: false });
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toBe("Looking it up.");
  });

  it("an agent that runs out of steps with no words returns the last program it wrote", async () => {
    const b = new Builder("Steps", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 200, 0, { name: "Coder", model: "coder", tools: ["fetch"], harness: { ...native(), max_steps: 2, instructions: "" } })
      .edge("me", "a", "message")
      .edge("a", "me", "message");
    // it writes two versions of a program and never says anything; the forced final answer is empty (the mock calls
    // only tools the agent has, so the program goes through fetch's input here: the loop reads any call's path and
    // content, as the sandbox's edit_file takes them)
    b.doc.models.push({ id: "coder", provider: "mock", model: "mock", api: { params: { script: [{ tool: "fetch", input: { url: "https://example.invalid", path: "sol.py", content: "print(1)" } }, { tool: "fetch", input: { url: "https://example.invalid", path: "sol.py", content: "print(2)\n" } }, ""] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "go", { mock: false });
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toContain("My last program (sol.py):");
    expect(out.text).toContain("```python\nprint(2)\n```");
  });

  it("out of steps, the last program is read from a shell heredoc too, a test file passed over", async () => {
    const b = new Builder("Steps", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 200, 0, { name: "Coder", model: "coder2", tools: ["fetch"], harness: { ...native(), max_steps: 2, instructions: "" } })
      .edge("me", "a", "message")
      .edge("a", "me", "message");
    // the solution in a heredoc, then a brute-force test file: the solution is the answer
    const sol = "cat << 'EOF' > sol.py\nimport sys\nprint(sum(map(int, sys.stdin.read().split())))\nEOF\npython3 sol.py < in.txt";
    const test = "cat << 'EOF' > test_sol.py\nprint('brute force')\nEOF";
    b.doc.models.push({ id: "coder2", provider: "mock", model: "mock", api: { params: { script: [{ tool: "fetch", input: { url: "https://example.invalid", command: sol } }, { tool: "fetch", input: { url: "https://example.invalid", command: test } }, ""] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "go", { mock: false });
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toContain("My last program (sol.py):");
    expect(out.text).toContain("print(sum(map(int, sys.stdin.read().split())))");
    expect(out.text).not.toContain("brute force");
  });

  it("a tool an env already serves is offered once", async () => {
    const b = new Builder("Tools", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 200, 0, { name: "Coder", model: "sonnet", tools: ["bash"], harness: { ...native(), loop: "single_shot", instructions: "" } })
      .node("box", "env", 200, 200, { name: "Box", env_kind: "sandbox", image: "python:3.12-slim" })
      .edge("me", "a", "message")
      .edge("a", "me", "message")
      .edge("a", "box", "access", { access: "read_write" });
    const { agentTools } = await import("./agent/tools");
    const { Hub } = await import("./resources/hub");
    const { Models } = await import("./models");
    const rc = { doc: b.doc, byId: new Map(b.doc.nodes.map((n) => [n.id, n])), models: new Models(b.doc.models, new Secrets(dir), true), emit: () => undefined, store, config, runId: "t", vars: {} } as unknown as import("./context").RunCtx;
    const hub = new Hub(rc);
    const { tools } = await agentTools({ rc, hub, call: async () => "", spawn: async () => "", finish: () => undefined }, b.doc.nodes.find((n) => n.id === "a") as never, new Set());
    const names = tools.map((t) => t.name);
    expect(names.filter((n) => n.startsWith("bash"))).toEqual(["bash"]);
  });

  it("asks an approver and continues with the answer", async () => {
    const b = new Builder("Approve", "");
    b.agent("a", 0, 0, { name: "Agent", model: "m", harness: { ...native(), instructions: "" } })
      .node("boss", "human", 300, 0, { name: "Boss", role: "", approves: true })
      .edge("a", "boss", "call");
    b.doc.models.push({ id: "m", provider: "mock", model: "mock", api: { params: { script: [{ tool: "ask_boss", input: { request: "may I?" } }, "Got: {{input}}"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "go", { mock: false, answer: () => ({ approved: false, text: "not today" }) });
    expect(events.some((e) => e.type === "human_request" && e.request.kind === "approval")).toBe(true);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toContain("Rejected. not today");
  });

  it("routes a function's output by the keys it returns", async () => {
    const b = new Builder("Route", "");
    b.node("f", "function", 0, 0, { name: "Router", join: "any", fn: { lang: "js", code: "return input.text.includes('bill') ? { billing: input } : { tech: input };" }, interface: { inputs: [{ id: "in", type: "message" }], outputs: [{ id: "billing", type: "message" }, { id: "tech", type: "message" }] } })
      .agent("bill", 300, 0, { name: "Billing", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .agent("tech", 300, 200, { name: "Tech", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .edge("f", "bill", "message", { source_port: "billing" })
      .edge("f", "tech", "message", { source_port: "tech" });
    const { events } = await run(b.doc, "my bill is wrong");
    expect(errors(events)).toEqual([]);
    expect(usages(events, "bill")).toHaveLength(1);
    expect(usages(events, "tech")).toHaveLength(0);
  });

  it("runs template, jsonata and python transforms on edges", async () => {
    const b = new Builder("Fns", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("f1", "function", 200, 0, { name: "Upper", join: "any", fn: { lang: "jsonata", code: "$uppercase(text)" }, interface: { inputs: [{ id: "in", type: "message" }], outputs: [{ id: "out", type: "text" }] } })
      .node("f2", "function", 400, 0, { name: "Py", join: "any", fn: { lang: "python", code: "return input + '!'" }, interface: { inputs: [{ id: "in", type: "text" }], outputs: [{ id: "out", type: "text" }] } })
      .node("sink", "human", 600, 0, { name: "Sink", role: "", approves: false })
      .edge("me", "f1", "message")
      .edge("f1", "f2", "message", { transform: { lang: "template", code: "<{{input}}>" } })
      .edge("f2", "sink", "message");
    const { events } = await run(b.doc, "hi");
    expect(errors(events)).toEqual([]);
    const out = events.find((e) => e.type === "output") as { text: string };
    expect(out.text).toBe("<HI>!");
  });

  it("lets a transform deep in a pipeline see the run's original input", async () => {
    const b = new Builder("Input", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("f1", "function", 200, 0, { name: "Shorten", join: "any", fn: { lang: "js", code: "return 'plan';" }, interface: { inputs: [{ id: "in", type: "message" }], outputs: [{ id: "out", type: "text" }] } })
      .node("sink", "human", 400, 0, { name: "Sink", role: "", approves: false })
      .edge("me", "f1", "message")
      .edge("f1", "sink", "message", { transform: { lang: "template", code: "Problem: {{run_input}} / {{input}}" } });
    const { events } = await run(b.doc, "add two numbers");
    expect(errors(events)).toEqual([]);
    expect((events.find((e) => e.type === "output") as { text: string }).text).toBe("Problem: add two numbers / plan");
  });

  it("samples a model component several times and sends the list (replicas), sized per run by a variable", async () => {
    const b = new Builder("Forest", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("s", "model", 200, 0, { name: "Samples", model: "m_s", system_prompt: "", prompt: "{{input}}", temperature: 0.8, max_tokens: null, replicas: "{{vars.n}}", interface: { inputs: [{ id: "in", type: "text" }], outputs: [{ id: "out", type: "json" }] } })
      .node("vote", "function", 400, 0, { name: "Vote", join: "any", fn: { lang: "js", code: "const c = {}; for (const a of input) c[a] = (c[a] ?? 0) + 1; return Object.entries(c).sort((x, y) => y[1] - x[1])[0][0] + ' of ' + input.length;" }, interface: { inputs: [{ id: "in", type: "json" }], outputs: [{ id: "out", type: "text" }] } })
      .node("sink", "human", 600, 0, { name: "Sink", role: "", approves: false })
      .edge("me", "s", "message")
      .edge("s", "vote", "message")
      .edge("vote", "sink", "message");
    b.doc.models.push({ id: "m_s", provider: "mock", model: "mock", api: { params: { script: ["42", "41", "42", "42", "40"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    const { events } = await run(b.doc, "what is 6 x 7?", { mock: false, vars: { n: 5 } });
    expect(errors(events)).toEqual([]);
    expect(usages(events, "s").length).toBe(5);
    expect((events.find((e) => e.type === "output") as { text: string }).text).toBe("42 of 5");
    expect(validate(b.doc).filter((i) => i.severity !== "info").map((i) => i.message)).toEqual([]);
    // one sample from the variable is still a list of one, so the vote reads the same shape
    resetMock();
    const one = await run(b.doc, "what is 6 x 7?", { mock: false, vars: { n: 1 } });
    expect((one.events.find((e) => e.type === "output") as { text: string }).text).toMatch(/ of 1$/);
  });

  it("reads replicas as a plain call at 1, and refuses sizes out of range", () => {
    expect(replicaCount(undefined, {})).toBeNull();
    expect(replicaCount(1, {})).toBeNull();
    expect(replicaCount("{{vars.n}}", { n: 3 })).toBe(3);
    expect(replicaCount("{{ vars.n }}", { n: "7" })).toBe(7);
    expect(() => replicaCount(51, {})).toThrow(/from 1 to 50/);
    expect(() => replicaCount("{{vars.n}}", {})).toThrow(/does not set/);
    expect(replicaCount("{{vars.n ?? 10}}", {})).toBe(10);
    expect(replicaCount("{{vars.n ?? 10}}", { n: 3 })).toBe(3);
    const b = new Builder("Bad", "");
    b.node("s", "model", 0, 0, { name: "S", model: "sonnet", system_prompt: "", prompt: "", temperature: null, max_tokens: null, replicas: 80, interface: { inputs: [{ id: "in", type: "text" }], outputs: [{ id: "out", type: "text" }] } });
    const msgs = validate(b.doc).map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/whole number from 1 to 50/);
    expect(msgs).toMatch(/make it json/);
  });

  it("checks a finished run's answer against the result the system declares", async () => {
    const b = new Builder("Coder", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 200, 0, { name: "Coder", model: "m_c", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .edge("me", "a", "message")
      .edge("a", "me", "message");
    b.doc.models.push({ id: "m_c", provider: "mock", model: "mock", api: { params: { script: ["ALL TESTS PASSED"] } }, price_in: 0, price_out: 0, modalities: ["text"] });
    b.doc.result = { type: "code" };
    const bad = await run(b.doc, "write f", { mock: false });
    expect(bad.rec.result_check).toMatchObject({ type: "code", ok: false });
    expect(bad.events.some((e) => e.type === "log" && e.level === "warn" && /should be code/.test(e.text))).toBe(true);
    resetMock();
    b.doc.models[b.doc.models.length - 1].api.params = { script: ["```python\ndef f():\n    return 1\n```"] };
    const good = await run(b.doc, "write f", { mock: false });
    expect(good.rec.result_check).toMatchObject({ ok: true });
  });

  it("takes a group's round limit from a run variable, with a default", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-debate")!.build();
    const g = doc.nodes.find((n) => n.id === "debate")!.data as { iterate: { max_rounds: number | string } };
    g.iterate.max_rounds = "{{vars.rounds ?? 2}}";
    const byDefault = await run(doc, "2 + 2?");
    expect(usages(byDefault.events).length).toBe(6);
    const three = await run(doc, "2 + 2?", { vars: { rounds: 3 } });
    expect(usages(three.events).length).toBe(9);
    // the Rounds tab reads the limit the run used
    expect(roundsOf(three.events, doc)[0]).toMatchObject({ max_rounds: 3 });
    expect(roundsOf(three.events, doc)[0].rounds).toHaveLength(3);
  });

  it("stops at the round limit", async () => {
    const b = new Builder("Loop", "");
    b.agent("a", 0, 0, { name: "A", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .agent("b", 300, 0, { name: "B", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .edge("a", "b", "message")
      .edge("b", "a", "message");
    b.doc.budget = { usd: null, max_rounds: 5, wallclock_min: null };
    const { rec } = await run(b.doc);
    expect(rec.reason).toBe("Round limit reached");
    expect(usages(store.events(rec.id))).toHaveLength(5);
  });

  it("gives a room conversation stopped at the round limit its last message as the answer", async () => {
    const b = new Builder("Chat", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false }).room("chat", 0, 0, "chat", { policy: "round_robin", history: "since_join" });
    b.edge("me", "chat", "access", { access: "read_write", binding: { mode: "tool", write: { when: "agent_tool" } } });
    for (const id of ["a", "b"]) {
      b.agent(id, 0, 0, { name: id.toUpperCase(), model: `m_${id}`, harness: { ...native(), loop: "single_shot", instructions: "" } });
      b.doc.models.push({ id: `m_${id}`, provider: "mock", model: "mock", api: { params: { script: [`${id} says more`] } }, price_in: 0, price_out: 0, modalities: ["text"] });
      b.edge(id, "chat", "access", { access: "read_write" });
    }
    b.doc.budget = { usd: null, max_rounds: 5, wallclock_min: null };
    const { rec } = await run(b.doc, "go", { mock: false });
    expect(rec.reason).toBe("Round limit reached");
    const events = store.events(rec.id);
    const out = events.filter((e) => e.type === "output") as { text: string }[];
    expect(out.length).toBe(1);
    expect(out[0].text).toMatch(/says more/);
    expect(events.some((e) => e.type === "log" && (e as { text: string }).text.includes("did not end on its own"))).toBe(true);
  });

  it("remembers across runs through a memory plugin", async () => {
    const b = new Builder("Mem", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .agent("a", 300, 0, { name: "Helper", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "" } })
      .plugin("mem", "memory", 300, 200, {})
      .edge("me", "a", "message")
      .edge("a", "me", "message")
      .edge("a", "mem", "access", { access: "read_write" });
    const memNode = b.doc.nodes.find((n) => n.id === "mem")!;
    if (memNode.data.kind === "plugin") memNode.data.spec.memory = { ...memNode.data.spec.memory!, extract: { use: "whole_turn" }, classify: { use: "none" }, merge: { use: "append" } };
    const edge = b.doc.edges.find((e) => e.target === "mem")!;
    edge.binding = { mode: "auto_inject", read: { top_k: 5 }, write: { when: "after_turn" } };
    await run(b.doc, "My favourite colour is teal");
    const { events } = await run(b.doc, "What is my favourite colour?");
    expect(errors(events)).toEqual([]);
    expect(events.some((e) => e.type === "transform" && e.label.startsWith("retrieve"))).toBe(true);
    expect(events.some((e) => e.type === "transform" && e.label.startsWith("remember"))).toBe(true);
  });

  it("reproduces the paper templates' call counts", async () => {
    const moa = TEMPLATES.find((t) => t.id === "paper-moa")!.build();
    const r1 = await run(moa, "Explain tides");
    expect(errors(r1.events)).toEqual([]);
    expect(usages(r1.events)).toHaveLength(7);
    const debate = TEMPLATES.find((t) => t.id === "paper-debate")!.build();
    const r2 = await run(debate, "What is 17*23?");
    expect(errors(r2.events)).toEqual([]);
    // three debaters, two rounds
    expect(usages(r2.events)).toHaveLength(6);
    expect(r2.events.some((e) => e.type === "transform" && e.label === "rounds done")).toBe(true);
  });

  it("wakes room members only for the message types they subscribe to (MetaGPT)", async () => {
    const doc = TEMPLATES.find((t) => t.id === "paper-metagpt")!.build();
    doc.budget = { usd: null, max_rounds: 6, wallclock_min: null };
    const { events } = await run(doc, "A CLI todo app");
    const order = events.filter((e) => e.type === "status" && e.status === "working").map((e) => (e as { node: string }).node);
    expect(order.slice(0, 4)).toEqual(["pm", "architect", "project", "engineer"]);
    const tags = events.filter((e) => e.type === "message" && e.room === "pool").map((e) => (e as { port?: string }).port);
    expect(tags.slice(0, 4)).toEqual(["UserRequirement", "WritePRD", "WriteDesign", "WriteTasks"]);
  });

  it("dry-runs every built-in template to the end without errors", async () => {
    for (const t of TEMPLATES.filter((x) => x.id !== "blank")) {
      const { rec, events } = await run(t.build(), "Build a small todo app");
      expect({ template: t.id, errors: errors(events) }).toEqual({ template: t.id, errors: [] });
      expect({ template: t.id, status: rec.status }).toEqual({ template: t.id, status: "finished" });
      // a template that lives in a hosted service (Generative Agents' town) cannot reach it here: it ends cleanly,
      // saying what is missing, before any model call
      const hosted = /"hosted":\{"service"/.test(JSON.stringify(t.build()));
      if (!hosted) expect(usages(events).length, t.id).toBeGreaterThan(0);
    }
  }, 60_000);
});
