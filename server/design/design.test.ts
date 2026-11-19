// @vitest-environment node
// The architect's editing surface, and the loop that drives it on the test model.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { conformSystem } from "@/model/conformance";
import { entryPoints } from "@/model/entry";
import { validate } from "@/model/validate";
import { fromYaml, toYaml } from "@/model/yaml";
import { Secrets } from "../store/secrets";
import { Models } from "../runtime/models";
import { resetMock } from "../runtime/models/mock";
import { design } from "./architect";
import { Draft } from "./draft";
import { runDesignTool } from "./tools";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-design-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const models = (script: unknown[]) => {
  resetMock(); // the scripted replies are counted per model, so each test starts at the top of its own script
  return new Models([{ id: "m", provider: "mock", model: "mock", api: { params: { script } }, price_in: 0, price_out: 0, modalities: ["text"] }], new Secrets(dir));
};

describe("the draft the architect edits", () => {
  it("builds a system the canvas and the contracts accept", async () => {
    const d = Draft.blank("Research");
    d.add("human", "asker", "Asker", { role: "Asks" });
    d.add("agent", "planner", "Planner", { instructions: "Plan the searches." });
    for (const i of [1, 2, 3]) d.add("agent", `search_${i}`, `Searcher ${i}`, { instructions: "Search." });
    d.add("function", "join", "Join", { join: "all", code: "return Object.values(input).join('\\n');" });
    d.setPorts("join", [{ id: "a", type: "text" }, { id: "b", type: "text" }, { id: "c", type: "text" }], [{ id: "out", type: "text" }]);
    d.add("agent", "writer", "Writer", { instructions: "Write the answer." });
    d.connect("asker", "planner", "message");
    for (const [i, p] of ["a", "b", "c"].entries()) {
      d.connect("planner", `search_${i + 1}`, "message");
      d.connect(`search_${i + 1}`, "join", "message", { to_port: p });
    }
    d.connect("join", "writer", "message");
    d.connect("writer", "asker", "message");
    expect(d.problems().errors).toEqual([]);
    expect(validate(d.doc).filter((i) => i.severity === "error")).toEqual([]);
    expect(conformSystem(d.doc).filter((c) => !c.report.passed)).toEqual([]);
    expect(entryPoints(d.doc)[0].node).toBe("asker");
    // what it builds survives a trip through YAML, like anything else on the canvas
    expect(toYaml(fromYaml(toYaml(d.doc), d.doc.id))).toBe(toYaml(d.doc));
  });

  it("builds an ensemble with replicas, ends a room by length, and declares the result", async () => {
    const d = Draft.blank("Forest");
    d.add("human", "asker", "Asker", { role: "Asks" });
    d.add("model", "samples", "Samples", { prompt: "{{input}}", replicas: "{{vars.n ?? 5}}" });
    d.add("function", "vote", "Vote", { code: "return input.length;" });
    d.connect("asker", "samples", "message");
    d.connect("samples", "vote", "message");
    d.connect("vote", "asker", "message");
    const m = d.doc.nodes.find((n) => n.id === "samples")!.data as { replicas?: unknown; interface: { outputs: { type: string }[] } };
    expect(m.replicas).toBe("{{vars.n ?? 5}}");
    // the list travels on the output: json, so nothing tells each sample to answer in JSON
    expect(m.interface.outputs[0].type).toBe("json");
    expect(await runDesignTool(d, "describe", { name: "Forest", description: "Votes.", result: "number" })).toMatch(/checked to be number/);
    expect(d.doc.result).toEqual({ type: "number" });
    expect(await runDesignTool(d, "describe", { name: "Forest", description: "Votes.", result: "essay" })).toMatch(/^Not done: result must be one of/);
    expect(await runDesignTool(d, "update", { id: "samples", options: { replicas: 99 } })).toMatch(/^Not done: replicas must be a whole number/);
    d.add("env", "chat", "Chat", { env_kind: "room", policy: "round_robin", end_after: 10 });
    expect(d.doc.termination).toContain("posts >= 10");
    await runDesignTool(d, "update", { id: "chat", options: { end_after: 6 } });
    expect(d.doc.termination.filter((t) => t.startsWith("posts"))).toEqual(["posts >= 6"]);
  });

  it("gives a plugin an MCP server hosted here or elsewhere, and refuses one that is not hosted", async () => {
    const d = Draft.blank("Notes");
    d.services = [{ id: "svc_notes_mcp_e6f792", name: "Notes MCP", expose: "mcp-stdio" }];
    d.add("plugin", "notes", "Notes", { service: "svc_notes_mcp_e6f792" });
    const p = d.doc.nodes.find((n) => n.id === "notes")!.data as { spec: { backend: unknown } };
    expect(p.spec.backend).toEqual({ kind: "mcp", endpoint: { hosted: { service: "svc_notes_mcp_e6f792" } } });
    d.add("plugin", "crm", "CRM", { url: "https://crm.example/mcp", bearer_env: "CRM_TOKEN" });
    expect((d.doc.nodes.find((n) => n.id === "crm")!.data as { spec: { backend: unknown } }).spec.backend).toEqual({ kind: "mcp", endpoint: { remote: { url: "https://crm.example/mcp", bearer_env: "CRM_TOKEN" } } });
    expect(await runDesignTool(d, "add", { kind: "plugin", id: "x", name: "X", options: { service: "svc_nope_000000" } })).toMatch(/no hosted service.*Hosted here: svc_notes_mcp_e6f792/);
  });

  it("refuses what the canvas would refuse, and says why", async () => {
    const d = Draft.blank("X");
    d.add("agent", "a", "A");
    expect(await runDesignTool(d, "add", { kind: "agent", id: "a", name: "Again" })).toMatch(/already exists/);
    expect(await runDesignTool(d, "add", { kind: "wizard", id: "w", name: "W" })).toMatch(/not a component kind/);
    expect(await runDesignTool(d, "add", { kind: "agent", id: "Bad Id", name: "B" })).toMatch(/not a usable id/);
    expect(await runDesignTool(d, "connect", { source: "a", target: "ghost", kind: "message" })).toMatch(/no component "ghost"/);
    expect(await runDesignTool(d, "connect", { source: "a", target: "a", kind: "access" })).toMatch(/not an env or a plugin/);
    d.add("plugin", "mem", "Memory", { preset: "memory" });
    d.add("group", "g", "G");
    d.add("agent", "inner", "Inner", { group: "g" });
    expect(await runDesignTool(d, "connect", { source: "inner", target: "mem", kind: "access" })).toMatch(/different canvases/);
    expect(await runDesignTool(d, "set_entry", { id: "inner" })).toMatch(/inside a group/);
  });

  it("counts a component nobody talks to as something to fix", () => {
    const d = Draft.blank("X");
    d.add("agent", "a", "A");
    d.add("agent", "b", "B");
    expect(d.problems().errors.join(" ")).toMatch(/not connected/);
    d.connect("a", "b", "message");
    expect(d.problems().errors).toEqual([]);
  });

  it("updates a component in place and keeps its connections", async () => {
    const d = Draft.blank("X");
    d.add("agent", "a", "A");
    d.add("function", "f", "F");
    d.connect("a", "f", "message");
    expect(await runDesignTool(d, "update", { id: "a", options: { instructions: "Be brief.", model: "haiku" } })).toMatch(/instructions, model/);
    expect(await runDesignTool(d, "update", { id: "f", options: { code: "return 1;" } })).toMatch(/code/);
    expect(await runDesignTool(d, "update", { id: "a", options: { model: "nope" } })).toMatch(/no model "nope"/);
    expect(await runDesignTool(d, "update", { id: "a", options: {} })).toMatch(/Nothing to change/);
    expect(d.doc.edges).toHaveLength(1);
    const a = d.doc.nodes.find((n) => n.id === "a")!.data;
    expect(a.kind === "agent" && a.harness.instructions).toBe("Be brief.");
  });

  it("points out a split with no conditions, and is satisfied once each branch has one", () => {
    const d = Draft.blank("Triage");
    d.add("agent", "triage", "Triage");
    d.add("agent", "billing", "Billing");
    d.add("agent", "tech", "Tech");
    d.connect("triage", "billing", "message");
    d.connect("triage", "tech", "message");
    expect(d.problems().warnings.join(" ")).toMatch(/sends every message to all of billing, tech/);
    d.doc.edges = [];
    d.connect("triage", "billing", "message", { filter: 'text.includes("BILLING")' });
    d.connect("triage", "tech", "message", { filter: 'text.includes("TECH")' });
    expect(d.problems().warnings.join(" ")).not.toMatch(/sends every message/);
  });

  it("takes the function languages a model is likely to name, and lists the real ones otherwise", async () => {
    const d = Draft.blank("X");
    d.add("function", "f", "F", { lang: "javascript", code: "return input;" });
    const f = d.doc.nodes.find((n) => n.id === "f")!.data;
    expect(f.kind === "function" && f.fn.lang).toBe("js");
    expect(await runDesignTool(d, "add", { kind: "function", id: "g", name: "G", options: { lang: "cobol", code: "x" } })).toMatch(/Use one of: js, python, template, jsonata, llm/);
    expect(conformSystem(d.doc).filter((c) => !c.report.passed)).toEqual([]);
  });

  it("catches a loop wired twice: a member sending back inside a repeating group and out of it", () => {
    const d = Draft.blank("Review");
    d.add("group", "loop", "Loop", { max_rounds: 3, until: 'output.includes("APPROVED")' });
    d.add("agent", "writer", "Writer", { group: "loop" });
    d.add("agent", "editor", "Editor", { group: "loop" });
    d.connect("loop", "writer", "message");
    d.connect("writer", "editor", "message");
    d.connect("editor", "loop", "message");
    expect(d.problems().errors).toEqual([]);
    d.connect("editor", "writer", "message");
    expect(d.problems().errors.join(" ")).toMatch(/editor sends to both writer and the output of loop/);
  });

  it("adds a group that tries the items of a list in turn, and changes which list", () => {
    const d = Draft.blank("Plans");
    d.add("group", "plans", "Try plans", { max_rounds: 3, until: 'output.includes("PASS")', over: "input.plans" });
    const g = () => d.doc.nodes.find((n) => n.id === "plans")!.data as { iterate: { over?: string | null; max_rounds: number | string } };
    expect(g().iterate).toMatchObject({ max_rounds: 3, over: "input.plans" });
    d.update("plans", { over: "input.candidates" });
    expect(g().iterate.over).toBe("input.candidates");
    // changing the round limit keeps the list
    d.update("plans", { max_rounds: 2 });
    expect(g().iterate).toMatchObject({ max_rounds: 2, over: "input.candidates" });
  });

  it("sets a selector room's manager, at add or later, and refuses one that is not an agent", async () => {
    const d = Draft.blank("Chat");
    d.add("agent", "manager", "Manager", {});
    d.add("env", "chat", "Chat", { env_kind: "room", policy: "selector", selector: "manager" });
    const room = () => (d.doc.nodes.find((n) => n.id === "chat")!.data as { room: { selector?: string } }).room;
    expect(room().selector).toBe("manager");
    // the manager reads the room to pick who speaks: connected, read-only
    expect(d.doc.edges.find((e) => e.source === "manager" && e.target === "chat")).toMatchObject({ kind: "access", access: "read" });
    d.add("agent", "boss", "Boss", {});
    expect(await runDesignTool(d, "update", { id: "chat", options: { moderator: "boss" } })).toMatch(/selector/);
    expect(room().selector).toBe("boss");
    expect(d.doc.edges.some((e) => e.source === "boss" && e.target === "chat" && e.access === "read")).toBe(true);
    expect(await runDesignTool(d, "update", { id: "chat", options: { selector: "nobody" } })).toMatch(/^Not done: selector must be the id of an agent/);
  });

  it("catches a filter that would stall a loop", () => {
    const d = Draft.blank("Review");
    d.add("group", "loop", "Loop", { max_rounds: 3, until: 'output.includes("APPROVED")' });
    d.add("agent", "editor", "Editor", { group: "loop" });
    d.connect("loop", "editor", "message");
    d.connect("editor", "loop", "message", { filter: 'input.includes("APPROVED")' });
    expect(d.problems().errors.join(" ")).toMatch(/has a filter .* every round has to reach its output/);
  });

  it("a knowledge source the knowledge base does not have is an error that lists what it has", async () => {
    const d = Draft.blank("QA");
    d.knowledge = ["guides/", "guides/server.md"];
    d.add("agent", "qa", "QA");
    d.add("plugin", "kb", "KB", { preset: "knowledge" });
    d.connect("qa", "kb", "access");
    expect(d.problems().errors.join(" ")).toMatch(/kb reads "\.\/docs", which is not in the knowledge base. It has: guides\//);
    expect(await runDesignTool(d, "update", { id: "kb", options: { sources: ["guides"] } })).toMatch(/sources/);
    expect(d.problems().errors).toEqual([]);
  });

  it("a function added without code still meets its contract", () => {
    const d = Draft.blank("X");
    d.add("function", "f", "F");
    expect(conformSystem(d.doc).filter((c) => !c.report.passed)).toEqual([]);
  });

  it("accepts whatever the provider called the ends of a connection", async () => {
    const d = Draft.blank("X");
    d.add("agent", "a", "A");
    d.add("agent", "b", "B");
    // Gemini renames a parameter called `from`
    expect(await runDesignTool(d, "connect", { from1_: "a", to: "b", kind: "message" })).toMatch(/Connected a → b/);
    expect(d.doc.edges).toHaveLength(1);
  });
});

describe("models the design can use", () => {
  it("swaps a preset's models for ones that can be called here", () => {
    const d = Draft.blank("X");
    d.usable = { chat: ["gemini"], embedding: ["gemini_embed"] };
    const msg = d.add("plugin", "mem", "Memory", { preset: "memory" });
    expect(msg).toMatch(/haiku → gemini/);
    expect(msg).toMatch(/embed → gemini_embed/);
    const kb = d.add("plugin", "kb", "KB", { preset: "knowledge" });
    expect(kb).not.toMatch(/no rerank/); // nothing is known about rerank models: leave the step alone
    d.usable.rerank = [];
    expect(d.add("plugin", "kb2", "KB2", { preset: "knowledge" })).toMatch(/rerank on rerank → no rerank/);
    const used = JSON.stringify(d.doc.nodes[0].data);
    expect(used).not.toMatch(/"haiku"|"embed"/);
    d.add("agent", "a", "A");
    const a = d.doc.nodes.find((n) => n.id === "a")!.data;
    expect(a.kind === "agent" && a.model).toBe("gemini");
  });

  it("remembers a model that is out of credit, and prefers one that answered", async () => {
    const { noteHealth, resetHealth } = await import("../runtime/models");
    resetHealth();
    const catalog = [
      { id: "a", provider: "openai_compatible" as const, model: "a", api: {}, price_in: 0, price_out: 0, modalities: ["text"] },
      { id: "b", provider: "openai_compatible" as const, model: "b", api: {}, price_in: 0, price_out: 0, modalities: ["text"] },
      { id: "c", provider: "openai_compatible" as const, model: "c", api: {}, price_in: 0, price_out: 0, modalities: ["text"] },
    ];
    const m = new Models(catalog, new Secrets(dir));
    noteHealth(catalog[0], false, new Error("openai 429: credit_balance_exhausted"));
    noteHealth(catalog[2], true);
    expect(m.usable().map((x) => x.id)).toEqual(["c", "b"]);
    expect(m.missingKey(catalog[0])).toMatch(/failed its last call/);
    // a passing rate limit is not a dead model
    noteHealth(catalog[1], false, new Error("google 429: rate limit, retry in 30s"));
    expect(m.usable().map((x) => x.id)).toContain("b");
    resetHealth();
  });
});

describe("the architect's loop", () => {
  it("builds from tool calls and stops when the system is sound", async () => {
    const script = [
      { tool: "add", input: { kind: "human", id: "me", name: "Me" } },
      { tool: "add", input: { kind: "agent", id: "helper", name: "Helper", options: { instructions: "Help." } } },
      { tool: "connect", input: { source: "me", target: "helper", kind: "message" } },
      { tool: "connect", input: { source: "helper", target: "me", kind: "message" } },
      { tool: "review", input: {} },
      "A person asks the helper, and the answer comes back.",
    ];
    const r = await design({ models: models(script), model: "m", prompt: "someone to help me" });
    expect(r.errors).toEqual([]);
    expect(r.doc.nodes.map((n) => n.id)).toEqual(["me", "helper"]);
    expect(r.summary).toContain("helper");
    expect(r.log.map((l) => l.tool)).toEqual(["add", "add", "connect", "connect", "review"]);
  });

  it("is sent back to fix a system it leaves broken", async () => {
    // it adds two components, wires nothing, and tries to stop
    const script = [
      { tool: "add", input: { kind: "agent", id: "a", name: "A" } },
      { tool: "add", input: { kind: "agent", id: "b", name: "B" } },
      "Done!",
      { tool: "connect", input: { source: "a", target: "b", kind: "message" } },
      "Now they are connected.",
    ];
    const r = await design({ models: models(script), model: "m", prompt: "two agents" });
    expect(r.doc.edges).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });
});
