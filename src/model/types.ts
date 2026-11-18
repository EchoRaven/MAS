// The system document: the in-memory form of a multi-agent system definition
// (Spec v0). The canvas edits it, the YAML view serialises it, the validator
// and the simulator read it.

import type { Endpoint } from "./hosting";
import type { DbQuerySpec, IndexSpec, MemoryPolicy, RetrievalSpec } from "./pipelines";
import type { ParamValue } from "./steps";

export type { DbQuerySpec, IndexSpec, MemoryPolicy, RetrievalSpec } from "./pipelines";
export type { ParamValue, Step } from "./steps";

export const SPEC_VERSION = "0.3";

// ---------------------------------------------------------------------------
// Interfaces. Every component that exchanges data declares typed ports; an
// edge always runs from an output port to an input port. Resources (env,
// store) are not wired through ports but through access edges on the
// reserved "res" handle.

/**
 * What travels through a port.
 * - message: a chat message { role, content: (text | image | file)[], meta }
 * - text: a plain string
 * - json: a JSON value; `schema` names an entry in SystemDoc.schemas
 * - file: a file reference { uri, mime, name }
 * - event: a platform event { type, payload } (timers, webhooks, state changes)
 * - any: accepts or emits anything
 */
export type DataType = "message" | "text" | "json" | "file" | "event" | "any";

export interface PortSpec {
  /** unique per direction within the component; [a-z0-9_] */
  id: string;
  type: DataType;
  /** json only: id of a SystemDoc.schemas entry */
  schema?: string | null;
  /** inputs only: the component cannot run until this port has a value */
  required?: boolean;
  description?: string;
}

export interface Interface {
  inputs: PortSpec[];
  outputs: PortSpec[];
}

export interface SchemaSpec {
  id: string;
  description: string;
  /** JSON Schema, as text */
  json_schema: string;
}

/** Reserved handle for access edges (agent / human -> env / plugin). */
export const RES_PORT = "res";

// ---------------------------------------------------------------------------
// Functions. One contract for every piece of user code on the canvas: edge
// transforms, function nodes and agent pre/post processors.
//
//   f(input, ctx) -> output | null
//
// input  — the value arriving (for function nodes: { <input port id>: value })
// ctx    — { run_id, run_input (what the run started with), node, edge?, vars, now }
// output — the value to emit (function nodes: { <output port id>: value },
//          so returning one key routes to one port); null drops it.

export type FnLang = "template" | "jsonata" | "js" | "python" | "llm";

export interface FunctionSpec {
  lang: FnLang;
  /** template: "Review: {{input.text}}" · jsonata: expression · js / python: function body · llm: prompt */
  code: string;
  /** llm only: model id from the catalog */
  model?: string | null;
  timeout_ms?: number | null;
}

/** One stage of an agent's input or output wrapper. */
export type ProcessorOp = "transform" | "filter" | "parse_json" | "validate" | "redact" | "route" | "summarize";

export interface Processor {
  id: string;
  op: ProcessorOp;
  name: string;
  /** transform / filter / route / summarize */
  fn?: FunctionSpec | null;
  /** parse_json / validate: schema id */
  schema?: string | null;
  on_fail?: "retry" | "drop" | "error" | "fallback";
  max_retries?: number | null;
}

/** An agent is a wrapper: input stages -> context -> harness loop (model + tools) -> output stages. */
export interface Pipeline {
  pre: Processor[];
  post: Processor[];
}

export type HarnessTier = "native" | "sdk" | "process" | "remote";
export type NativeLoop = "react" | "plan_execute" | "reflexion" | "tree_search" | "single_shot" | "custom";
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
  /** native only: the agent loop (presets in the step registry, slot "loop") */
  loop?: NativeLoop;
  loop_params?: Record<string, ParamValue>;
  /** loop === "custom": the whole turn as code */
  loop_fn?: FunctionSpec | null;
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

export type AgentHook = "on_start" | "before_model" | "after_model" | "before_tool" | "after_tool" | "on_error" | "on_finish";
/** f(event, ctx) -> event | null: return a modified event, or null to block it (before_*) */
export type AgentHooks = Partial<Record<AgentHook, FunctionSpec | null>>;

