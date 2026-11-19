// What is inside an env, for its panel on the canvas: a sandbox's files (a
// run's folder, the kept one, or one agent's), a database's tables and rows,
// an imported env's services. Read-only: nothing is created, written or run,
// paths stay inside the env's folder, databases open read-only.
import fs from "node:fs";
import path from "node:path";
import type { EnvData, SysNode } from "@/model/types";
import type { Router } from "../http";
import { confine } from "../runtime/resources/plugins/workspace";
import type { EnvPreviews } from "../runtime/preview";
import { HttpError, safeId, type Store } from "../store/files";

const MAX_FILES = 500;
const MAX_READ = 100_000;

function entries(root: string, dir = root, out: { path: string; size: number }[] = []): { path: string; size: number }[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FILES) break;
    const f = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) entries(root, f, out);
    else out.push({ path: path.relative(root, f), size: fs.statSync(f).size });
  }
  return out;
}

/** Subfolders, newest first (runs, agents). */
function children(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, t: fs.statSync(path.join(dir, e.name)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .map((e) => e.name);
}

export function envRoutes(r: Router, store: Store, dataDir: string, previews?: EnvPreviews) {
  const state = (...parts: string[]) => path.join(dataDir, "state", ...parts.map(safeId));

  // Try an env's tools: a preview session on a throwaway copy (an imported env: the real one, write tools confirmed)
  const fail = (e: unknown, status = 400): never => {
    throw new HttpError(status, (e as Error).message);
  };
  r.on("POST", "/api/systems/:id/envs/:env/preview", async (req) => {
    if (!previews) throw new HttpError(501, "Previews are not available on this server");
    const doc = store.getSystem(req.params.id);
    if (!doc) throw new HttpError(404, "No such system: save it first");
    let s;
    try {
      s = previews.open(doc, req.params.env);
    } catch (e) {
      return fail(e);
    }
    return { session: s.id, copy: s.copy, tools: await previews.tools(s).catch((e) => (void previews.close(s.id), fail(e))) };
  });
  r.on("POST", "/api/systems/:id/envs/:env/preview/:sid/call", async (req) => {
    if (!previews) throw new HttpError(501, "Previews are not available on this server");
    const b = ((await req.body()) ?? {}) as { tool?: string; args?: Record<string, unknown>; confirm?: boolean };
    let s;
    try {
      s = previews.get(req.params.sid, req.params.id, req.params.env);
    } catch (e) {
      return fail(e, 404);
    }
    const before = s.log.length;
    try {
      const out = await previews.call(s, String(b.tool ?? ""), b.args && typeof b.args === "object" ? b.args : {}, !!b.confirm);
      return { ...out, log: s.log.slice(before), usd: s.usd };
    } catch (e) {
      return fail(e, 409);
    }
  });
  r.on("DELETE", "/api/systems/:id/envs/:env/preview/:sid", async (req) => {
    await previews?.close(req.params.sid);
    return { ok: true };
  });

  r.on("GET", "/api/systems/:id/envs/:env/contents", async (req) => {
    const doc = store.getSystem(req.params.id);
    if (!doc) throw new HttpError(404, "No such system");
    const node = doc.nodes.find((n) => n.id === req.params.env && n.data.kind === "env") as SysNode<EnvData> | undefined;
    if (!node) throw new HttpError(404, "No such env in this system");
    const e = node.data;
    const q = req.query;

    if (e.manifest) {
      return { kind: "imported", manifest: { name: e.manifest.name, source: e.manifest.source, services: e.manifest.runtime.services, health: e.manifest.lifecycle.health, tools: e.manifest.exposes.mcp?.tools ?? [], http: e.manifest.exposes.http } };
    }

    if (e.env_kind === "sandbox") {
      // the folder the sandbox mounts at /work: a workspace plugin's /work, the kept folder, or each run's own
      const shared = doc.nodes.some((n) => n.data.kind === "plugin" && n.data.preset === "workspace" && n.data.spec.sources?.[0]?.replace(/\/+$/, "") === "/work");
      const runs = e.lifecycle === "per_run" && !shared ? children(state(doc.id, node.id, "runs")) : [];
      const run = q.get("run") ?? runs[0] ?? null;
      let root = shared ? state(doc.id, "fs", "work") : e.lifecycle === "per_run" ? (run ? state(doc.id, node.id, "runs", run) : null) : state(doc.id, node.id, "work");
      const agents = root && e.share === "per_agent" ? children(path.join(root, "agents")) : [];
      const agent = q.get("agent") ?? agents[0] ?? null;
      if (root && e.share === "per_agent" && agent) root = path.join(root, "agents", safeId(agent));
      const base = { kind: "files" as const, runs, run, agents, agent, lifecycle: e.lifecycle, share: e.share ?? "shared" };
      if (!root || !fs.existsSync(root)) return { ...base, files: [] };
      const file = q.get("path");
      if (file) {
        let f: string;
        try {
          f = confine(root, file);
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new HttpError(404, `No file ${file}`);
        const buf = fs.readFileSync(f).subarray(0, MAX_READ);
        const binary = buf.includes(0);
        return { ...base, file: { path: file, size: fs.statSync(f).size, binary, text: binary ? "" : buf.toString("utf8"), truncated: fs.statSync(f).size > MAX_READ } };
      }
      return { ...base, files: entries(root) };
    }

    if (e.env_kind === "database") {
      const img = e.image ?? "";
      const file = img.startsWith("sqlite:") ? path.resolve(img.slice(7)) : path.join(state(doc.id, node.id), "db.sqlite");
      if (!fs.existsSync(file)) return { kind: "database", tables: [], note: "No database file yet: it is created on first use" };
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
        const tables = names.map((name) => {
          const quoted = `"${name.replace(/"/g, '""')}"`;
          return { name, rows: Number((db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get() as { n: number }).n), columns: (db.prepare(`PRAGMA table_info(${quoted})`).all() as { name: string; type: string }[]).map((c) => `${c.name} ${c.type}`.trim()) };
        });
        const pick = q.get("table");
        const sample = pick && names.includes(pick) ? db.prepare(`SELECT * FROM "${pick.replace(/"/g, '""')}" LIMIT 50`).all() : null;
        return { kind: "database", tables, ...(sample ? { table: pick, sample } : {}) };
      } finally {
        db.close();
      }
    }

    return { kind: e.env_kind === "room" ? "room" : "none" };
  });
}
