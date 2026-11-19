import { describe, expect, it } from "vitest";
import { Builder, native } from "./builder";
import { simulate, stateAt } from "@/run/simulate";
import { TEMPLATES } from "./templates";
import { validate } from "./validate";
import { fromYaml, toYaml } from "./yaml";
import { emptySystem } from "./defaults";
import { migrateDoc } from "./migrate";
import { compat, edgeScope, port } from "./ports";
import type { SystemDoc } from "./types";

describe("yaml round trip", () => {
  for (const t of TEMPLATES) {
    it(`keeps ${t.id} intact`, () => {
      const doc = t.build();
      const back = fromYaml(toYaml(doc), doc.id);
      const byId = (d: typeof doc) => Object.fromEntries(d.nodes.map((n) => [n.id, { parent: n.parent, data: n.data, position: n.position }]));
      expect(byId(back)).toEqual(byId(doc));
      expect(back.edges).toEqual(doc.edges);
      expect(back.models).toEqual(doc.models);
      expect(back.budget).toEqual(doc.budget);
      expect(back.schemas).toEqual(doc.schemas);
      expect(toYaml(back)).toBe(toYaml(doc));
    });
  }

  it("fills defaults and ports for a minimal hand-written file", () => {
    const doc = fromYaml(`
system: { name: mini }
agents:
  a: { name: A }
  b: { name: B, harness: { tier: process, runner: claude-code } }
connections:
  - { from: a, to: b }
`);
    expect(doc.name).toBe("mini");
    expect(doc.nodes).toHaveLength(2);
    expect(doc.edges[0]).toMatchObject({ source_port: "out", target_port: "in", kind: "message" });
    const b = doc.nodes.find((n) => n.id === "b")!.data;
    expect(b.kind === "agent" && b.harness.tier).toBe("process");
    expect(b.kind === "agent" && b.context.budget_total).toBeGreaterThan(0);
  });

  it("rejects dangling connections and unknown kinds", () => {
    expect(() => fromYaml("agents: { a: {} }\nconnections: [{ from: a, to: zz }]")).toThrow(/does not exist/);
    expect(() => fromYaml("agents: { a: {}, b: {} }\nconnections: [{ from: a, to: b, kind: teleport }]")).toThrow(/Unknown connection kind/);
    expect(() => fromYaml("agents: [1, 2]")).toThrow(/agents/);
    expect(() => fromYaml(": : :")).toThrow(/YAML/);
  });
});