/**
 * How a component uses an env or plugin, configured on the access edge. One
 * shape for memory, knowledge bases, task boards, rooms and imported envs.
 * Every hook is a FunctionSpec, so it can be config (template / jsonata) or code.
 */
export interface AccessBinding {
  /** tool: the agent decides when to read · auto_inject: read before every turn · pinned: always in context */
  mode: "tool" | "auto_inject" | "pinned";
  read?: {
    /** builds the query from ctx (last message, task, vars); default: the incoming message text */
    query?: FunctionSpec | null;
    top_k?: number | null;
    /** e.g. scope == "end_user" && age_days < 30 */
    filter?: string | null;
    /** renders results into the context; default: a bulleted list with sources */
    format?: FunctionSpec | null;
    /** tokens this source may take in the context */
    budget_tokens?: number | null;
    /** per-agent overrides of the plugin's retrieval pipeline */
    retrieval?: Partial<RetrievalSpec> | null;
  } | null;
  write?: {
    /** agent_tool: the agent calls a write tool · after_turn: the platform writes after each turn · never */
    when: "agent_tool" | "after_turn" | "never";
    /** after_turn: what to store, from the turn's messages */
    extract?: FunctionSpec | null;
    /** rooms: the message type posts on this edge carry (msg.cause_by), e.g. "WritePRD" */
    tag?: string | null;
  } | null;
  /** envs: allowed tools of the env's MCP server (empty = all) */
  tools?: string[];
}

/** Memory / knowledge reads now live on the access edge (AccessBinding); this is only the agent's own history. */
export interface ContextSpec {
  budget_total: number; // tokens
  history_strategy: "window" | "summary" | "window_then_summary" | "retrieve";
  history_window: number;
  mask_tool_output: boolean;
}

export type Trigger = "on_message" | "on_call" | "on_handoff" | "on_state" | "on_schedule" | "on_start" | "on_event";
export type Concurrency = "coalesce" | "queue" | "parallel" | "interrupt";

export interface AgentData {
  kind: "agent";
  name: string;
  role: string;
  interface: Interface;
  pipeline: Pipeline;
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
  /** code run at points of every turn */
  hooks?: AgentHooks;
  /** positions of parts on the agent's internals canvas (UI only) */
  layout?: Record<string, { x: number; y: number }>;
}

export interface HumanData {
  kind: "human";
  name: string;
  role: string;
  approves: boolean;
}

/** room: a shared conversation space. Members are the agents / humans with an access edge to it. */
export type EnvKind = "app" | "sandbox" | "browser" | "database" | "service" | "room" | "external";
export type SpeakPolicy = "free" | "round_robin" | "selector" | "mention" | "bid";

export interface EnvData {
  kind: "env";
  name: string;
  env_kind: EnvKind;
  image: string;
  lifecycle: "per_run" | "per_session" | "persistent";
  snapshot: "never" | "on_write" | "on_checkpoint";
  egress: string[];
  /** room only */
  room?: RoomSpec | null;
  /** imported envs: the contract it was imported with */
  manifest?: EnvManifest | null;
  /** database envs: how agents may query it */
  db?: DbQuerySpec | null;
}

/**
 * The environment contract (mas-env/1). Anything that can be described this
 * way can be plugged in: DT (DecodingTrust) envs, env-gen deliveries, or a
 * hand-written stack. Agents with an access edge to the env get its MCP tools.
 */
export interface EnvManifest {
  contract: "mas-env/1";
  id: string;
  name: string;
  version?: string;
  /** where it came from */
  source: { format: "mas-env" | "dtap" | "envgen" | "compose"; path?: string };
  kind: "web_app" | "sandbox" | "service";
  runtime: {
    compose?: string;
    /** build from source, or pull prebuilt images */
    variant?: "build" | "hub";
    network?: "host" | "bridge";
    services: { name: string; image?: string; port?: number | null; port_env?: string }[];
  };
  lifecycle: {
    start?: string;
    stop?: string;
    /** required: GET this until it answers 2xx */
    health: string;
    /** HTTP "POST {api}/api/v1/reset" or a command */
    reset?: string;
    init_tenant?: string;
  };
  /** what agents can use */
  exposes: {
    http: { name: string; base: string }[];
    mcp?: { transport: "http" | "stdio"; start?: string; url?: string; auth: "oauth_jwks" | "bearer_env" | "none"; env?: Record<string, string>; tools: string[]; /** where the MCP server is: remote, or a hosted service (instead of url / start) */ endpoint?: Endpoint } | null;
  };
  /** login and test accounts; secrets are never stored in the manifest, only the env var that holds them */
  auth?: { mode: "embedded" | "idp" | "none"; login?: string; test_users?: { email: string; password_env?: string }[] } | null;
  state?: { seed: string[]; snapshots?: string } | null;
  tasks?: { dir?: string; judge?: string } | null;
}

