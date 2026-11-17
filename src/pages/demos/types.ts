import type { SystemDoc } from "@/model/types";
import type { RunEvent, RunRecord } from "@/run/events";

/** One entry of public/demos/index.json. */
export interface DemoSummary {
  id: string;
  name: string;
  input: string;
  status: RunRecord["status"];
  reason?: string;
  calls: number;
  tokens: number;
  usd: number;
  seconds: number;
  recorded_at: string;
}

/** public/demos/<id>.json, written by scripts/record-demos.mts. */
export interface Demo {
  id: string;
  name: string;
  input: string;
  vars: Record<string, unknown>;
  /** catalog id -> the model it ran on */
  models: Record<string, string>;
  /** what the recording changed relative to the template */
  changes: string[];
  recorded_at: string;
  run: RunRecord;
  system: SystemDoc;
  events: RunEvent[];
}

export async function loadJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Could not load ${path} (HTTP ${r.status})`);
  return r.json() as Promise<T>;
}
