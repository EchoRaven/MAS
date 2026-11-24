// Conformance: what anything must satisfy before it can be imported. One
// checklist per contract; each rule is named and reports pass/fail, and any
// failing error rule blocks the import.
//
//   mas-agent/1     agents and their harnesses
//   mas-env/1       environments
//   mas-plugin/1    plugins (memory, knowledge, workspace, custom)
//   mas-function/1  function nodes
import { RUNNERS, runnerById } from "./defaults";
import { DATA_TYPES } from "./ports";
import { stepsOf } from "./pipelines";
import { optionFor, STEP_CATALOG, type Slot, type Step } from "./steps";
import type { AgentData, EnvManifest, FunctionNodeData, FunctionSpec, Interface, PluginData, SystemDoc } from "./types";
import { RES_PORT } from "./types";

export interface Rule {
  id: string;
  label: string;
  ok: boolean;
  severity: "error" | "warning";
  detail?: string;
}

export interface Conformance {
  contract: "mas-agent/1" | "mas-env/1" | "mas-plugin/1" | "mas-function/1";
  passed: boolean;
  rules: Rule[];
}

class Checklist {
  rules: Rule[] = [];
  must(id: string, label: string, ok: boolean, detail?: string) {
    this.rules.push({ id, label, ok, severity: "error", detail: ok ? undefined : detail });
    return this;
  }
  should(id: string, label: string, ok: boolean, detail?: string) {
    this.rules.push({ id, label, ok, severity: "warning", detail: ok ? undefined : detail });
    return this;
  }
  done(contract: Conformance["contract"]): Conformance {
    return { contract, passed: this.rules.every((r) => r.ok || r.severity === "warning"), rules: this.rules };
  }
}

const LANGS = ["template", "jsonata", "js", "python", "llm"];
const PORT_ID = /^[a-z][a-z0-9_]*$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isUrl = (s?: string) => !!s && /^(https?|wss?):\/\/[^\s]+$/.test(s);

/** A FunctionSpec is a language we run and non-empty code. */
function fnProblem(fn: FunctionSpec | null | undefined): string | null {
  if (!fn) return null;
  if (!LANGS.includes(fn.lang)) return `unknown language "${String(fn.lang)}" (use ${LANGS.join(", ")})`;
  if (!fn.code?.trim()) return "empty code";
  return null;
}

