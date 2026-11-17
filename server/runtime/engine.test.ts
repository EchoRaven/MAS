// @vitest-environment node
// End-to-end runs on the built-in test model: real scheduling, edges,
// functions, plugins, people and budgets; only the model text is canned.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TEMPLATES } from "@/model/templates";
import { Builder, native } from "@/model/builder";
import type { RunEvent, RunRecord } from "@/run/events";
import type { AgentData, SystemDoc } from "@/model/types";
import type { Config } from "../config";
import { Store } from "../store/files";
import { Secrets } from "../store/secrets";
import { resetMock } from "./models/mock";
import { RunManager } from "./runs";

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
    const { tools } = await agentTools({ rc, hub: new Hub(rc), call: async () => "", spawn: async () => "" }, b.doc.nodes.find((n) => n.id === "a") as never, new Set());
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
    const { tools } = await agentTools({ rc, hub, call: async () => "", spawn: async () => "" }, b.doc.nodes.find((n) => n.id === "a") as never, new Set());
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
      expect(usages(events).length, t.id).toBeGreaterThan(0);
    }
  }, 60_000);
});
