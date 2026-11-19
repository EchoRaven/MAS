// The browser's side of the server API (served under /api on the same
// origin; the dev and preview servers proxy it). Every call carries the
// server token the person entered in Settings.
import type { Dataset, DatasetSummary } from "@/run/datasets";
import type { EvalCase, EvalRecord, Grader } from "@/run/evals";
import type { RunEvent, RunRecord } from "@/run/events";
import type { ModelSpec, SystemDoc } from "@/model/types";

const TOKEN_KEY = "mas-server-token";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the token lasts for this page only */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type EvalSummary = Omit<EvalRecord, "cases"> & { total: number; set: string; questions: number; first_question: string; set_name?: string };

export interface SystemVersion {
  version: string;
  saved_at: number;
  updated_at: string;
  name: string;
  nodes: number;
  edges: number;
}

export interface ModelHealth {
  id: string;
  model: string;
  kind: string;
  status: "ok" | "failing" | "no_key" | "unknown";
  why?: string;
  at?: number;
}

export async function api<T>(method: string, path: string, body?: unknown, opts: { token?: string; raw?: boolean } = {}): Promise<T> {
  const token = opts.token ?? getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !opts.raw ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : opts.raw ? (body as BodyInit) : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new ApiError(res.status, res.status === 404 || res.status === 502 || res.status === 504 ? "Server not reachable" : text.slice(0, 200));
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export type HostedState = { running: boolean; address?: string; container?: string };
export type HostedServiceInfo = import("@/model/hosting").HostManifest extends infer M
  ? { id: string; name: string; created_at: string; current: number; versions: { n: number; from: "upload" | "git"; source: string; at: string; files: number; image?: string; built_at?: string; build_ok?: boolean }[]; manifest: M; overrides: Partial<M>; state?: HostedState }
  : never;
export type EndpointTest = { ok: boolean; detail: string; tools?: { name: string; description: string }[]; ms: number };

export const Api = {
  hostedServices: () => api<{ services: HostedServiceInfo[] }>("GET", "/hosted"),
  createHosted: (body: { name: string; archive_base64?: string; filename?: string; git?: string; manifest?: Partial<import("@/model/hosting").HostManifest> }) => api<HostedServiceInfo>("POST", "/hosted", body),
  newHostedVersion: (id: string, body: { archive_base64?: string; filename?: string; git?: string }) => api<HostedServiceInfo>("POST", `/hosted/${id}/versions`, body),
  configureHosted: (id: string, manifest: Partial<import("@/model/hosting").HostManifest>) => api<HostedServiceInfo>("PUT", `/hosted/${id}/config`, manifest),
  buildHosted: (id: string) => api<{ ok: boolean; log: string; image?: string }>("POST", `/hosted/${id}/build`),
  startHosted: (id: string) => api<HostedState>("POST", `/hosted/${id}/start`),
  stopHosted: (id: string) => api("POST", `/hosted/${id}/stop`),
  hostedLogs: (id: string) => api<{ logs: string }>("GET", `/hosted/${id}/logs`),
  deleteHosted: (id: string) => api("DELETE", `/hosted/${id}`),
  testEndpoint: (endpoint: import("@/model/hosting").Endpoint, kind: "mcp" | "http") => api<EndpointTest>("POST", "/connections/test", { endpoint, kind }),
  health: () => api<{ ok: boolean }>("GET", "/health"),
  session: (token?: string) => api<{ ok: boolean; local_exec: boolean; rpm?: number }>("GET", "/session", undefined, { token }),
  systems: () => api<{ systems: SystemDoc[]; deleted?: Record<string, string> }>("GET", "/systems"),
  putSystem: (doc: SystemDoc) => api("PUT", `/systems/${encodeURIComponent(doc.id)}`, doc),
  versions: (id: string) => api<{ versions: SystemVersion[] }>("GET", `/systems/${encodeURIComponent(id)}/versions`),
  restoreVersion: (id: string, version: string) => api<SystemDoc>("POST", `/systems/${encodeURIComponent(id)}/versions/${version}/restore`),
  deleteSystem: (id: string) => api("DELETE", `/systems/${encodeURIComponent(id)}`),
  startRun: (body: { doc: SystemDoc; input: string; mock?: boolean; force?: boolean; vars?: Record<string, unknown> }) => api<RunRecord>("POST", "/runs", body),
  runs: (systemId?: string) => api<{ runs: RunRecord[] }>("GET", `/runs${systemId ? `?system=${encodeURIComponent(systemId)}` : ""}`),
  run: (id: string) => api<{ run: RunRecord; events: RunEvent[]; system: SystemDoc | null; active: boolean }>("GET", `/runs/${id}`),
  answer: (id: string, request: string, answer: { approved?: boolean; text?: string }) => api("POST", `/runs/${id}/answer`, { request, ...answer }),
  stop: (id: string) => api("POST", `/runs/${id}/stop`),
  deleteRun: (id: string) => api("DELETE", `/runs/${id}`),
  datasets: () => api<{ datasets: DatasetSummary[] }>("GET", "/datasets"),
  dataset: (id: string) => api<Dataset>("GET", `/datasets/${encodeURIComponent(id)}`),
  createDataset: (body: { name: string; description?: string; text: string; format?: string; grader?: Grader; source?: Dataset["source"]; sample?: { n?: number; seed?: number } }) => api<DatasetSummary & { skipped: number }>("POST", "/datasets", body),
  deleteDataset: (id: string) => api("DELETE", `/datasets/${encodeURIComponent(id)}`),
  startEval: (body: { doc: SystemDoc; cases?: EvalCase[]; dataset_id?: string; sample?: { n?: number; seed?: number }; grader: Grader; mock?: boolean; concurrency?: number; on_model?: string; time_limit_min?: number; repeats?: number; model_map?: Record<string, string>; vars?: Record<string, unknown>; force?: boolean; expect?: import("@/model/types").ResultSpec }) => api<EvalRecord>("POST", "/evals", body),
  /** several systems on the same questions, run one after another */
  startEvalBatch: (body: { docs: SystemDoc[]; cases?: EvalCase[]; dataset_id?: string; sample?: { n?: number; seed?: number }; grader: Grader; mock?: boolean; concurrency?: number; on_model?: string; time_limit_min?: number; repeats?: number; model_map?: Record<string, string>; vars?: Record<string, unknown>; force?: boolean; expect?: import("@/model/types").ResultSpec }) => api<{ evals: EvalRecord[] }>("POST", "/evals/batch", body),
  evals: (systemId?: string) => api<{ evals: EvalSummary[] }>("GET", `/evals${systemId ? `?system=${encodeURIComponent(systemId)}` : ""}`),
  evalRecord: (id: string) => api<{ eval: EvalRecord; active: boolean }>("GET", `/evals/${id}`),
  regradeEval: (id: string, grader?: Grader) => api<EvalRecord>("POST", `/evals/${id}/regrade`, { grader }),
  /** Questions flagged as broken in a dataset (left out of scores on Compare). */
  datasetFlags: (id: string) => api<{ flags: DatasetFlag[] }>("GET", `/datasets/${encodeURIComponent(id)}/flags`),
  /** Flag a question (a reason) or clear its flag (reason null). */
  flagQuestion: (id: string, input: string, reason: string | null) => api<{ flags: DatasetFlag[] }>("PUT", `/datasets/${encodeURIComponent(id)}/flags`, { input, reason }),
  /** Try an env's tools: a preview session on a throwaway copy (an imported env: the real service). */
  envPreview: (systemId: string, envId: string) => api<{ session: string; copy: boolean; tools: PreviewTool[] }>("POST", `/systems/${encodeURIComponent(systemId)}/envs/${encodeURIComponent(envId)}/preview`, {}),
  envPreviewCall: (systemId: string, envId: string, session: string, body: { tool: string; args: Record<string, unknown>; confirm?: boolean }) =>
    api<{ result: string; error: boolean; seconds: number; log: { at: string; level: string; text: string }[]; usd: number }>("POST", `/systems/${encodeURIComponent(systemId)}/envs/${encodeURIComponent(envId)}/preview/${session}/call`, body),
  envPreviewClose: (systemId: string, envId: string, session: string) => api<{ ok: true }>("DELETE", `/systems/${encodeURIComponent(systemId)}/envs/${encodeURIComponent(envId)}/preview/${session}`),
  /** What is inside an env: a sandbox's files (by run, by agent), one file's text, a database's tables and rows. */
  envContents: (systemId: string, envId: string, q: { run?: string; agent?: string; path?: string; table?: string } = {}) =>
    api<EnvContents>("GET", `/systems/${encodeURIComponent(systemId)}/envs/${encodeURIComponent(envId)}/contents${Object.keys(q).length ? `?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}` : ""}`),
  stopEval: (id: string) => api("POST", `/evals/${id}/stop`),
  deleteEval: (id: string) => api("DELETE", `/evals/${id}`),
  secrets: () => api<{ secrets: { name: string; source: "store" | "environment" | null; referenced: boolean }[] }>("GET", "/secrets"),
  setSecret: (name: string, value: string) => api("PUT", `/secrets/${encodeURIComponent(name)}`, { value }),
  deleteSecret: (name: string) => api("DELETE", `/secrets/${encodeURIComponent(name)}`),
  modelHealth: (models: ModelSpec[]) => api<{ models: ModelHealth[] }>("POST", "/models/health", { models }),
  testModel: (model: ModelSpec) => api<{ ok: boolean; ms: number; reply?: string; error?: string }>("POST", "/models/test", { model }),
  knowledge: () => api<{ root: string; files: { path: string; size: number }[] }>("GET", "/knowledge"),
  putKnowledge: (path: string, content: string | Blob) => api("PUT", `/knowledge/${path.split("/").map(encodeURIComponent).join("/")}`, content, { raw: true }),
  deleteKnowledge: (path: string) => api("DELETE", `/knowledge/${path.split("/").map(encodeURIComponent).join("/")}`),
};

