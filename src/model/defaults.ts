import { defaultInterface } from "./ports";
import { defaultPlugin } from "./plugins";
import type {
  AgentData,
  Capabilities,
  EnvData,
  FunctionNodeData,
  GroupData,
  ModelNodeData,
  HarnessTier,
  HumanData,
  ModelSpec,
  NodeData,
  NodeKind,
  SystemDoc,
  ToolSpec,
} from "./types";
import { SPEC_VERSION } from "./types";

/** Model catalog. Claude prices: Anthropic first-party API rates (2026-11). gpt-5.4: the rates the env-gen cost profiler uses. */
export const DEFAULT_MODELS: ModelSpec[] = [
  { id: "opus", provider: "anthropic", model: "claude-opus-5-5", api: { key_env: "ANTHROPIC_API_KEY" }, price_in: 4, price_out: 20, modalities: ["text", "image", "file"] },
  { id: "sonnet", provider: "anthropic", model: "claude-sonnet-5-5", api: { key_env: "ANTHROPIC_API_KEY" }, price_in: 2, price_out: 10, modalities: ["text", "image", "file"] },
  { id: "haiku", provider: "anthropic", model: "claude-haiku-5-5", api: { key_env: "ANTHROPIC_API_KEY" }, price_in: 0.1, price_out: 0.5, modalities: ["text", "image"] },
  { id: "gpt", provider: "openai", model: "gpt-5.4", api: { key_env: "OPENAI_API_KEY" }, price_in: 2.5, price_out: 15, modalities: ["text", "image"] },
  // gemini-2.5-flash is closed to new users; prices are estimates, check them under Library → Models
  { id: "gemini", provider: "google", model: "gemini-3.8-flash", api: { key_env: "GEMINI_API_KEY" }, price_in: 0.5, price_out: 3, modalities: ["text", "image"] },
  { id: "gemini_3_flash", provider: "google", model: "gemini-3-flash-preview", api: { key_env: "GEMINI_API_KEY" }, price_in: 0.5, price_out: 3, modalities: ["text", "image"] },
  { id: "gemini_lite", provider: "google", model: "gemini-3.1-flash-lite", api: { key_env: "GEMINI_API_KEY" }, price_in: 0.25, price_out: 1.5, modalities: ["text", "image"] },
  // weaker models, for papers whose gains show only when a single call often fails (they reported on gpt-3.5-class models)
  // free-tier Gemma has its own, much lower quota (requests and tokens per minute): 10 calls a minute keeps under it
  // gemma thinks at length before answering, and its thinking counts in the output limit: no default limit for it
  { id: "gemma", provider: "google", model: "gemma-4-26b-a4b-it", api: { key_env: "GEMINI_API_KEY", params: { rpm: 10, max_output: null } }, price_in: 0, price_out: 0, modalities: ["text"] },
  { id: "local", provider: "openai_compatible", model: "my-vllm-model", api: { base_url: "http://127.0.0.1:8000/v1", key_env: "LOCAL_API_KEY" }, price_in: 0, price_out: 0, modalities: ["text"] },
  // embedding and rerank: prices left at 0 to be filled in with your provider's rates
  { id: "embed", kind: "embedding", provider: "openai", model: "text-embedding-3-large", api: { key_env: "OPENAI_API_KEY" }, price_in: 0, price_out: 0, modalities: ["text"] },
  { id: "gemini_embed", kind: "embedding", provider: "google", model: "gemini-embedding-001", api: { key_env: "GEMINI_API_KEY" }, price_in: 0.15, price_out: 0, modalities: ["text"] },
  { id: "rerank", kind: "rerank", provider: "local", model: "bge-reranker-v2-m3", api: { base_url: "http://127.0.0.1:8001", key_env: "" }, price_in: 0, price_out: 0, modalities: ["text"] },
];

