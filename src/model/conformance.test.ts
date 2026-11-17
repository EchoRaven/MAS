import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseImport } from "@/canvas/importers";
import { parseAgentFile } from "./agentspec";
import { conformAgent, conformEnv, conformFunction, conformPlugin, conformSystem } from "./conformance";
import { defaultAgent } from "./defaults";
import { parseEnvFile } from "./envspec";
import { FUNCTION_EXAMPLE, parseFunctionFile } from "./functionspec";
import { defaultPlugin, PLUGIN_EXAMPLE, parsePluginFile } from "./plugins";
import { TEMPLATES } from "./templates";

const example = (p: string) => fs.readFileSync(path.join(__dirname, "../../examples", p), "utf8");
const failing = (r: { rules: { id: string; ok: boolean; severity: string }[] }) => r.rules.filter((x) => !x.ok && x.severity === "error").map((x) => x.id);

describe("conformance: what ships conforms", () => {
  it("every component of every built-in template meets its contract", () => {
    for (const t of TEMPLATES) {
      const doc = t.build();
      for (const { name, report } of conformSystem(doc)) expect(failing(report), `${t.id} / ${name}`).toEqual([]);
    }
  });

  it("the example files and built-in examples conform", () => {
    expect(conformAgent(parseAgentFile(example("agents/code-reviewer.md"), "code-reviewer.md").agent).passed).toBe(true);
    expect(conformAgent(parseAgentFile(example("agents/travel-agent.card.json")).agent).passed).toBe(true);
    expect(conformEnv(parseEnvFile(example("envs/netflix-envgen.mas.yaml")).manifests[0]).passed).toBe(true);
    expect(conformPlugin(parsePluginFile(PLUGIN_EXAMPLE)).passed).toBe(true);
    expect(conformFunction(parseFunctionFile(FUNCTION_EXAMPLE).fn).passed).toBe(true);
  });
});

describe("conformance: what does not conform is refused", () => {
  it("an agent: unknown adapter, process harness with no command, bad ports", () => {
    const a = parseAgentFile("contract: mas-agent/1\nname: X\nharness: { protocol: stdio-jsonl }\ninterface: { inputs: [{ id: In, type: blob }], outputs: [] }").agent;
    expect(failing(conformAgent(a))).toEqual(expect.arrayContaining(["harness.launch", "interface.nonempty", "ports.ids", "ports.types"]));
    const remote = { ...defaultAgent(), harness: { ...defaultAgent().harness, tier: "remote" as const, runner: "a2a", url: "not a url" } };
    expect(failing(conformAgent(remote))).toContain("harness.endpoint");
  });

  it("a plugin: MCP backend with nowhere to connect, duplicate tools, empty hook", () => {
    const p = defaultPlugin("custom");
    p.spec.backend = { kind: "mcp" };
    p.spec.tools = [{ name: "x", description: "", effect: "read" }, { name: "x", description: "", effect: "read" }];
    p.spec.hooks = { before_turn: { lang: "js", code: " " } };
    expect(failing(conformPlugin(p))).toEqual(expect.arrayContaining(["backend.mcp", "tools.unique", "hooks"]));
  });

  it("an environment with no health check or exposure", () => {
    const m = parseEnvFile("contract: mas-env/1\nname: Bare\nkind: service\nlifecycle: {}\nexposes: { http: [] }").manifests[0];
    expect(failing(conformEnv(m))).toEqual(expect.arrayContaining(["lifecycle.health", "exposes"]));
  });

  it("a function: empty code, unknown language", () => {
    expect(failing(conformFunction(parseFunctionFile("contract: mas-function/1\nname: F\nfn: { lang: ruby, code: 'x' }").fn))).toContain("fn");
    expect(failing(conformFunction(parseFunctionFile("", "empty.py").fn))).toContain("fn");
  });

  it("the import path blocks non-conforming candidates", () => {
    const r = parseImport("function", "contract: mas-function/1\nname: F\nfn: { lang: js, code: '' }", "f.yaml");
    expect(r.candidates[0].conformance.passed).toBe(false);
    const ok = parseImport("function", "export default (input) => input", "pass_through.js");
    expect(ok.candidates[0].conformance.passed).toBe(true);
    expect(ok.candidates[0].data).toMatchObject({ kind: "function", fn: { lang: "js" } });
  });
});
