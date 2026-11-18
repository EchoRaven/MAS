// A small file-backed store: one JSON file per system, one directory per run
// (record.json + events.jsonl). Writes go through a temp file and rename.
import fs from "node:fs";
import path from "node:path";
import { contentHash, isUneditedSeed } from "@/model/templates";
import type { SystemDoc } from "@/model/types";
import type { Dataset } from "@/run/datasets";
import type { EvalRecord } from "@/run/evals";
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
  readonly evalsDir: string;
  constructor(readonly dataDir: string) {
    this.evalsDir = path.join(dataDir, "evals");
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
  /**
   * Stores a system. A copy no newer than its deletion is refused (false):
   * that is a browser that has not heard of the deletion yet, and would bring
   * the system back. A copy edited after the deletion is kept.
   */
  putSystem(doc: SystemDoc): boolean {
    const deleted = this.deletedSystems();
    const at = deleted[doc.id];
    // a seeded system nobody edited is stamped "now" whenever a browser builds it, so its date says nothing: it stays deleted
    if (at && (doc.updated_at <= at || isUneditedSeed(doc))) return false;
    if (at) {
      delete deleted[doc.id];
      writeJson(this.deletedFile, deleted);
    }
    const prev = this.getSystem(doc.id);
    if (prev && contentHash(prev) !== contentHash(doc)) this.snapshot(prev);
    writeJson(path.join(this.systemsDir, `${safeId(doc.id)}.json`), doc);
    return true;
  }

  // versions ------------------------------------------------------------------
  // Earlier versions of a system, kept as it is edited: one every few minutes of
  // editing at most (the browser saves every second or so), the newest 50.
  static VERSION_EVERY_MS = 5 * 60_000;
  static VERSIONS_KEPT = 50;
  private versionsDir(id: string) {
    return path.join(this.dataDir, "history", safeId(id));
  }
  /** Keeps `doc` as a version, unless one was kept a moment ago (`force` keeps it anyway). */
  snapshot(doc: SystemDoc, force = false) {
    const dir = this.versionsDir(doc.id);
    const last = this.listVersions(doc.id)[0];
    if (!force && last && Date.now() - last.saved_at < Store.VERSION_EVERY_MS) return;
    writeJson(path.join(dir, `${Date.now()}.json`), doc);
    for (const old of this.listVersions(doc.id).slice(Store.VERSIONS_KEPT)) fs.rmSync(path.join(dir, `${old.version}.json`), { force: true });
  }
  /** Newest first: when it was kept, and what the system looked like then. */
  listVersions(id: string): { version: string; saved_at: number; updated_at: string; name: string; nodes: number; edges: number }[] {
    const dir = this.versionsDir(id);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => {
        const d = readJson<SystemDoc>(path.join(dir, f));
        const version = f.replace(/\.json$/, "");
        return d ? { version, saved_at: Number(version), updated_at: d.updated_at, name: d.name, nodes: d.nodes.length, edges: d.edges.length } : null;
      })
      .filter((v): v is NonNullable<typeof v> => !!v)
      .sort((a, b) => b.saved_at - a.saved_at);
  }
  getVersion(id: string, version: string): SystemDoc | null {
    if (!/^\d+$/.test(version)) return null;
    return readJson<SystemDoc>(path.join(this.versionsDir(id), `${version}.json`));
  }
  /** Puts a version back. What was there is kept first, so a restore can be undone too. */
  restoreVersion(id: string, version: string): SystemDoc | null {
    const v = this.getVersion(id, version);
    if (!v) return null;
    const current = this.getSystem(id);
    if (current) this.snapshot(current, true);
    const doc = { ...v, id, updated_at: new Date().toISOString() };
    writeJson(path.join(this.systemsDir, `${safeId(id)}.json`), doc);
    return doc;
  }
  deleteSystem(id: string) {
    fs.rmSync(path.join(this.systemsDir, `${safeId(id)}.json`), { force: true });
    writeJson(this.deletedFile, { ...this.deletedSystems(), [safeId(id)]: new Date().toISOString() });
  }
  /** Ids of deleted systems and when, so every browser can drop its copy. */
  deletedSystems(): Record<string, string> {
    return readJson<Record<string, string>>(this.deletedFile) ?? {};
  }
  private get deletedFile() {
    return path.join(this.dataDir, "deleted-systems.json");
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
  putEval(rec: EvalRecord) {
    writeJson(path.join(this.evalsDir, `${safeId(rec.id)}.json`), rec);
  }
  getEval(id: string): EvalRecord | null {
    return readJson<EvalRecord>(path.join(this.evalsDir, `${safeId(id)}.json`));
  }
  listEvals(systemId?: string): EvalRecord[] {
    if (!fs.existsSync(this.evalsDir)) return [];
    return fs
      .readdirSync(this.evalsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<EvalRecord>(path.join(this.evalsDir, f)))
      .filter((r): r is EvalRecord => !!r && (!systemId || r.system_id === systemId))
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
  }
  // datasets ------------------------------------------------------------------
  putDataset(d: Dataset) {
    writeJson(path.join(this.dataDir, "datasets", `${safeId(d.id)}.json`), d);
  }
  getDataset(id: string): Dataset | null {
    return readJson<Dataset>(path.join(this.dataDir, "datasets", `${safeId(id)}.json`));
  }
  listDatasets(): Dataset[] {
    const dir = path.join(this.dataDir, "datasets");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<Dataset>(path.join(dir, f)))
      .filter((d): d is Dataset => !!d)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  deleteDataset(id: string) {
    fs.rmSync(path.join(this.dataDir, "datasets", `${safeId(id)}.json`), { force: true });
  }

  deleteEval(id: string) {
    fs.rmSync(path.join(this.evalsDir, `${safeId(id)}.json`), { force: true });
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