export const DEFAULT_TOOLS: ToolSpec[] = [
  { id: "web_search", description: "Search the web", adapter: "builtin", effect: "read", needs_env: null },
  { id: "fetch", description: "Fetch a page's main text", adapter: "builtin", effect: "read", needs_env: null },
  { id: "bash", description: "Run shell commands in the sandbox", adapter: "cli", effect: "write", needs_env: "sandbox" },
  { id: "edit_file", description: "Read and write files in the sandbox", adapter: "builtin", effect: "write", needs_env: "sandbox" },
  { id: "run_tests", description: "Run tests and return results", adapter: "cli", effect: "read", needs_env: "sandbox" },
  { id: "browser", description: "Drive a headless browser", adapter: "mcp", effect: "write", needs_env: "browser" },
  { id: "run_sql", description: "Run read-only SQL", adapter: "http", effect: "read", needs_env: "database" },
  { id: "merge_pr", description: "Merge a pull request", adapter: "http", effect: "irreversible", needs_env: "external" },
  { id: "send_email", description: "Send an email", adapter: "http", effect: "irreversible", needs_env: "external" },
  { id: "issue_refund", description: "Issue a refund", adapter: "http", effect: "irreversible", needs_env: "external" },
];

export interface RunnerInfo {
  id: string;
  tier: HarnessTier;
  label: string;
  hint: string;
  caps: Capabilities;
}

const caps = (c: Partial<Capabilities>): Capabilities => ({
  context_control: "none",
  tool_injection: [],
  observable_steps: "none",
  approval_hook: false,
  resumable: false,
  cost_reporting: false,
  ...c,
});

/** Harness adapters the platform knows (Spec §5.2 / §5.4). Capabilities are each adapter's defaults. */
export const RUNNERS: RunnerInfo[] = [
  {
    id: "native",
    tier: "native",
    label: "Platform-native loop",
    hint: "Context, memory and stop conditions are all controlled by the platform",
    caps: caps({ context_control: "full", tool_injection: ["native"], observable_steps: "full", approval_hook: true, resumable: true, cost_reporting: true }),
  },
  {
    id: "claude-agent-sdk",
    tier: "sdk",
    label: "Claude Agent SDK",
    hint: "Claude Code's harness, driven as a library; has a tool-approval callback",
    caps: caps({ context_control: "partial", tool_injection: ["mcp", "native"], observable_steps: "full", approval_hook: true, resumable: true, cost_reporting: true }),
  },
  {
    id: "openai-agents-sdk",
    tier: "sdk",
    label: "OpenAI Agents SDK",
    hint: "In-process adapter; partial control through callbacks",
    caps: caps({ context_control: "partial", tool_injection: ["mcp", "native"], observable_steps: "full", approval_hook: true, resumable: true, cost_reporting: true }),
  },
  {
    id: "langgraph",
    tier: "sdk",
    label: "LangGraph agent",
    hint: "Wrap an existing LangGraph graph as one agent",
    caps: caps({ context_control: "partial", tool_injection: ["mcp", "native"], observable_steps: "full", approval_hook: true, resumable: true, cost_reporting: false }),
  },
  {
    id: "claude-code",
    tier: "process",
    label: "Claude Code CLI",
    hint: "claude -p --bare --output-format stream-json --resume; tools injected via --mcp-config",
    caps: caps({ context_control: "none", tool_injection: ["mcp", "cli"], observable_steps: "partial", approval_hook: false, resumable: true, cost_reporting: true }),
  },
  {
    id: "codex",
    tier: "process",
    label: "Codex CLI",
    hint: "codex exec --json；codex exec resume <id>",
    caps: caps({ context_control: "none", tool_injection: ["mcp", "cli"], observable_steps: "partial", approval_hook: false, resumable: true, cost_reporting: false }),
  },
  {
    id: "acp",
    tier: "process",
    label: "Any ACP agent",
    hint: "Agent Client Protocol: native in Gemini CLI; Claude Code / Codex via adapters",
    caps: caps({ context_control: "none", tool_injection: ["mcp"], observable_steps: "partial", approval_hook: true, resumable: true, cost_reporting: false }),
  },
  {
    id: "custom-stdio",
    tier: "process",
    label: "Custom program (stdio)",
    hint: "One JSON per line: deliver in; status / output / usage out. Or a one-shot command",
    caps: caps({ context_control: "none", tool_injection: ["cli"], observable_steps: "none", approval_hook: false, resumable: false, cost_reporting: false }),
  },
  {
    id: "a2a",
    tier: "remote",
    label: "Remote A2A agent",
    hint: "Reads the Agent Card and calls it one Task at a time",
    caps: caps({ context_control: "none", tool_injection: [], observable_steps: "none", approval_hook: false, resumable: true, cost_reporting: false }),
  },
];

