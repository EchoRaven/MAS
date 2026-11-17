// Importing existing agents as components. Each importer maps a format the
// agent already ships with onto AgentData: harness tier + adapter, its
// capabilities, instructions, interface and modalities.
//
//   mas-agent/1 manifest (YAML/JSON)   the platform's own harness contract
//   Claude Code subagent (.md)         frontmatter name / description / tools / model + prompt body
//   A2A Agent Card (JSON)              name, url, skills, default input/output modes
//   langgraph.json                     graphs: { name: "./path.py:graph" }
//
// mas-agent/1 is what a custom harness implements to be plugged in:
//   harness.protocol  stdio-jsonl | acp | a2a | http | sdk
//   stdio-jsonl: one JSON object per line.
//     platform -> agent  {"type":"deliver","port":"in","message":{...},"context":{...},"tools":[...]}
//     agent -> platform  {"type":"status","state":"working"} | {"type":"tool_call",...}
//                        | {"type":"output","port":"out","value":...} | {"type":"usage","tokens_in":..,"tokens_out":..,"usd":..}
import YAML from "yaml";
import { defaultAgent, RUNNERS, runnerById } from "./defaults";
import { port } from "./ports";
import type { AgentData, Capabilities, HarnessTier, Interface } from "./types";

export const AGENT_CONTRACT = "mas-agent/1" as const;

export interface ParsedAgent {
  agent: AgentData;
  detected: "mas-agent" | "claude-code-subagent" | "a2a-card" | "langgraph";
  notes: string[];
}

export class AgentImportError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const MODEL_ALIAS: Record<string, string> = { opus: "opus", sonnet: "sonnet", haiku: "haiku", inherit: "sonnet" };

function withRunner(a: AgentData, runner: string, patch: Partial<AgentData["harness"]> = {}): AgentData {
  const r = runnerById(runner)!;
  return { ...a, harness: { ...a.harness, tier: r.tier, runner, loop: r.tier === "native" ? (a.harness.loop ?? "react") : undefined, capabilities: { ...r.caps }, ...patch } };
}

function fromSubagentMd(text: string): ParsedAgent {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text.trim());
  if (!m) throw new AgentImportError("A Claude Code subagent file starts with --- frontmatter ---");
  const fm = (YAML.parse(m[1]) ?? {}) as Record<string, unknown>;
  const tools = typeof fm.tools === "string" ? fm.tools.split(",").map((s) => s.trim()).filter(Boolean) : Array.isArray(fm.tools) ? fm.tools.map(String) : [];
  let a = defaultAgent(String(fm.name ?? "Imported subagent"));
  a = withRunner(a, "claude-code", { instructions: m[2].trim(), own_memory: "keep" });
  a.role = String(fm.description ?? "").split("\n")[0].slice(0, 120);
  a.model = MODEL_ALIAS[String(fm.model ?? "sonnet")] ?? "sonnet";
  const notes = [`Runs as Claude Code (claude -p) with this prompt appended via --append-system-prompt.`];
  if (tools.length) notes.push(`Its own tools (${tools.join(", ")}) are passed as --allowedTools; platform tools are added through --mcp-config.`);
  return { agent: a, detected: "claude-code-subagent", notes };
}

function fromA2ACard(card: Record<string, unknown>): ParsedAgent {
  let a = defaultAgent(String(card.name ?? "Remote agent"));
  a = withRunner(a, "a2a", { url: String(card.url ?? ""), instructions: "" });
  a.role = String(card.description ?? "").slice(0, 120);
  const modes = (Array.isArray(card.defaultInputModes) ? card.defaultInputModes : ["text"]).map(String);
  a.modalities_in = [...new Set(modes.map((m) => (m.startsWith("image") ? "image" : m.startsWith("audio") ? "audio" : m.includes("pdf") || m.includes("file") ? "file" : "text")))];
  const skills = Array.isArray(card.skills) ? card.skills.filter(isObj) : [];
  const caps = isObj(card.capabilities) ? card.capabilities : {};
  a.harness.capabilities = { ...a.harness.capabilities, observable_steps: caps.streaming ? "partial" : "none", resumable: true };
  return {
    agent: a,
    detected: "a2a-card",
    notes: [`Calls ${a.harness.url || "the card's url"} one Task at a time.`, skills.length ? `Skills: ${skills.map((s) => String(s.name ?? s.id)).join(", ")}` : "The card lists no skills."],
  };
}

