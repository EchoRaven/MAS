import { describe, expect, it } from "vitest";
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
    const doc = TEMPLATES.find((t) => t.id === "coding")!.build();
    const gates = simulate(doc).events.filter((e) => e.type === "gate");
    expect(gates[0]).toMatchObject({ passed: false });
    expect(gates.some((g) => g.type === "gate" && g.passed)).toBe(true);
  });

  it("handles an empty system", () => {
    const r = simulate(emptySystem());
    expect(r.events.map((e) => e.type)).toEqual(["system_started", "system_finished"]);
  });
});