export interface RoomSpec {
  policy: SpeakPolicy;
  /** selector: which member picks the next speaker */
  selector?: string;
  history: "persistent" | "since_join";
}

/**
 * A plugin adds a capability to the agents attached to it (access edge):
 * memory, a knowledge base, a file workspace, a task board, or anything a
 * user defines. All of them implement one contract (mas-plugin/1):
 *
 *   tools    what an attached agent can call
 *   hooks    before_turn(ctx) -> context to inject · after_turn(turn) -> what to store · on_start()
 *   backend  where it runs: built in, an MCP server, an HTTP service, or code
 *
 * Presets fill these in; "custom" leaves them all editable. The access edge
 * can still narrow tools and override query / top_k / format per agent.
 */
export type PluginPreset = "memory" | "knowledge" | "workspace" | "board" | "custom";

export interface PluginTool {
  name: string;
  description: string;
  effect: ToolEffect;
}

export interface PluginSpec {
  tools: PluginTool[];
  hooks: {
    before_turn?: FunctionSpec | null;
    after_turn?: FunctionSpec | null;
    on_start?: FunctionSpec | null;
  };
  backend: {
    kind: "builtin" | "mcp" | "http" | "code";
    /** mcp (http transport) / http */
    url?: string;
    /** where the backend is: remote (a URL with auth) or a hosted service; used instead of url / command */
    endpoint?: Endpoint;
    /** mcp (stdio) / code */
    command?: string;
    /** non-secret settings; secrets go by env var name */
    config?: Record<string, string>;
  };
  /** where its state lives and who shares it */
  scope: "agent" | "group" | "end_user" | "system";
  storage?: "builtin" | "pgvector" | "qdrant" | "sqlite" | "files" | "none";
  /** knowledge: documents to index · workspace: directories to mount */
  sources?: string[];
  /** how reads find things (memory, knowledge, custom) */
  retrieval?: RetrievalSpec | null;
  /** knowledge: how sources become an index */
  index?: IndexSpec | null;
  /** memory: how turns become records and how long they live */
  memory?: MemoryPolicy | null;
}

export interface PluginData {
  kind: "plugin";
  name: string;
  preset: PluginPreset;
  spec: PluginSpec;
}

/**
 * A composite component. Members are nodes whose `parent` is this group; they
 * live on the group's own canvas. Inside, the group's input ports act as
 * sources and its output ports as targets, so an edge with
 * source = (group, input port) or target = (group, output port) is internal wiring.
 */
export interface GroupData {
  kind: "group";
  name: string;
  interface: Interface;
  budget_usd: number | null;
  on_error: "retry_then_fail_up" | "fail_up" | "ignore";
  /**
   * Run the group in rounds: what reaches an output port goes back in through
   * the inputs until `until` holds (an expression over output, round) or
   * max_rounds is reached. Debates, multi-turn dialogues, review loops.
   */
  /** max_rounds: a number, or "{{vars.rounds ?? 2}}" to set it per run (an evaluation can sweep it) */
  iterate?: { max_rounds: number | string; until?: string | null; feed?: "output" | "input_and_output" } | null;
}

/** A bare model call as a component: no loop, no tools. One input in, one completion out. */
export interface ModelNodeData {
  kind: "model";
  name: string;
  model: string;
  system_prompt: string;
  /** template for the user turn; {{input}} is the incoming value */
  prompt: string;
  temperature: number | null;
  max_tokens: number | null;
  /**
   * Sample the call this many times per input, in parallel, and send the list
   * of replies (a JSON array) on the output: an ensemble in one component
   * (self-consistency, Agent Forest). A number, or "{{vars.<name>}}" to set
   * it per run, so an evaluation can sweep it. Absent or 1: one call, one reply.
   */
  replicas?: number | string | null;
  interface: Interface;
}

