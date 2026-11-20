// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Builder, native } from "@/model/builder";
import type { EnvData, SysNode } from "@/model/types";
import type { RunCtx } from "../context";
import { SandboxEnv } from "../resources/envs/sandbox";
import { type Box, type BoxSpec, hardenedFlags, HARDENING, SECCOMP_PROFILE, type SandboxBackend } from ".";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-iso-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("isolation", () => {
  it("a box runs as the server's user with no capabilities, no privilege gain, seccomp and a read-only root", () => {
    const f = hardenedFlags({ name: "b", image: "python:3.12-slim", workDir: "/w", egress: [] }, null, [], 1052, 1054);
    const pairs = f.map((x, i) => `${x} ${f[i + 1] ?? ""}`);
    for (const p of ["--user 1052:1054", "--cap-drop ALL", "--security-opt no-new-privileges", `--security-opt seccomp=${SECCOMP_PROFILE}`, "--network none", `--label mas.hardening=${HARDENING}`]) expect(pairs).toContain(p);
    expect(f).toContain("--read-only");
    expect(f.some((x) => x.startsWith("/tmp:"))).toBe(true);
    // proxy credentials go in by name only
    const g = hardenedFlags({ name: "b", image: "i", workDir: "/w", egress: ["example.com"] }, "mas-hosted", ["HTTPS_PROXY"]);
    expect(g.join(" ")).toContain("--network mas-hosted");
    expect(g.join(" ")).toContain("-e HTTPS_PROXY");
    expect(g.join(" ")).not.toMatch(/HTTPS_PROXY=/);
  });

  it("the seccomp profile refuses mounts, namespaces, modules, tracing and BPF", () => {
    const p = JSON.parse(fs.readFileSync(SECCOMP_PROFILE, "utf8")) as { defaultAction: string; syscalls: { names: string[]; action: string }[] };
    const denied = p.syscalls.filter((s) => s.action === "SCMP_ACT_ERRNO").flatMap((s) => s.names);
    for (const n of ["mount", "unshare", "setns", "init_module", "ptrace", "bpf", "keyctl", "reboot"]) expect(denied).toContain(n);
  });

  it("with share: per_agent each agent gets its own box and folder; shared, one for all", async () => {
    const started: BoxSpec[] = [];
    const fake: SandboxBackend = {
      kind: "docker",
      available: async () => ({ ok: true }),
      start: async (spec): Promise<Box> => (started.push(spec), { name: spec.name, isolation: "fake" }),
      exec: async (box, command) => ({ code: 0, out: `${box.name}: ${command}` }),
      stop: async () => undefined,
    };
    const build = (share: "shared" | "per_agent") => {
      const b = new Builder("S", "");
      b.agent("a1", 0, 0, { name: "A1", model: "m", harness: { ...native(), instructions: "" } })
        .agent("a2", 0, 0, { name: "A2", model: "m", harness: { ...native(), instructions: "" } })
        .node("box", "env", 0, 0, { name: "Box", env_kind: "sandbox", image: "python:3.12-slim", share });
      return b.doc;
    };
    for (const share of ["per_agent", "shared"] as const) {
      started.length = 0;
      const doc = build(share);
      const node = doc.nodes.find((n) => n.id === "box") as SysNode<EnvData>;
      const rc = { doc, runId: `run_${share}`, config: { allowLocalExec: false, docker: "docker" }, store: { stateDir: (...p: string[]) => path.join(dir, ...p) }, emit: () => undefined, byId: new Map(doc.nodes.map((n) => [n.id, n])) } as unknown as RunCtx;
      const env = new SandboxEnv(rc, node, fake);
      const edge = (source: string) => ({ id: `${source}-box`, source, target: "box", kind: "access", access: "read_write" }) as never;
      const [t1, t2] = [await env.tools(edge("a1")), await env.tools(edge("a2"))];
      const bash = (ts: typeof t1) => ts.find((t) => t.name === "bash")!;
      await bash(t1).run({ command: "id" }, {} as never);
      await bash(t2).run({ command: "id" }, {} as never);
      await t1.find((t) => t.name === "edit_file")!.run({ path: "/work/mine.txt", content: "a1's" }, {} as never);
      const seen2 = await t2.find((t) => t.name === "list_work")!.run({}, {} as never);
      if (share === "per_agent") {
        expect(started.map((s) => s.name)).toHaveLength(2);
        expect(new Set(started.map((s) => s.workDir)).size).toBe(2);
        expect(started.every((s) => s.workDir.includes(`${path.sep}agents${path.sep}`))).toBe(true);
        expect(seen2).not.toContain("mine.txt"); // a2 does not see a1's files
      } else {
        expect(started).toHaveLength(1);
        expect(seen2).toContain("mine.txt");
      }
    }
  });

  it("puts the run's input in /work/input.txt, so a program reads it instead of the agent retyping it", async () => {
    const fake: SandboxBackend = { kind: "docker", available: async () => ({ ok: true }), start: async (spec): Promise<Box> => ({ name: spec.name, isolation: "fake" }), exec: async () => ({ code: 0, out: "" }), stop: async () => undefined };
    const b = new Builder("S", "");
    b.agent("a1", 0, 0, { name: "A1", model: "m", harness: { ...native(), instructions: "" } }).node("box", "env", 0, 0, { name: "Box", env_kind: "sandbox", image: "python:3.12-slim", lifecycle: "per_run" });
    const doc = b.doc;
    const node = doc.nodes.find((n) => n.id === "box") as SysNode<EnvData>;
    const input = "What is the total?\n---\n2024-01-02 | customer Ashby | paid $12";
    const rc = { doc, runId: "run_input", input, config: { allowLocalExec: false, docker: "docker" }, store: { stateDir: (...p: string[]) => path.join(dir, ...p) }, emit: () => undefined, byId: new Map(doc.nodes.map((n) => [n.id, n])) } as unknown as RunCtx;
    const tools = await new SandboxEnv(rc, node, fake).tools({ id: "a1-box", source: "a1", target: "box", kind: "access", access: "read_write" } as never);
    expect(tools.find((t) => t.name === "bash")!.description).toMatch(/\/work\/input\.txt/);
    await tools.find((t) => t.name === "bash")!.run({ command: "true" }, {} as never);
    expect(await tools.find((t) => t.name === "edit_file")!.run({ path: "/work/input.txt" }, {} as never)).toContain("customer Ashby | paid $12");
    // a later run with no input in a folder kept across runs does not see the old one
    const kept = { ...node, data: { ...node.data, lifecycle: "persistent" } } as SysNode<EnvData>;
    const first = await new SandboxEnv({ ...rc, runId: "run_a" } as RunCtx, kept, fake).tools({ id: "a1-box", source: "a1", target: "box", kind: "access", access: "read_write" } as never);
    await first.find((t) => t.name === "bash")!.run({ command: "true" }, {} as never);
    const later = await new SandboxEnv({ ...rc, runId: "run_b", input: "" } as RunCtx, kept, fake).tools({ id: "a1-box", source: "a1", target: "box", kind: "access", access: "read_write" } as never);
    await later.find((t) => t.name === "bash")!.run({ command: "true" }, {} as never);
    expect(await later.find((t) => t.name === "list_work")!.run({}, {} as never)).not.toContain("input.txt");
  });
});