function fromLangGraph(cfg: Record<string, unknown>): ParsedAgent {
  const graphs = isObj(cfg.graphs) ? Object.entries(cfg.graphs) : [];
  if (!graphs.length) throw new AgentImportError("langgraph.json has no graphs");
  const [name, path] = graphs[0];
  let a = defaultAgent(name);
  a = withRunner(a, "langgraph", { command: String(path) });
  return { agent: a, detected: "langgraph", notes: [`Wraps graph ${name} (${String(path)}) as one agent.`, ...(graphs.length > 1 ? [`${graphs.length - 1} more graph(s) in the file; import again to add them.`] : [])] };
}

const PROTOCOL_RUNNER: Record<string, string> = { "stdio-jsonl": "custom-stdio", acp: "acp", a2a: "a2a", "claude-code": "claude-code", codex: "codex" };

function fromManifest(raw: Record<string, unknown>): ParsedAgent {
  const h = isObj(raw.harness) ? raw.harness : {};
  const runner = String(h.runner ?? PROTOCOL_RUNNER[String(h.protocol)] ?? "custom-stdio");
  if (!runnerById(runner)) throw new AgentImportError(`Unknown runner ${runner}. Known: ${RUNNERS.map((r) => r.id).join(", ")}`);
  let a = defaultAgent(String(raw.name ?? "Imported agent"));
  a = withRunner(a, runner, {
    command: h.command != null ? String(h.command) : undefined,
    url: h.url != null ? String(h.url) : undefined,
    instructions: String(raw.instructions ?? h.instructions ?? ""),
  });
  if (isObj(h.capabilities)) a.harness.capabilities = { ...a.harness.capabilities, ...(h.capabilities as Partial<Capabilities>) };
  if (h.tier) a.harness.tier = h.tier as HarnessTier;
  a.role = String(raw.description ?? raw.role ?? "");
  if (raw.model) a.model = String(raw.model);
  if (isObj(raw.interface)) {
    const ifc = raw.interface as Partial<Interface>;
    a.interface = { inputs: ifc.inputs ?? [port("in", "message")], outputs: ifc.outputs ?? [port("out", "message")] };
  }
  if (Array.isArray(raw.modalities_in)) a.modalities_in = raw.modalities_in.map(String);
  if (Array.isArray(raw.tools)) a.tools = raw.tools.map(String);
  return { agent: a, detected: "mas-agent", notes: [`Adapter: ${runnerById(runner)!.label}. Capabilities come from the manifest where given, else from the adapter's defaults.`] };
}

export function parseAgentFile(text: string, filename = "agent"): ParsedAgent {
  const trimmed = text.trim();
  if (trimmed.startsWith("---") || /\.md$/i.test(filename)) return fromSubagentMd(trimmed);
  let raw: unknown;
  try {
    raw = trimmed.startsWith("{") ? JSON.parse(trimmed) : YAML.parse(trimmed);
  } catch (err) {
    throw new AgentImportError(`Could not parse: ${(err as Error).message}`);
  }
  if (!isObj(raw)) throw new AgentImportError("Expected an object");
  if (raw.contract === AGENT_CONTRACT || isObj(raw.harness)) return fromManifest(raw);
  if (isObj(raw.graphs)) return fromLangGraph(raw);
  if (typeof raw.url === "string" && (raw.skills || raw.capabilities || raw.protocolVersion || raw.defaultInputModes)) return fromA2ACard(raw);
  throw new AgentImportError("Not a mas-agent manifest, a Claude Code subagent, an A2A Agent Card or a langgraph.json");
}

export const AGENT_EXAMPLE = `contract: mas-agent/1
name: My agent
description: What it does
harness:
  protocol: stdio-jsonl      # stdio-jsonl | acp | a2a | claude-code | codex
  command: ./my_agent --json
  capabilities:
    context_control: none
    tool_injection: [mcp]
interface:
  inputs:  [{ id: in, type: message }]
  outputs: [{ id: out, type: message }]
instructions: |
  You are ...
`;
