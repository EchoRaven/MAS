// The browser's side of the server API (served under /api on the same
// origin; the dev and preview servers proxy it). Every call carries the
// server token the person entered in Settings.
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

export const Api = {
  health: () => api<{ ok: boolean }>("GET", "/health"),
  session: (token?: string) => api<{ ok: boolean; local_exec: boolean }>("GET", "/session", undefined, { token }),
  systems: () => api<{ systems: SystemDoc[] }>("GET", "/systems"),
  putSystem: (doc: SystemDoc) => api("PUT", `/systems/${encodeURIComponent(doc.id)}`, doc),
  deleteSystem: (id: string) => api("DELETE", `/systems/${encodeURIComponent(id)}`),
  startRun: (body: { doc: SystemDoc; input: string; mock?: boolean; force?: boolean }) => api<RunRecord>("POST", "/runs", body),
  runs: (systemId?: string) => api<{ runs: RunRecord[] }>("GET", `/runs${systemId ? `?system=${encodeURIComponent(systemId)}` : ""}`),
  run: (id: string) => api<{ run: RunRecord; events: RunEvent[]; system: SystemDoc | null; active: boolean }>("GET", `/runs/${id}`),
  answer: (id: string, request: string, answer: { approved?: boolean; text?: string }) => api("POST", `/runs/${id}/answer`, { request, ...answer }),
  stop: (id: string) => api("POST", `/runs/${id}/stop`),
  deleteRun: (id: string) => api("DELETE", `/runs/${id}`),
  startEval: (body: { doc: SystemDoc; cases: EvalCase[]; grader: Grader; mock?: boolean; concurrency?: number; on_model?: string; repeats?: number; model_map?: Record<string, string>; force?: boolean }) => api<EvalRecord>("POST", "/evals", body),
  evals: (systemId: string) => api<{ evals: (Omit<EvalRecord, "cases"> & { total: number })[] }>("GET", `/evals?system=${encodeURIComponent(systemId)}`),
  evalRecord: (id: string) => api<{ eval: EvalRecord; active: boolean }>("GET", `/evals/${id}`),
  regradeEval: (id: string, grader?: Grader) => api<EvalRecord>("POST", `/evals/${id}/regrade`, { grader }),
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
