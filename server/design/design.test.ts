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