/** Follow a run's events (replay, then live) until it ends or `signal` aborts. */
export async function followRun(id: string, onEvent: (e: RunEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/runs/${id}/events`, { headers: { authorization: `Bearer ${getToken()}` }, signal });
  if (!res.ok || !res.body) throw new ApiError(res.status, `Could not follow the run (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (block.startsWith("event: end")) return;
      const data = block.split("\n").find((l) => l.startsWith("data: "));
      if (data) onEvent(JSON.parse(data.slice(6)) as RunEvent);
    }
  }
}

export type EnvContents =
  | { kind: "files"; runs: string[]; run: string | null; agents: string[]; agent: string | null; lifecycle: string; share: string; files?: { path: string; size: number }[]; file?: { path: string; size: number; binary: boolean; text: string; truncated: boolean } }
  | { kind: "database"; tables: { name: string; rows: number; columns: string[] }[]; table?: string; sample?: Record<string, unknown>[]; note?: string }
  | { kind: "imported"; manifest: { name: string; services: { name: string; image?: string; port?: number | null }[]; health: string; tools: string[]; http: unknown[] } }
  | { kind: "room" | "none" };

export interface PreviewTool {
  name: string;
  description: string;
  input_schema: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  effect: string;
  needs_confirm: boolean;
}

export interface DatasetFlag {
  input: string;
  reason: string;
  at: string;
}
