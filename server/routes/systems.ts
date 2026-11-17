// Systems: the server keeps the canonical copy; the browser caches it.
import type { SystemDoc } from "@/model/types";
import { migrateDoc } from "@/model/migrate";
import { validate } from "@/model/validate";
import { conformSystem } from "@/model/conformance";
import type { Router } from "../http";
import { HttpError, safeId, type Store } from "../store/files";

export function checkDoc(raw: unknown): SystemDoc {
  const d = raw as Partial<SystemDoc>;
  if (!d || typeof d !== "object" || typeof d.id !== "string" || !Array.isArray(d.nodes) || !Array.isArray(d.edges) || !Array.isArray(d.models)) throw new HttpError(400, "Not a system document");
  safeId(d.id);
  return migrateDoc(d as SystemDoc);
}

export function systemRoutes(r: Router, store: Store) {
  r.on("GET", "/api/systems", () => ({ systems: store.listSystems(), deleted: store.deletedSystems() }));
  r.on("GET", "/api/systems/:id", (req) => {
    const d = store.getSystem(req.params.id);
    if (!d) throw new HttpError(404, "No such system");
    return d;
  });
  r.on("PUT", "/api/systems/:id", async (req) => {
    const doc = checkDoc(await req.body());
    if (doc.id !== req.params.id) throw new HttpError(400, "id in the path and the body differ");
    if (!store.putSystem(doc)) return { ok: false, deleted: true };
    return { ok: true, updated_at: doc.updated_at };
  });
  r.on("DELETE", "/api/systems/:id", (req) => {
    store.deleteSystem(req.params.id);
    return { ok: true };
  });
  // earlier versions of a system, and putting one back
  r.on("GET", "/api/systems/:id/versions", (req) => ({ versions: store.listVersions(req.params.id) }));
  r.on("GET", "/api/systems/:id/versions/:version", (req) => {
    const d = store.getVersion(req.params.id, req.params.version);
    if (!d) throw new HttpError(404, "No such version");
    return d;
  });
  r.on("POST", "/api/systems/:id/versions/:version/restore", (req) => {
    const d = store.restoreVersion(req.params.id, req.params.version);
    if (!d) throw new HttpError(404, "No such version");
    return d;
  });
  r.on("POST", "/api/validate", async (req) => {
    const doc = checkDoc(await req.body());
    return { issues: validate(doc), conformance: conformSystem(doc).filter((c) => !c.report.passed) };
  });
}
