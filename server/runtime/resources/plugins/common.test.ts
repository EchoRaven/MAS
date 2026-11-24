import { describe, expect, it } from "vitest";
import { scopeKey } from "./common";

const plugin = (scope: string) => ({ id: "mem", data: { spec: { scope } } }) as never;
const rc = (runId: string) => ({ runId, vars: {}, byId: new Map() }) as never;

describe("plugin scope", () => {
  it("agent_run: each agent's own, new every run; agent: each agent's own, kept across runs", () => {
    expect(scopeKey(rc("r1"), plugin("agent_run"), "klaus")).not.toBe(scopeKey(rc("r2"), plugin("agent_run"), "klaus"));
    expect(scopeKey(rc("r1"), plugin("agent_run"), "klaus")).not.toBe(scopeKey(rc("r1"), plugin("agent_run"), "maria"));
    expect(scopeKey(rc("r1"), plugin("agent"), "klaus")).toBe(scopeKey(rc("r2"), plugin("agent"), "klaus"));
    // run: one for the run, shared by its agents
    expect(scopeKey(rc("r1"), plugin("run"), "klaus")).toBe(scopeKey(rc("r1"), plugin("run"), "maria"));
  });
});
