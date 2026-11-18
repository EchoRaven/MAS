// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { RunCtx } from "../context";
import { claudeCode, codex } from "./process";
import type { HarnessTurn } from "./types";

const turn = (allowLocalExec: boolean, hosted?: unknown): HarnessTurn =>
  ({
    rc: { runId: "run_x", doc: { id: "sys_x" }, config: { allowLocalExec, docker: "docker" }, hosted, signal: new AbortController().signal, secrets: { get: () => undefined }, emit: () => undefined, store: { stateDir: () => "/nonexistent" } } as unknown as RunCtx,
    node: "cc",
    agent: { harness: { tier: "process", instructions: "" } } as never,
    input: "hi",
    context: "",
    cwd: "/nonexistent",
  }) as HarnessTurn;

afterEach(() => {
  delete process.env.MAS_AGENT_RUNTIME;
});

describe("CLI agents", () => {
  it("run in a container: without the gateways they refuse instead of falling back to this machine", async () => {
    await expect(claudeCode(turn(true))).rejects.toThrow(/runs in a container, but the gateways are not listening/);
    await expect(codex(turn(true, { models: { url: null } }))).rejects.toThrow(/runs in a container/);
  });

  it("on this machine only when asked for and allowed", async () => {
    process.env.MAS_AGENT_RUNTIME = "host";
    await expect(claudeCode(turn(false))).rejects.toThrow(/needs MAS_ALLOW_LOCAL_EXEC=1/);
    await expect(codex(turn(false))).rejects.toThrow(/needs MAS_ALLOW_LOCAL_EXEC=1/);
  });
});
