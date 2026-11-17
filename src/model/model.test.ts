import { describe, expect, it } from "vitest";
import { simulate, stateAt } from "@/run/simulate";
import { TEMPLATES } from "./templates";
import { validate } from "./validate";
import { fromYaml, toYaml } from "./yaml";
import { emptySystem } from "./defaults";

describe("yaml round trip", () => {
  for (const t of TEMPLATES) {
    it(`keeps ${t.id} intact`, () => {
      const doc = t.build();
      const back = fromYaml(toYaml(doc), doc.id);
      const byId = (d: typeof doc) => Object.fromEntries(d.nodes.map((n) => [n.id, { parent: n.parent, data: n.data, position: n.position, size: n.size }]));
      expect(byId(back)).toEqual(byId(doc));
      expect(back.edges).toEqual(doc.edges);
      expect(back.models).toEqual(doc.models);
      expect(back.budget).toEqual(doc.budget);
      expect(toYaml(back)).toBe(toYaml(doc));
    });
  }

  it("fills defaults for a minimal hand-written file", () => {
    const doc = fromYaml(`
system: { name: mini }
agents:
  a: { name: A }
  b: { name: B, harness: { tier: process, runner: claude-code } }
channels:
  r: { name: room }
connections:
  - { from: a, to: r }
  - { from: b, to: r }
`);
    expect(doc.name).toBe("mini");
    expect(doc.nodes).toHaveLength(3);
    expect(doc.edges.every((e) => e.kind === "message")).toBe(true);
    const b = doc.nodes.find((n) => n.id === "b")!.data;
    expect(b.kind === "agent" && b.harness.tier).toBe("process");
    expect(b.kind === "agent" && b.context.budget_total).toBeGreaterThan(0);
  });

  it("rejects dangling connections and unknown kinds", () => {
    expect(() => fromYaml("agents: { a: {} }\nconnections: [{ from: a, to: zz }]")).toThrow(/不存在/);
    expect(() => fromYaml("agents: { a: {}, b: {} }\nconnections: [{ from: a, to: b, kind: teleport }]")).toThrow(/未知的连线类型/);
    expect(() => fromYaml("agents: [1, 2]")).toThrow(/agents/);
    expect(() => fromYaml(": : :")).toThrow(/YAML/);
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
    expect(msgs).toMatch(/「C」没有任何连线/);
    expect(msgs).toMatch(/call 连线形成了环/);
    expect(msgs).toMatch(/不可逆动作 merge_pr/);
  });

  it("flags a tool whose env is missing", () => {
    const doc = fromYaml("agents: { a: { name: A, tools: [bash] }, b: { name: B } }\nconnections: [{ from: a, to: b }]");
    expect(validate(doc).some((i) => /需要一个 sandbox/.test(i.message))).toBe(true);
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
