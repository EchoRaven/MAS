import { describe, expect, it } from "vitest";
import { migrateDoc } from "./migrate";
import { buildSeed, contentHash, refreshSeeds, SEED_TEMPLATES } from "./templates";

describe("seeded systems follow their templates", () => {
  const t = SEED_TEMPLATES.find((x) => x.id === "paper-debate")!;

  it("a seed records its template and a hash of what was seeded", () => {
    const d = buildSeed(t);
    expect(d.seed).toEqual({ template: "paper-debate", hash: contentHash(d) });
    // the hash ignores the id and the timestamp
    expect(contentHash({ ...d, id: "other", updated_at: "x" })).toBe(d.seed!.hash);
  });

  it("an unedited copy of an older template is rebuilt; an edited one is kept; a current one is untouched", () => {
    const current = buildSeed(t);
    // an older template: the copy as it was seeded then, never edited since
    const oldDoc = { ...current, description: "an older description" };
    const old = { ...oldDoc, seed: { template: t.id, hash: contentHash(oldDoc) } };
    // the same old copy, then edited by its owner
    const edited = { ...old, name: "My debate" };
    const out = refreshSeeds([old, edited, current]);
    expect(out[0].description).toBe(current.description);
    expect(out[0].seed!.hash).toBe(current.seed!.hash);
    expect(out[1]).toBe(edited);
    expect(out[2]).toBe(current);
    // nothing to do: the same array back
    const same = [current];
    expect(refreshSeeds(same)).toBe(same);
  });

  it("loading (a JSON round trip, then migration) does not make a fresh seed look edited", () => {
    for (const x of SEED_TEMPLATES) {
      const d = buildSeed(x);
      expect(contentHash(migrateDoc(JSON.parse(JSON.stringify(d)))), x.id).toBe(d.seed!.hash);
    }
  });
});
