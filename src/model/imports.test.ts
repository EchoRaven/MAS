import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentImportError, parseAgentFile } from "./agentspec";
import { emptySystem } from "./defaults";
import { checkContract, envFromManifest, parseEnvFile } from "./envspec";
import { migrateDoc } from "./migrate";
import { defaultPlugin, parsePluginFile, PLUGIN_EXAMPLE, switchPreset } from "./plugins";
import type { SystemDoc } from "./types";
import { validate } from "./validate";

const example = (p: string) => fs.readFileSync(path.join(__dirname, "../../examples", p), "utf8");

describe("env import", () => {
  it("reads the env-gen manifest written by scripts/import-env.mjs", () => {
    const r = parseEnvFile(example("envs/netflix-envgen.mas.yaml"));
    expect(r.detected).toBe("mas-env");
    const m = r.manifests[0];
    expect(m.source.format).toBe("envgen");
    expect(m.exposes.mcp?.tools.length).toBeGreaterThan(5);
    expect(m.lifecycle.reset).toMatch(/\/api\/v1\/reset$/);
    expect(checkContract(m).filter((i) => i.severity === "error")).toEqual([]);
    expect(envFromManifest(m)).toMatchObject({ kind: "env", env_kind: "app" });
  });

  it("reads a DT registry into one manifest per env", () => {
    const r = parseEnvFile(example("envs/dt-registry.yaml"));
    expect(r.detected).toBe("dtap");
    expect(r.manifests.map((m) => m.id)).toEqual(["netflix", "paypal"]);
    expect(r.manifests[0].lifecycle.health).toBe("GET http://127.0.0.1:8078/health");
    // no reset route in a registry: importable, with a warning
    expect(checkContract(r.manifests[0]).some((i) => i.severity === "warning" && /reset/.test(i.message))).toBe(true);
  });

  it("reads a compose file and rejects things that are not envs", () => {
    const r = parseEnvFile("services:\n  api: { image: x, ports: ['9000:80'] }\n  web: { image: y, ports: ['9001:3000'] }\n", "docker-compose.yml");
    expect(r.manifests[0].exposes.http.map((h) => h.base)).toEqual(["http://127.0.0.1:9000", "http://127.0.0.1:9001"]);
    expect(() => parseEnvFile("hello: world")).toThrow(/Not a mas-env/);
  });
});

describe("agent import", () => {
  it("maps a Claude Code subagent onto the claude-code adapter", () => {
    const r = parseAgentFile(example("agents/code-reviewer.md"), "code-reviewer.md");
    expect(r.detected).toBe("claude-code-subagent");
    expect(r.agent).toMatchObject({ name: "code-reviewer", model: "sonnet", harness: { tier: "process", runner: "claude-code" } });
    expect(r.agent.harness.instructions).toMatch(/senior reviewer/);
  });

  it("maps an A2A Agent Card onto a remote agent", () => {
    const r = parseAgentFile(example("agents/travel-agent.card.json"));
    expect(r.detected).toBe("a2a-card");
    expect(r.agent.harness).toMatchObject({ tier: "remote", runner: "a2a", url: "https://agents.example.com/travel" });
    expect(r.agent.modalities_in).toEqual(["text", "image"]);
  });

  it("reads a mas-agent manifest and a langgraph.json, and rejects the rest", () => {
    const m = parseAgentFile("contract: mas-agent/1\nname: X\nharness: { protocol: stdio-jsonl, command: ./x }\ninterface: { outputs: [{ id: verdict, type: json }] }");
    expect(m.agent.harness.runner).toBe("custom-stdio");
    expect(m.agent.interface.outputs[0].id).toBe("verdict");
    expect(parseAgentFile('{"graphs": {"agent": "./g.py:graph"}}').agent.harness).toMatchObject({ runner: "langgraph", command: "./g.py:graph" });
    expect(() => parseAgentFile('{"x": 1}')).toThrow(AgentImportError);
  });
});

describe("plugins", () => {
  it("switching preset fills defaults; custom keeps what is there", () => {
    const mem = defaultPlugin("memory");
    const kb = switchPreset(mem, "knowledge");
    expect(kb.spec.tools.map((t) => t.name)).toEqual(["kb_search"]);
    const custom = switchPreset({ ...kb, spec: { ...kb.spec, scope: "end_user" } }, "custom");
    expect(custom.spec.scope).toBe("end_user");
    expect(custom.preset).toBe("custom");
  });

  it("imports a mas-plugin manifest", () => {
    const p = parsePluginFile(PLUGIN_EXAMPLE);
    expect(p.spec.backend.kind).toBe("mcp");
    expect(p.spec.tools.map((t) => t.name)).toContain("crm_find_customer");
    expect(p.spec.hooks.before_turn?.lang).toBe("js");
  });

  it("migrates 0.1 stores and agent context sources onto plugins and access edges", () => {
    const old = {
      ...emptySystem("old"),
      nodes: [
        { id: "a", position: { x: 0, y: 0 }, data: { kind: "agent", name: "A", context: { budget_total: 1000, history_strategy: "window", history_window: 5, mask_tool_output: true, sources: [{ store: "kb", mode: "auto_inject", top_k: 3 }] } } },
        { id: "kb", position: { x: 0, y: 200 }, data: { kind: "store", name: "Docs", store_kind: "knowledge", backend: "qdrant", scope: "system", write: "none", sources: ["./d"] } },
      ],
      edges: [{ id: "e1", source: "a", target: "kb", kind: "access", access: "read" }],
    } as unknown as SystemDoc;
    const doc = migrateDoc(old);
    const kb = doc.nodes.find((n) => n.id === "kb")!.data;
    expect(kb).toMatchObject({ kind: "plugin", preset: "knowledge", name: "Docs", spec: { storage: "qdrant", sources: ["./d"] } });
    expect(doc.edges[0]).toMatchObject({ kind: "access", source_port: "res", binding: { mode: "auto_inject", read: { top_k: 3 } } });
    expect("sources" in (doc.nodes[0].data as { context: object }).context).toBe(false);
    expect(validate(doc).filter((i) => i.severity === "error")).toEqual([]);
  });
});