describe("migration from 0.1", () => {
  it("turns rooms into envs, group entry into port wiring, and cross-boundary edges into port hops", () => {
    const old = {
      ...emptySystem("old"),
      nodes: [
        { id: "g", position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, data: { kind: "group", name: "G", entry: "a", output_from: "a", budget_usd: null, on_error: "fail_up" } },
        { id: "a", parent: "g", position: { x: 10, y: 10 }, data: { kind: "agent", name: "A" } },
        { id: "h", position: { x: -300, y: 0 }, data: { kind: "human", name: "H", role: "", approves: false } },
        { id: "r", position: { x: 0, y: 400 }, data: { kind: "channel", name: "room", channel_type: "room", policy: "round_robin", history: "persistent" } },
        { id: "b", position: { x: 300, y: 400 }, data: { kind: "agent", name: "B" } },
      ],
      edges: [
        { id: "e1", source: "h", target: "a", kind: "message" },
        { id: "e2", source: "b", target: "r", kind: "message" },
      ],
    } as unknown as SystemDoc;
    const doc = migrateDoc(old);
    const room = doc.nodes.find((n) => n.id === "r")!.data;
    expect(room).toMatchObject({ kind: "env", env_kind: "room", room: { policy: "round_robin" } });
    expect(doc.edges.find((e) => e.target === "r")).toMatchObject({ kind: "access", source: "b", source_port: "res" });
    // h -> a crossed into the group: now h -> g.in and g.in -> a
    expect(doc.edges.some((e) => e.source === "h" && e.target === "g" && e.target_port === "in")).toBe(true);
    expect(doc.edges.some((e) => e.source === "g" && e.source_port === "in" && e.target === "a")).toBe(true);
    expect(doc.edges.some((e) => e.source === "a" && e.target === "g" && e.target_port === "out")).toBe(true);
    for (const e of doc.edges.filter((x) => x.kind !== "access")) expect(edgeScope(doc, e)).not.toBeNull();
    expect(validate(doc).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("ports", () => {
  it("knows what flows without a transform", () => {
    expect(compat(port("o", "text"), port("i", "message")).level).toBe("coerce");
    expect(compat(port("o", "message"), port("i", "json")).level).toBe("needs_transform");
    expect(compat(port("o", "json", { schema: "A" }), port("i", "json", { schema: "B" })).level).toBe("needs_transform");
    expect(compat(port("o", "json", { schema: "A" }), port("i", "any")).level).toBe("ok");
  });

  it("flags an incompatible edge until it gets a transform", () => {
    const doc = fromYaml(`
model_calls:
  m: { name: M, interface: { inputs: [{ id: in, type: text }], outputs: [{ id: out, type: text }] } }
functions:
  f: { name: F, interface: { inputs: [{ id: in, type: json }], outputs: [{ id: out, type: json }] } }
connections:
  - { from: m.out, to: f.in }
`);
    expect(validate(doc).some((i) => i.severity === "error" && /text → json needs a transform/.test(i.message))).toBe(true);
    doc.edges[0].transform = { lang: "js", code: "return JSON.parse(input);" };
    expect(validate(doc).some((i) => /needs a transform/.test(i.message))).toBe(false);
  });
});

describe("validate", () => {
  it("flags an isolated agent, a call cycle and a missing approver", () => {
    const doc = fromYaml(`
agents:
  a: { name: A, tools: [merge_pr] }
  b: { name: B }
  c: { name: C }
connections:
  - { from: a, to: b, kind: call }
  - { from: b, to: a, kind: call }
`);
    const msgs = validate(doc).map((i) => i.message).join("\n");
    expect(msgs).toMatch(/"C" has no connections/);
    expect(msgs).toMatch(/call edges form a cycle/);
    expect(msgs).toMatch(/irreversible action merge_pr/);
  });

  it("flags a tool whose env is missing", () => {
    const doc = fromYaml("agents: { a: { name: A, tools: [bash] }, b: { name: B } }\nconnections: [{ from: a, to: b }]");
    expect(validate(doc).some((i) => /needs a sandbox/.test(i.message))).toBe(true);
  });

  it("finds no errors in the bundled templates", () => {
    for (const t of TEMPLATES.filter((x) => x.id !== "blank")) {
      const errs = validate(t.build()).filter((i) => i.severity === "error");
      expect(errs, `${t.id}: ${errs.map((e) => e.message).join("; ")}`).toEqual([]);
    }
  });
});

describe("simulate", () => {
  for (const t of TEMPLATES.filter((x) => x.id !== "blank")) {
    it(`${t.id} terminates and is deterministic`, () => {
      const doc = t.build();
      const a = simulate(doc);
      const b = simulate(doc);
      expect(a.events).toEqual(b.events);
      expect(a.events.at(-1)?.type).toBe("system_finished");
      expect(a.events.some((e) => e.type === "message")).toBe(true);
      const s = stateAt(a.events, a.events.length);
      expect(s.finished).toBeTruthy();
      expect(s.spent).toBeGreaterThan(0);
    });
  }

  it("blocks once at a gate, then passes", () => {
    // the walk is seeded by the system id; whether it reaches the gate depends on who speaks in the room
    const base = TEMPLATES.find((t) => t.id === "coding")!.build();
    const gates =
      Array.from({ length: 40 }, (_, i) => simulate({ ...base, id: `seed${i}` }).events.filter((e) => e.type === "gate")).find((g) => g.length > 0) ?? [];
    expect(gates[0]).toMatchObject({ passed: false });
    expect(gates.some((g) => g.type === "gate" && g.passed)).toBe(true);
  });

  it("handles an empty system", () => {
    const r = simulate(emptySystem());
    expect(r.events.map((e) => e.type)).toEqual(["system_started", "system_finished"]);
  });
});

describe("policies the runtime cannot act on", () => {
  it("are flagged by the validator", async () => {
    const { validate } = await import("./validate");
    const doc = TEMPLATES.find((t) => t.id === "baseline")!.build();
    doc.policies = [
      { id: "ok", on: "output(solo)", condition: 'text.includes("x")', action: "terminate" },
      { id: "bad_on", on: "whenever", condition: "true", action: "notify" },
      { id: "bad_action", on: "usage", condition: "usd > 1", action: "block" },
      { id: "no_node", on: "output(ghost.out)", condition: "true", action: "block" },
      { id: "no_port", on: "output(solo.nope)", condition: "true", action: "block" },
    ];
    const msgs = validate(doc).map((i) => i.message).filter((m) => m.startsWith("policy "));
    expect(msgs).toEqual([
      expect.stringMatching(/^policy bad_on: "on: whenever" is not something the runtime checks/),
      expect.stringMatching(/^policy bad_action: "block" cannot be done on usage/),
      expect.stringMatching(/^policy no_node: there is no component "ghost"/),
      expect.stringMatching(/^policy no_port: solo has no output "nope"/),
    ]);
  });
});

describe("local addresses", () => {
  it("a component or tool that reaches this machine or a private network is pointed out", async () => {
    const { validate } = await import("./validate");
    const { localUrl } = await import("./net");
    expect([localUrl("http://127.0.0.1:4311/x"), localUrl("http://localhost:5190"), localUrl("https://[::1]/"), localUrl("http://printer.local/"), localUrl("https://api.example.com/v1")]).toEqual(["127.0.0.1", "localhost", "::1", "printer.local", null]);
    const doc = TEMPLATES.find((t) => t.id === "baseline")!.build();
    doc.tools.push({ id: "peek", description: "", adapter: "http", effect: "read", needs_env: null, url: "http://127.0.0.1:4311/data" } as never);
    const msgs = validate(doc).map((i) => i.message);
    expect(msgs.some((m) => m.startsWith("Tool peek reaches http://127.0.0.1:4311/data"))).toBe(true);
    // the model catalog's local entries (a local model server) are not counted
    expect(validate(TEMPLATES.find((t) => t.id === "baseline")!.build()).some((i) => /private network/.test(i.message))).toBe(false);
  });

  it("warns when two agents who talk in a room are also wired to each other", () => {
    const b = new Builder("Room", "");
    b.agent("a", 0, 0, { name: "A", harness: { ...native(), instructions: "" } })
      .agent("c", 200, 0, { name: "C", harness: { ...native(), instructions: "" } })
      .node("chat", "env", 100, 200, { name: "Chat", env_kind: "room", image: "", room: { policy: "round_robin", history: "persistent" } })
      .edge("a", "chat", "access", { access: "read_write" })
      .edge("c", "chat", "access", { access: "read_write" });
    expect(validate(b.doc).some((i) => /already talk in room/.test(i.message))).toBe(false);
    b.edge("a", "c", "message");
    expect(validate(b.doc).find((i) => /already talk in room/.test(i.message))).toMatchObject({ severity: "warning", message: expect.stringMatching(/"A" and "C" already talk in room "Chat"/) });
  });
});