export const runnerById = (id?: string) => RUNNERS.find((r) => r.id === id);

export function defaultAgent(name = "New agent"): AgentData {
  return {
    kind: "agent",
    name,
    role: "",
    interface: defaultInterface("agent"),
    pipeline: { pre: [], post: [] },
    model: "sonnet",
    harness: {
      tier: "native",
      runner: "native",
      loop: "react",
      instructions: "",
      max_steps: 30,
      own_memory: "keep",
      capabilities: { ...RUNNERS[0].caps },
    },
    tools: [],
    context: { budget_total: 120000, history_strategy: "window_then_summary", history_window: 30, mask_tool_output: true },
    triggers: ["on_message"],
    concurrency: "coalesce",
    modalities_in: ["text"],
    on_unsupported: "describe",
    spawn: null,
    budget_usd: null,
  };
}

export function defaultData(kind: NodeKind): NodeData {
  switch (kind) {
    case "agent":
      return defaultAgent();
    case "human":
      return { kind: "human", name: "Human", role: "Approves and guides", approves: true } satisfies HumanData;
    case "env":
      return {
        kind: "env",
        name: "Sandbox",
        env_kind: "sandbox",
        image: "python:3.12",
        lifecycle: "per_run",
        snapshot: "on_write",
        egress: [],
      } satisfies EnvData;
    case "plugin":
      return defaultPlugin("memory");
    case "model":
      return {
        kind: "model",
        name: "Model call",
        model: "sonnet",
        system_prompt: "",
        prompt: "{{input}}",
        temperature: null,
        max_tokens: null,
        interface: defaultInterface("model"),
      } satisfies ModelNodeData;
    case "function":
      return {
        kind: "function",
        name: "Function",
        fn: { lang: "js", code: "return input;" },
        join: "any",
        interface: defaultInterface("function"),
      } satisfies FunctionNodeData;
    case "group":
      return { kind: "group", name: "Sub-team", interface: defaultInterface("group"), budget_usd: null, on_error: "retry_then_fail_up" } satisfies GroupData;
  }
}

export function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptySystem(name = "Untitled system"): SystemDoc {
  return {
    spec_version: SPEC_VERSION,
    id: newId("sys"),
    name,
    description: "",
    updated_at: new Date().toISOString(),
    budget: { usd: 5, max_rounds: 40, wallclock_min: 30 },
    termination: ["any_agent_calls_finish", "budget_exceeded"],
    models: DEFAULT_MODELS.map((m) => ({ ...m })),
    tools: DEFAULT_TOOLS.map((t) => ({ ...t })),
    schemas: [],
    nodes: [],
    edges: [],
    policies: [],
  };
}

export const KIND_LABEL: Record<NodeKind, string> = {
  agent: "Agent",
  model: "Model",
  function: "Function",
  human: "Human",
  env: "Env",
  plugin: "Plugin",
  group: "Group",
};

/** A room is an env: a shared conversation space its members access. */
export function defaultRoom(name = "room"): EnvData {
  return { kind: "env", name, env_kind: "room", image: "", lifecycle: "per_run", snapshot: "never", egress: [], room: { policy: "free", history: "persistent" } };
}

/** Default binding for a new access edge, by what it points at. */
export function defaultBinding(target: NodeData): import("./types").AccessBinding {
  if (target.kind === "plugin") {
    if (target.preset === "knowledge") return { mode: "auto_inject", read: { top_k: 5, budget_tokens: 4000 }, write: { when: "never" } };
    if (target.preset === "memory") return { mode: "auto_inject", read: { top_k: 8, budget_tokens: 2000 }, write: { when: "after_turn" } };
    return { mode: "tool", write: { when: "agent_tool" }, tools: [] };
  }
  if (target.kind === "env" && target.env_kind === "room") return { mode: "pinned", read: { budget_tokens: 8000 }, write: { when: "agent_tool" } };
  return { mode: "tool", tools: [] };
}
