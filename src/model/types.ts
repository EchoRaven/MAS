// The system document: the in-memory form of a multi-agent system definition
// (Spec v0). The canvas edits it, the YAML view serialises it, the validator
// and the simulator read it.

export const SPEC_VERSION = "0.1";

export type HarnessTier = "native" | "sdk" | "process" | "remote";
export type NativeLoop = "react" | "plan_execute" | "single_shot";
export type Level = "full" | "partial" | "none";

export interface Capabilities {
  context_control: Level;
  tool_injection: ("mcp" | "cli" | "native")[];
  observable_steps: Level;
  approval_hook: boolean;
  resumable: boolean;
  cost_reporting: boolean;
}

export interface HarnessSpec {
  tier: HarnessTier;
  /** native only */
  loop?: NativeLoop;
  /** sdk / process / remote: which adapter drives it */
  runner?: string;
  /** process: launch command; remote: endpoint URL */
  command?: string;
  url?: string;
  instructions: string;
  max_steps?: number;
  /** process/remote harnesses often keep their own memory */
  own_memory?: "keep" | "disable";
  capabilities: Capabilities;
}

export interface StoreBinding {
  store: string;
  mode: "tool" | "auto_inject" | "pinned";
  top_k?: number;
}

export interface ContextSpec {
  budget_total: number; // tokens
  history_strategy: "window" | "summary" | "window_then_summary" | "retrieve";
  history_window: number;
  mask_tool_output: boolean;
  sources: StoreBinding[];
}

export type Trigger = "on_message" | "on_call" | "on_handoff" | "on_state" | "on_schedule" | "on_start" | "on_event";
export type Concurrency = "coalesce" | "queue" | "parallel" | "interrupt";

export interface AgentData {
  kind: "agent";
  name: string;
  role: string;
  model: string; // model id from the system's model catalog
  harness: HarnessSpec;
  tools: string[]; // tool ids from the catalog
  context: ContextSpec;
  triggers: Trigger[];
  concurrency: Concurrency;
  modalities_in: string[];
  on_unsupported: "describe" | "extract_text" | "as_file" | "reject";
  spawn?: { template: string; max_instances: number } | null;
  budget_usd?: number | null;
}

export interface HumanData {
  kind: "human";
  name: string;
  role: string;
  approves: boolean;
}

export type EnvKind = "sandbox" | "browser" | "database" | "service" | "external";
export interface EnvData {
  kind: "env";
  name: string;
  env_kind: EnvKind;
  image: string;
  lifecycle: "per_run" | "per_session" | "persistent";
  snapshot: "never" | "on_write" | "on_checkpoint";
  egress: string[];
}

export interface StoreData {
  kind: "store";
  name: string;
  store_kind: "memory" | "knowledge" | "board";
  backend: "builtin" | "pgvector" | "qdrant" | "mcp" | "http";
  scope: "agent" | "group" | "end_user" | "system";
  write: "agent_tool" | "auto_extract" | "none";
  sources: string[];
}

export type SpeakPolicy = "free" | "round_robin" | "selector" | "mention" | "bid";
export interface ChannelData {
  kind: "channel";
  name: string;
  channel_type: "room" | "topic";
  policy: SpeakPolicy;
  /** selector: which agent picks the next speaker */
  selector?: string;
  history: "persistent" | "since_join";
}

export interface GroupData {
  kind: "group";
  name: string;
  entry: string; // member node id
  output_from: string; // member node id
  budget_usd: number | null;
  on_error: "retry_then_fail_up" | "fail_up" | "ignore";
}

export type NodeData = AgentData | HumanData | EnvData | StoreData | ChannelData | GroupData;
export type NodeKind = NodeData["kind"];

export interface SysNode<D extends NodeData = NodeData> {
  id: string;
  position: { x: number; y: number };
  /** group membership (position is then relative to the group) */
  parent?: string;
  /** groups only */
  size?: { width: number; height: number };
  data: D;
}

/** message: async post · call: sync request/response · handoff: transfer of control · access: read/write a store or env */
export type EdgeKind = "message" | "call" | "handoff" | "access";

export interface GateSpec {
  name: string;
  /** "check: <cmd>" | "judge: <agent id>" | "expr: <expression>" | free text */
  condition: string;
  on_fail: "block" | "require_approval" | "route_back";
  escalate_after: number;
}

export interface SysEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
  /** handoff: what context travels with it */
  carry?: "none" | "summary" | "full";
  /** access: read or read/write */
  access?: "read" | "read_write";
  /** message/call: payload schema name (free text in v0) */
  schema?: string;
  gate?: GateSpec | null;
}

export interface ModelSpec {
  id: string;
  provider: "anthropic" | "openai" | "google" | "openai_compatible" | "local";
  model: string;
  /** USD per million tokens */
  price_in: number;
  price_out: number;
  modalities: string[];
}

export type ToolEffect = "pure" | "read" | "write" | "irreversible";
export interface ToolSpec {
  id: string;
  description: string;
  adapter: "mcp" | "http" | "cli" | "code" | "builtin";
  effect: ToolEffect;
  /** this tool acts on an env of this kind */
  needs_env?: EnvKind | null;
}

export interface SystemPolicy {
  id: string;
  on: string;
  condition: string;
  action: "terminate" | "suspend" | "notify" | "block" | "require_approval";
}

export interface SystemDoc {
  spec_version: string;
  id: string;
  name: string;
  description: string;
  updated_at: string;
  budget: { usd: number | null; max_rounds: number | null; wallclock_min: number | null };
  termination: string[];
  models: ModelSpec[];
  tools: ToolSpec[];
  nodes: SysNode[];
  edges: SysEdge[];
  policies: SystemPolicy[];
}
