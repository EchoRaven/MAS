// The run event stream: what a run emits, simulated or real. The browser
// replays it (timeline, canvas status, costs); the server writes it to disk.
import type { SysEdge } from "@/model/types";

export type RunStatus = "idle" | "working" | "waiting" | "done" | "blocked";

/** A request a run makes of a person; the run waits for the answer. */
export interface HumanRequest {
  id: string;
  /** the human component asked (or "" when no human is on the canvas, e.g. a policy approval) */
  node: string;
  /** who asked */
  from: string;
  kind: "approval" | "input";
  text: string;
}

export type RunEvent =
  | { t: number; type: "system_started"; input?: string }
  | { t: number; type: "status"; node: string; status: RunStatus }
  | { t: number; type: "message"; from: string; to: string; edge?: string; room?: string; port?: string; kind: SysEdge["kind"] | "reply"; text: string }
  | { t: number; type: "tool"; node: string; tool: string; args: string; result: string; error?: boolean }
  | { t: number; type: "access"; node: string; target: string; edge: string; op: "read" | "write" }
  | { t: number; type: "gate"; edge: string; gate: string; passed: boolean; reason: string }
  | { t: number; type: "transform"; at: string; edge?: string; label: string; detail: string }
  | { t: number; type: "approval"; node: string; from: string; resolved: boolean }
  | { t: number; type: "usage"; node: string; tokens_in: number; tokens_out: number; usd: number; estimated: boolean; model?: string }
  | { t: number; type: "spawn"; node: string; template: string; count: number }
  // real runs only
  | { t: number; type: "human_request"; request: HumanRequest }
  | { t: number; type: "human_response"; id: string; approved?: boolean; text?: string }
  | { t: number; type: "output"; node: string; port: string; text: string }
  | { t: number; type: "log"; node?: string; level: "info" | "warn" | "error"; text: string }
  | { t: number; type: "system_finished"; reason: string };

export type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RunEventBody = DistOmit<RunEvent, "t">;

/** The summary a server keeps per run. */
export interface RunRecord {
  id: string;
  system_id: string;
  system_name: string;
  input: string;
  status: "running" | "waiting" | "finished" | "failed" | "stopped";
  started_at: string;
  finished_at?: string;
  reason?: string;
  usd: number;
  tokens: number;
  events: number;
  /** the system as it ran */
  pending?: HumanRequest[];
  /** the answer checked against the system's declared result type, when it declares one */
  result_check?: { type: string; ok: boolean; why: string };
}
