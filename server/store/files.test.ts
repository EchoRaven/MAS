// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { emptySystem } from "@/model/defaults";
import { buildSeed, SEED_TEMPLATES } from "@/model/templates";
import { Store } from "./files";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-store-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("versions of a system", () => {
  it("keeps the old copy when a save changes it, at most one every few minutes, and restores one", () => {
    const store = new Store(fs.mkdtempSync(path.join(dir, "v-")));
    const v1 = { ...emptySystem("First"), id: "sys_v", updated_at: "2026-11-17T10:00:00.000Z" };
    store.putSystem(v1);
    expect(store.listVersions("sys_v")).toEqual([]);
    // the same content saved again: nothing to keep
    store.putSystem({ ...v1, updated_at: "2026-11-17T10:00:01.000Z" });
    expect(store.listVersions("sys_v")).toEqual([]);
    store.putSystem({ ...v1, name: "Second", updated_at: "2026-11-17T10:01:00.000Z" });
    expect(store.listVersions("sys_v").map((v) => v.name)).toEqual(["First"]);
    // a moment later, another edit: no second version yet
    store.putSystem({ ...v1, name: "Third", updated_at: "2026-11-17T10:02:00.000Z" });
    expect(store.listVersions("sys_v").length).toBe(1);
    // restoring "First" keeps "Third" as a version, so the restore can be undone
    const first = store.listVersions("sys_v")[0];
    const restored = store.restoreVersion("sys_v", first.version)!;
    expect(restored.name).toBe("First");
    expect(store.getSystem("sys_v")!.name).toBe("First");
    expect(store.listVersions("sys_v").map((v) => v.name)).toEqual(["Third", "First"]);
    expect(store.getVersion("sys_v", "../../token")).toBeNull();
  });
});

describe("deleting a system", () => {
  it("is remembered, so a stale copy cannot bring it back, but a newer edit can", () => {
    const store = new Store(dir);
    const doc = { ...emptySystem(), id: "sys_gone", updated_at: "2026-11-17T10:00:00.000Z" };
    expect(store.putSystem(doc)).toBe(true);
    store.deleteSystem("sys_gone");
    expect(store.getSystem("sys_gone")).toBeNull();
    expect(Object.keys(store.deletedSystems())).toEqual(["sys_gone"]);
    // a browser that has not heard of the deletion pushes its old copy: refused
    expect(store.putSystem(doc)).toBe(false);
    expect(store.getSystem("sys_gone")).toBeNull();
    // someone edits it after the deletion: kept, and no longer counted as deleted
    expect(store.putSystem({ ...doc, updated_at: new Date(Date.now() + 1000).toISOString() })).toBe(true);
    expect(store.getSystem("sys_gone")).not.toBeNull();
    expect(store.deletedSystems()).toEqual({});
  });

  it("a deleted seeded system stays deleted, though a fresh browser builds it with today's date", () => {
    const store = new Store(fs.mkdtempSync(path.join(dir, "s-")));
    const t = SEED_TEMPLATES.find((x) => x.id === "paper-debate")!;
    store.putSystem(buildSeed(t));
    store.deleteSystem("sys_paper_debate");
    // a browser that never saw it seeds it now, newer than the deletion, and pushes it
    expect(store.putSystem({ ...buildSeed(t), updated_at: new Date(Date.now() + 5000).toISOString() })).toBe(false);
    expect(store.getSystem("sys_paper_debate")).toBeNull();
    // but a copy someone edited after the deletion is theirs, and is kept
    const edited = { ...buildSeed(t), name: "My debate", updated_at: new Date(Date.now() + 5000).toISOString() };
    expect(store.putSystem(edited)).toBe(true);
  });
});
