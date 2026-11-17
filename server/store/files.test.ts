// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { emptySystem } from "@/model/defaults";
import { Store } from "./files";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-store-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

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
});
