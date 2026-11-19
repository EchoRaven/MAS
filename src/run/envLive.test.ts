import { describe, expect, it } from "vitest";
import { Builder, native } from "@/model/builder";
import type { RunEvent } from "./events";
import { envLiveAt, groupRoundsAt } from "./envLive";

describe("env live state", () => {
  it("attributes tool calls to the env that serves them, with the last exit code, isolation and refusals", () => {
    const b = new Builder("S", "");
    b.agent("coder", 0, 0, { name: "Coder", model: "m", tools: ["fetch"], harness: { ...native(), instructions: "" } })
      .node("box", "env", 0, 0, { name: "Box", env_kind: "sandbox", image: "python:3.12-slim", egress: ["pypi.org"] })
      .edge("coder", "box", "access", { access: "read_write" });
    const ev = [
      { t: 0, type: "log", node: "box", level: "info", text: "Sandbox python:3.12-slim: docker · no network · not root" },
      { t: 1, type: "tool", node: "coder", tool: "bash", args: '{"command":"pytest"}', result: "exit 1\nFAILED" },
      { t: 2, type: "tool", node: "coder", tool: "fetch", args: "{}", result: "ok" },
      { t: 3, type: "log", node: "box", level: "warn", text: "egress: evil.example:443 refused (not declared)" },
      { t: 4, type: "tool", node: "coder", tool: "run_tests", args: "{}", result: "exit 0\n3 passed" },
      { t: 5, type: "system_finished", reason: "All idle" },
    ] as RunEvent[];
    expect(envLiveAt(ev, 3, b.doc).box).toMatchObject({ state: "ready", isolation: "docker · no network · not root", calls: 1, last: { tool: "bash", exit: 1 } });
    expect(envLiveAt(ev, ev.length, b.doc).box).toMatchObject({ state: "stopped", calls: 2, refused: 1, last: { tool: "run_tests", exit: 0 } });
  });

  it("follows a repeating group's rounds and says why it stopped", () => {
    const b = new Builder("G", "");
    b.group("loop", 0, 0, { name: "Loop", iterate: { max_rounds: 3, until: 'output.includes("DONE")', feed: "output" } });
    const ev = [
      { t: 0, type: "transform", at: "loop", label: "round 2 of ≤3", detail: "until … — not yet" },
      { t: 1, type: "transform", at: "loop", label: "round 3 of ≤3", detail: "until … — not yet" },
      { t: 2, type: "transform", at: "loop", label: "rounds done", detail: "3 rounds" },
    ] as RunEvent[];
    expect(groupRoundsAt(ev, 1, b.doc).loop).toEqual({ round: 2, limit: 3 });
    expect(groupRoundsAt(ev, 3, b.doc).loop).toEqual({ round: 3, limit: 3, done: "3 rounds" });
  });
});