/** The interface rules every component with ports shares. */
function checkInterface(c: Checklist, ifc: Interface | undefined, doc?: SystemDoc, needBoth = true) {
  const ports = [...(ifc?.inputs ?? []), ...(ifc?.outputs ?? [])];
  c.must("interface.declared", "Declares an interface (inputs and outputs)", !!ifc && Array.isArray(ifc.inputs) && Array.isArray(ifc.outputs), "interface: { inputs: [...], outputs: [...] } is missing");
  if (!ifc) return;
  if (needBoth) c.must("interface.nonempty", "Has at least one input and one output", ifc.inputs.length > 0 && ifc.outputs.length > 0, `${ifc.inputs.length} inputs, ${ifc.outputs.length} outputs`);
  const badIds = ports.filter((p) => !PORT_ID.test(p.id) || p.id === RES_PORT).map((p) => p.id);
  c.must("ports.ids", "Port names are lowercase identifiers", badIds.length === 0, `bad: ${badIds.join(", ")}`);
  const ids = ports.map((p) => p.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  c.must("ports.unique", "Port names are unique across inputs and outputs", dup.length === 0, `repeated: ${[...new Set(dup)].join(", ")}`);
  const types = DATA_TYPES.map((t) => t.value as string);
  const badTypes = ports.filter((p) => !types.includes(p.type)).map((p) => `${p.id}: ${String(p.type)}`);
  c.must("ports.types", "Port types are message / text / json / file / event / any", badTypes.length === 0, badTypes.join(", "));
  const refs = ports.filter((p) => p.type === "json" && p.schema).map((p) => p.schema!);
  if (refs.length) {
    const known = new Set((doc?.schemas ?? []).map((s) => s.id));
    const missing = refs.filter((r) => !known.has(r));
    c.should("ports.schemas", "JSON schemas it names exist in this system", missing.length === 0, `add to Library → Schemas: ${[...new Set(missing)].join(", ")}`);
  }
}

function checkSteps(c: Checklist, id: string, label: string, steps: { slot: Slot; step: Step; where: string }[]) {
  const bad = steps.flatMap(({ slot, step, where }) => {
    if (step.use === "custom") {
      const p = fnProblem(step.fn ?? undefined);
      return p || !step.fn ? [`${where}: custom step ${p ?? "has no code"}`] : [];
    }
    if (!STEP_CATALOG[slot]) return [`${where}: unknown stage`];
    return optionFor(slot, step.use) ? [] : [`${where}: unknown method "${step.use}"`];
  });
  c.must(id, label, bad.length === 0, bad.join("; "));
}

export function conformAgent(a: AgentData, doc?: SystemDoc): Conformance {
  const c = new Checklist();
  const h = a.harness;
  const runner = runnerById(h?.runner);
  c.must("identity", "Has a name", !!a.name?.trim(), "name is empty");
  c.must("harness.adapter", "Harness uses a known adapter", !!runner || h?.tier === "native", `runner "${String(h?.runner)}" is not one of ${RUNNERS.map((r) => r.id).join(", ")}`);
  if (runner) c.must("harness.tier", "Tier matches the adapter", runner.tier === h.tier, `${runner.id} is a ${runner.tier} adapter, tier says ${h.tier}`);
  if (h?.tier === "process" && h.runner !== "claude-code" && h.runner !== "codex") c.must("harness.launch", "Process harness says how to launch it", !!h.command?.trim(), "harness.command is empty");
  if (h?.tier === "remote") c.must("harness.endpoint", "Remote harness has an endpoint URL", isUrl(h.url), `harness.url is "${h.url ?? ""}"`);
  if (h?.runner === "langgraph") c.must("harness.graph", "LangGraph harness names a graph (path:attr)", /.+:.+/.test(h.command ?? ""), `got "${h.command ?? ""}"`);
  const caps = h?.capabilities;
  const levels = ["full", "partial", "none"];
  c.must(
    "harness.capabilities",
    "Declares its capabilities",
    !!caps && levels.includes(caps.context_control) && levels.includes(caps.observable_steps) && Array.isArray(caps.tool_injection) && caps.tool_injection.every((t) => ["mcp", "cli", "native"].includes(t)),
    "capabilities need context_control, observable_steps (full | partial | none) and tool_injection ([mcp | cli | native])",
  );
  checkInterface(c, a.interface, doc);
  const mods = ["text", "image", "audio", "video", "file"];
  c.must("modalities", "Input modalities are known", (a.modalities_in ?? []).every((m) => mods.includes(m)) && (a.modalities_in ?? []).length > 0, `use ${mods.join(", ")}`);
  const stageOps = ["parse_json", "validate", "transform", "filter", "route", "redact", "summarize"];
  const badStages = [...(a.pipeline?.pre ?? []), ...(a.pipeline?.post ?? [])].flatMap((p) => {
    if (!stageOps.includes(p.op)) return [`${p.name}: unknown op ${p.op}`];
    const f = fnProblem(p.fn);
    return f ? [`${p.name}: ${f}`] : [];
  });
  c.must("stages", "Input/output stages are valid", badStages.length === 0, badStages.join("; "));
  const badHooks = Object.entries(a.hooks ?? {}).flatMap(([k, fn]) => {
    const f = fnProblem(fn);
    return f ? [`${k}: ${f}`] : [];
  });
  c.must("hooks", "Hooks are valid functions", badHooks.length === 0, badHooks.join("; "));
  if (h?.tier === "native") {
    if (h.loop === "custom") c.must("loop", "Custom loop has code", !fnProblem(h.loop_fn) && !!h.loop_fn, fnProblem(h.loop_fn) ?? "loop_fn is missing");
    else c.must("loop", "Loop is a known preset", !h.loop || !!optionFor("loop", h.loop), `unknown loop "${String(h.loop)}"`);
  }
  if (doc) {
    const unknown = (a.tools ?? []).filter((t) => !doc.tools.some((x) => x.id === t));
    c.should("tools", "Tools it names are in this system's catalog", unknown.length === 0, `missing: ${unknown.join(", ")}`);
  }
  return c.done("mas-agent/1");
}

export function conformPlugin(p: PluginData): Conformance {
  const c = new Checklist();
  const s = p.spec;
  c.must("identity", "Has a name", !!p.name?.trim(), "name is empty");
  c.must("scope", "Scope is agent / agent_run / group / end_user / run / system", ["agent", "agent_run", "group", "end_user", "run", "system"].includes(s?.scope), `got "${String(s?.scope)}"`);
  const b = s?.backend;
  c.must("backend.kind", "Backend is builtin / mcp / http / code", !!b && ["builtin", "mcp", "http", "code"].includes(b.kind), `got "${String(b?.kind)}"`);
  if (b?.kind === "http") c.must("backend.http", "HTTP backend has a URL", isUrl(b.url), `url is "${b.url ?? ""}"`);
  // a hosted or remote endpoint stands in for url / command (where the server is, resolved when the run starts)
  if (b?.kind === "mcp") c.must("backend.mcp", "MCP backend has a URL, a launch command or an endpoint", isUrl(b.url) || !!b.command?.trim() || !!b.endpoint, "give url (http transport), command (stdio) or endpoint (remote or hosted)");
  if (b?.kind === "code") c.must("backend.code", "Code backend has a command", !!b.command?.trim(), "command is empty");
  const tools = s?.tools ?? [];
  const badTools = tools.filter((t) => !NAME.test(t.name) || !["pure", "read", "write", "irreversible"].includes(t.effect)).map((t) => t.name);
  c.must("tools.valid", "Tools have identifier names and a declared effect", badTools.length === 0, `bad: ${badTools.join(", ")}`);
  const names = tools.map((t) => t.name);
  c.must("tools.unique", "Tool names are unique", new Set(names).size === names.length, "repeated tool names");
  c.should("tools.described", "Every tool says what it does", tools.every((t) => t.description?.trim()), "an agent decides from the description");
  const badHooks = Object.entries(s?.hooks ?? {}).flatMap(([k, fn]) => {
    const f = fnProblem(fn);
    return f ? [`${k}: ${f}`] : [];
  });
  c.must("hooks", "Hooks are valid functions", badHooks.length === 0, badHooks.join("; "));
  checkSteps(c, "pipelines", "Retrieval / indexing / memory steps are valid", stepsOf({ ...(s?.retrieval ?? {}), ...(s?.index ?? {}), ...(s?.memory ?? {}) }));
  c.must("provides", "Provides something: tools, hooks or a pipeline", tools.length > 0 || Object.values(s?.hooks ?? {}).some(Boolean) || !!s?.retrieval || !!s?.memory, "a plugin with no tools, hooks or pipelines does nothing");
  return c.done("mas-plugin/1");
}

export function conformEnv(m: EnvManifest): Conformance {
  const c = new Checklist();
  c.must("identity", "Has an id and a name", !!m.id && !!m.name, "id or name is missing");
  c.must("kind", "Kind is web_app / sandbox / service", ["web_app", "sandbox", "service"].includes(m.kind), `got "${String(m.kind)}"`);
  c.must("lifecycle.health", "Says how to tell it is ready (health)", !!m.lifecycle?.health, "lifecycle.health is missing");
  c.should("lifecycle.reset", "Can be reset to a clean state (repeatable runs)", !!m.lifecycle?.reset, "lifecycle.reset is missing");
  c.should("lifecycle.start", "Says how to start it (command or compose file)", !!m.lifecycle?.start || !!m.runtime?.compose, "otherwise it must already be running");
  c.must("exposes", "Exposes an MCP server or an HTTP base", !!m.exposes?.mcp || (m.exposes?.http ?? []).length > 0, "exposes is empty");
  const badBases = (m.exposes?.http ?? []).filter((h) => !isUrl(h.base)).map((h) => h.name);
  c.must("exposes.http", "HTTP bases are URLs", badBases.length === 0, `bad: ${badBases.join(", ")}`);
  const mcp = m.exposes?.mcp;
  if (mcp) {
    c.must("exposes.mcp.transport", "MCP transport is http or stdio, with a URL, a start command or an endpoint", (mcp.transport === "http" && (isUrl(mcp.url) || !!mcp.start || !!mcp.endpoint)) || (mcp.transport === "stdio" && (!!mcp.start || !!mcp.endpoint)), `transport ${String(mcp.transport)}, url ${mcp.url ?? "-"}, start ${mcp.start ?? "-"}, endpoint ${mcp.endpoint ? "set" : "-"}`);
    c.must("exposes.mcp.tools", "MCP tool names are unique identifiers", mcp.tools.every((t) => NAME.test(t)) && new Set(mcp.tools).size === mcp.tools.length, "check the tool list");
    c.should("exposes.mcp.listed", "Lists its MCP tools", mcp.tools.length > 0, "they will only be discovered when it starts");
    c.should("auth.login", "OAuth MCP has a login route for test users", mcp.auth !== "oauth_jwks" || !!m.auth?.login, "auth.login is missing");
  }
  c.must("secrets", "No secrets in the manifest (env var names only)", !(m.auth?.test_users ?? []).some((u) => "password" in (u as object)), "test users carry a password; use password_env");
  return c.done("mas-env/1");
}

export function conformFunction(f: FunctionNodeData, doc?: SystemDoc): Conformance {
  const c = new Checklist();
  c.must("identity", "Has a name", !!f.name?.trim(), "name is empty");
  const p = fnProblem(f.fn);
  c.must("fn", "Code is a supported language and not empty", !!f.fn && !p, p ?? "fn is missing");
  checkInterface(c, f.interface, doc);
  c.must("join", "Join is any or all", f.join === "any" || f.join === "all", `got "${String(f.join)}"`);
  if (f.join === "all") c.should("join.required", "With join = all, the inputs it waits for are marked required", f.interface.inputs.some((x) => x.required), "mark the inputs it must wait for as required");
  const outs = f.interface?.outputs ?? [];
  if (outs.length > 1 && f.fn && f.fn.lang !== "llm") c.should("routing", "With several outputs, the code returns { <output>: value }", outs.some((o) => f.fn.code.includes(o.id)), `none of ${outs.map((o) => o.id).join(", ")} appears in the code`);
  return c.done("mas-function/1");
}

/** Conformance for any importable component, by kind. */
export function conformData(d: import("./types").NodeData, doc?: SystemDoc): Conformance | null {
  if (d.kind === "agent") return conformAgent(d, doc);
  if (d.kind === "plugin") return conformPlugin(d);
  if (d.kind === "function") return conformFunction(d, doc);
  if (d.kind === "env" && d.manifest) return conformEnv(d.manifest);
  return null;
}

/** Every component of a system that has a contract, with its report; used to gate whole-system imports. */
export function conformSystem(doc: SystemDoc): { node: string; name: string; report: Conformance }[] {
  return doc.nodes.flatMap((n) => {
    const report = conformData(n.data, doc);
    return report ? [{ node: n.id, name: "name" in n.data ? n.data.name : n.id, report }] : [];
  });
}
