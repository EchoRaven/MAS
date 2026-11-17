import type {
  AgentData,
  Capabilities,
  ChannelData,
  EnvData,
  GroupData,
  HarnessTier,
  HumanData,
  ModelSpec,
  NodeData,
  NodeKind,
  StoreData,
  SystemDoc,
  ToolSpec,
} from "./types";
import { SPEC_VERSION } from "./types";

/** Model catalog. Claude prices: Anthropic first-party API rates (2026-11). gpt-5.4: the rates the env-gen cost profiler uses. */
export const DEFAULT_MODELS: ModelSpec[] = [
  { id: "opus", provider: "anthropic", model: "claude-opus-5-5", price_in: 4, price_out: 20, modalities: ["text", "image", "file"] },
  { id: "sonnet", provider: "anthropic", model: "claude-sonnet-5-5", price_in: 2, price_out: 10, modalities: ["text", "image", "file"] },
  { id: "haiku", provider: "anthropic", model: "claude-haiku-5-5", price_in: 0.1, price_out: 0.5, modalities: ["text", "image"] },
  { id: "gpt", provider: "openai", model: "gpt-5.4", price_in: 2.5, price_out: 15, modalities: ["text", "image"] },
  { id: "local", provider: "openai_compatible", model: "my-vllm-model", price_in: 0, price_out: 0, modalities: ["text"] },
];

export const DEFAULT_TOOLS: ToolSpec[] = [
  { id: "web_search", description: "搜索网页", adapter: "builtin", effect: "read", needs_env: null },
  { id: "fetch", description: "抓取网页正文", adapter: "builtin", effect: "read", needs_env: null },
  { id: "bash", description: "在沙箱里执行 shell 命令", adapter: "cli", effect: "write", needs_env: "sandbox" },
  { id: "edit_file", description: "读写沙箱里的文件", adapter: "builtin", effect: "write", needs_env: "sandbox" },
  { id: "run_tests", description: "运行测试并返回结果", adapter: "cli", effect: "read", needs_env: "sandbox" },
  { id: "browser", description: "操作无头浏览器", adapter: "mcp", effect: "write", needs_env: "browser" },
  { id: "run_sql", description: "执行只读 SQL", adapter: "http", effect: "read", needs_env: "database" },
  { id: "merge_pr", description: "合并 Pull Request", adapter: "http", effect: "irreversible", needs_env: "external" },
  { id: "send_email", description: "发送邮件", adapter: "http", effect: "irreversible", needs_env: "external" },
  { id: "issue_refund", description: "发起退款", adapter: "http", effect: "irreversible", needs_env: "external" },
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
    label: "平台原生 loop",
    hint: "上下文、记忆、停止条件全部由平台控制",
    caps: caps({ context_control: "full", tool_injection: ["native"], observable_steps: "full", approval_hook: true, resumable: true, cost_reporting: true }),
  },
  {
    id: "claude-agent-sdk",
    tier: "sdk",
    label: "Claude Agent SDK",
    hint: "Claude Code 的 harness，以库的形式驱动；有工具审批回调",
    caps: caps({ context_control: "partial", tool_injection: ["mcp", "native"], observable_steps: "full", approval_hook: true, resumable: true, cost_reporting: true }),
  },
  {
    id: "openai-agents-sdk",
    tier: "sdk",
    label: "OpenAI Agents SDK",
    hint: "进程内适配，通过回调做部分控制",
    caps: caps({ context_control: "partial", tool_injection: ["mcp", "native"], observable_steps: "full", approval_hook: true, resumable: true, cost_reporting: true }),
  },
  {
    id: "langgraph",
    tier: "sdk",
    label: "LangGraph agent",
    hint: "把现有 LangGraph 图当作一个 agent",
    caps: caps({ context_control: "partial", tool_injection: ["mcp", "native"], observable_steps: "full", approval_hook: true, resumable: true, cost_reporting: false }),
  },
  {
    id: "claude-code",
    tier: "process",
    label: "Claude Code CLI",
    hint: "claude -p --bare --output-format stream-json --resume；--mcp-config 注入 tool",
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
    label: "任意 ACP agent",
    hint: "Agent Client Protocol：Gemini CLI 原生支持，Claude Code / Codex 通过适配器",
    caps: caps({ context_control: "none", tool_injection: ["mcp"], observable_steps: "partial", approval_hook: true, resumable: true, cost_reporting: false }),
  },
  {
    id: "custom-stdio",
    tier: "process",
    label: "自定义程序（stdio）",
    hint: "每行一个 JSON：输入 deliver，输出 status / output / usage；或一次性命令",
    caps: caps({ context_control: "none", tool_injection: ["cli"], observable_steps: "none", approval_hook: false, resumable: false, cost_reporting: false }),
  },
  {
    id: "a2a",
    tier: "remote",
    label: "远程 A2A agent",
    hint: "读取 Agent Card，以 Task 为单位调用",
    caps: caps({ context_control: "none", tool_injection: [], observable_steps: "none", approval_hook: false, resumable: true, cost_reporting: false }),
  },
];

export const runnerById = (id?: string) => RUNNERS.find((r) => r.id === id);

export function defaultAgent(name = "新 Agent"): AgentData {
  return {
    kind: "agent",
    name,
    role: "",
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
    context: { budget_total: 120000, history_strategy: "window_then_summary", history_window: 30, mask_tool_output: true, sources: [] },
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
      return { kind: "human", name: "人工", role: "审批与指导", approves: true } satisfies HumanData;
    case "env":
      return {
        kind: "env",
        name: "沙箱",
        env_kind: "sandbox",
        image: "python:3.12",
        lifecycle: "per_run",
        snapshot: "on_write",
        egress: [],
      } satisfies EnvData;
    case "store":
      return {
        kind: "store",
        name: "共享记忆",
        store_kind: "memory",
        backend: "builtin",
        scope: "group",
        write: "agent_tool",
        sources: [],
      } satisfies StoreData;
    case "channel":
      return { kind: "channel", name: "room", channel_type: "room", policy: "free", history: "persistent" } satisfies ChannelData;
    case "group":
      return { kind: "group", name: "子团队", entry: "", output_from: "", budget_usd: null, on_error: "retry_then_fail_up" } satisfies GroupData;
  }
}

export function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptySystem(name = "未命名系统"): SystemDoc {
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
    nodes: [],
    edges: [],
    policies: [],
  };
}

export const KIND_LABEL: Record<NodeKind, string> = {
  agent: "Agent",
  human: "人",
  env: "Env",
  store: "Store",
  channel: "Room",
  group: "Group",
};