/** Deterministic code between components: transform, route, merge, split. */
export interface FunctionNodeData {
  kind: "function";
  name: string;
  fn: FunctionSpec;
  /** run when: any input arrives, or all required inputs have a value */
  join: "any" | "all";
  interface: Interface;
}

export type NodeData = AgentData | ModelNodeData | FunctionNodeData | HumanData | EnvData | PluginData | GroupData;
export type NodeKind = NodeData["kind"];

export interface SysNode<D extends NodeData = NodeData> {
  id: string;
  /** position on the canvas of its scope (the root, or its group's own canvas) */
  position: { x: number; y: number };
  /** group membership */
  parent?: string;
  data: D;
}

/** message: async post · call: sync request/response · handoff: transfer of control · access: use an env or plugin (rooms included) */
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
  /** output port of source (an input port when source is the enclosing group); "res" for access */
  source_port: string;
  target: string;
  /** input port of target (an output port when target is the enclosing group); "res" for access */
  target_port: string;
  kind: EdgeKind;
  /** maps the source port's value to what the target port expects; null = pass through (with built-in coercion) */
  transform?: FunctionSpec | null;
  /** deliver only when this expression is true, e.g. input.verdict == "approve" */
  filter?: string | null;
  /** waypoints the edge is routed through, in canvas coordinates (UI only) */
  points?: { x: number; y: number }[];
  label?: string;
  /** handoff: what context travels with it */
  carry?: "none" | "summary" | "full";
  /** access: read or read/write */
  access?: "read" | "read_write";
  /** access: how reads and writes happen */
  binding?: AccessBinding | null;
  gate?: GateSpec | null;
}

export interface ModelSpec {
  id: string;
  /** chat (default) · embedding · rerank */
  kind?: "chat" | "embedding" | "rerank";
  /** mock: the built-in test model (no key, canned replies) for dry runs */
  provider: "anthropic" | "openai" | "google" | "openai_compatible" | "local" | "mock";
  model: string;
  /** how to reach it; the key itself is never stored, only the env var that holds it */
  api: { base_url?: string; key_env?: string; headers?: Record<string, string>; params?: Record<string, unknown> };
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
  /** how the runtime calls it: http POSTs the arguments to url · mcp calls the tool on the server at url · cli runs command (arguments as JSON on stdin) · code runs fn(args, ctx) */
  url?: string;
  command?: string;
  fn?: FunctionSpec | null;
  /** http / mcp: where the tool's server is, remote or hosted; used instead of url */
  endpoint?: Endpoint;
  /** JSON Schema of the arguments, as text; default { input: string } */
  input_schema?: string;
}

export interface SystemPolicy {
  id: string;
  on: string;
  condition: string;
  action: "terminate" | "suspend" | "notify" | "block" | "require_approval";
}

/** What a system's run returns, so it can be checked (see src/run/result.ts). */
export type ResultType = "text" | "number" | "code" | "json" | "choice";
export interface ResultSpec {
  type: ResultType;
  /** for choice: the allowed answers (option letters or words); absent = a letter A–J */
  choices?: string[];
  /** what the answer is, in words, for people and for the Architect */
  description?: string;
}

export interface SystemDoc {
  spec_version: string;
  id: string;
  name: string;
  description: string;
  updated_at: string;
  /** set on a system seeded from a template: which one, and a hash of it as seeded (to tell whether it was edited since) */
  seed?: { template: string; hash: string };
  budget: { usd: number | null; max_rounds: number | null; wallclock_min: number | null };
  /**
   * Where a run's input arrives. Left out, the entry point is inferred from
   * the graph (see model/entry.ts): a person at the edge, an on_start agent,
   * or the component nothing feeds.
   */
  entry?: { node: string; port?: string } | null;
  termination: string[];
  /** optional: what a run returns; each finished run is checked against it */
  result?: ResultSpec;
  models: ModelSpec[];
  tools: ToolSpec[];
  schemas: SchemaSpec[];
  nodes: SysNode[];
  edges: SysEdge[];
  policies: SystemPolicy[];
}
