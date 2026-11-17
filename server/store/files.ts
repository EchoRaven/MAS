// A small file-backed store: one JSON file per system, one directory per run
// (record.json + events.jsonl). Writes go through a temp file and rename.
import fs from "node:fs";
import path from "node:path";
import type { SystemDoc } from "@/model/types";
import type { RunEvent, RunRecord } from "@/run/events";

const SAFE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export function safeId(id: string): string {
  if (!SAFE_ID.test(id) || id.startsWith(".")) throw new HttpError(400, `Invalid id: ${id}`);
  return id;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export class Store {
  readonly systemsDir: string;
  readonly runsDir: string;
  constructor(readonly dataDir: string) {
    this.systemsDir = path.join(dataDir, "systems");
    this.runsDir = path.join(dataDir, "runs");
    fs.mkdirSync(this.systemsDir, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });
  }

  /** Where a component keeps state across runs: plugin stores, workspaces, databases. */
  stateDir(...parts: string[]): string {
    const dir = path.join(this.dataDir, "state", ...parts.map(safeId));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // systems -----------------------------------------------------------------
  listSystems(): SystemDoc[] {
    return fs
      .readdirSync(this.systemsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<SystemDoc>(path.join(this.systemsDir, f)))
      .filter((d): d is SystemDoc => !!d)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  getSystem(id: string): SystemDoc | null {
    return readJson<SystemDoc>(path.join(this.systemsDir, `${safeId(id)}.json`));
  }
  putSystem(doc: SystemDoc) {
    writeJson(path.join(this.systemsDir, `${safeId(doc.id)}.json`), doc);
  }
  deleteSystem(id: string) {
    fs.rmSync(path.join(this.systemsDir, `${safeId(id)}.json`), { force: true });
  }

  // runs --------------------------------------------------------------------
  private runDir(id: string) {
    return path.join(this.runsDir, safeId(id));
  }
  putRun(rec: RunRecord, doc?: SystemDoc) {
    writeJson(path.join(this.runDir(rec.id), "record.json"), rec);
    if (doc) writeJson(path.join(this.runDir(rec.id), "system.json"), doc);
  }
  getRun(id: string): RunRecord | null {
    return readJson<RunRecord>(path.join(this.runDir(id), "record.json"));
  }
  getRunSystem(id: string): SystemDoc | null {
    return readJson<SystemDoc>(path.join(this.runDir(id), "system.json"));
  }
  listRuns(systemId?: string): RunRecord[] {
    return fs
      .readdirSync(this.runsDir)
      .map((d) => readJson<RunRecord>(path.join(this.runsDir, d, "record.json")))
      .filter((r): r is RunRecord => !!r && (!systemId || r.system_id === systemId))
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
  }
  appendEvent(id: string, e: RunEvent) {
    fs.appendFileSync(path.join(this.runDir(id), "events.jsonl"), JSON.stringify(e) + "\n");
  }
  events(id: string): RunEvent[] {
    const file = path.join(this.runDir(id), "events.jsonl");
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as RunEvent);
  }
  deleteRun(id: string) {
    fs.rmSync(this.runDir(id), { recursive: true, force: true });
  }
}
