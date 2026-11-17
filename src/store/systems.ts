import { create } from "zustand";
import { buildSeed, LEGACY_SEED_NAMES, refreshSeeds, SEED_TEMPLATES, seedId, TEMPLATES } from "@/model/templates";
import { newId } from "@/model/defaults";
import { migrateDoc } from "@/model/migrate";
import type { SystemDoc } from "@/model/types";

// Systems live in this browser and, once a server is connected, on the server
// too (store/sync.ts keeps both in step). Every read and write of
// localStorage is guarded: private windows and blocked storage fall back to memory.
// Spec 0.2 storage. A 0.1 store (mas-systems-v0) is read once and migrated;
// the old key is left in place untouched.
const KEY = "mas-systems-v1";
const LEGACY_KEY = "mas-systems-v0";
/** Templates already seeded here, so one added later arrives and a deleted one stays deleted. */
const SEEDED_KEY = "mas-seeded-v1";

function read(key: string): SystemDoc[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SystemDoc[]) : null;
  } catch {
    return null;
  }
}

function load(): SystemDoc[] | null {
  const current = read(KEY);
  if (current) return current.map(migrateDoc);
  const legacy = read(LEGACY_KEY);
  if (!legacy) return null;
  // seeded copies of the old templates are replaced by the current ones; systems the user made are migrated
  const own = legacy.filter((d) => !LEGACY_SEED_NAMES.includes(d.name)).map(migrateDoc);
  const docs = [...own, ...seed()];
  save(docs);
  return docs;
}

function seededIds(): string[] {
  try {
    const raw = localStorage.getItem(SEEDED_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function markSeeded(ids: string[]) {
  try {
    localStorage.setItem(SEEDED_KEY, JSON.stringify([...new Set([...seededIds(), ...ids])]));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Templates added since this workspace was seeded (new paper reproductions,
 * say) are seeded now. One the person deleted is not brought back: every
 * template ever seeded is remembered, whether or not its system still exists.
 */
function seedNew(docs: SystemDoc[]): SystemDoc[] {
  const known = new Set([...seededIds(), ...docs.map((d) => d.id)]);
  const missing = SEED_TEMPLATES.filter((t) => !known.has(seedId(t.id)));
  markSeeded(SEED_TEMPLATES.map((t) => seedId(t.id)));
  if (!missing.length) return docs;
  const added = [...missing.map(buildSeed), ...docs];
  save(added);
  return added;
}

function save(systems: SystemDoc[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(systems));
  } catch {
    /* storage unavailable: keep in memory */
  }
}

/** First visit: seed every template. Later visits: seed the ones added since. */
function loadOrSeed(): SystemDoc[] {
  const loaded = load();
  if (loaded) {
    const docs = refreshSeeds(seedNew(loaded));
    if (docs !== loaded) save(docs);
    return docs;
  }
  const docs = seed();
  save(docs);
  markSeeded(SEED_TEMPLATES.map((t) => seedId(t.id)));
  return docs;
}

function seed(): SystemDoc[] {
  return SEED_TEMPLATES.map(buildSeed);
}

interface SystemsState {
  systems: SystemDoc[];
  get: (id: string) => SystemDoc | undefined;
  create: (templateId: string) => SystemDoc;
  importDoc: (doc: SystemDoc) => SystemDoc;
  update: (id: string, fn: (doc: SystemDoc) => SystemDoc) => void;
  replace: (doc: SystemDoc) => void;
  duplicate: (id: string) => SystemDoc | undefined;
  remove: (id: string) => void;
  /** replace the whole list (server sync) */
  setAll: (systems: SystemDoc[]) => void;
}

export const useSystems = create<SystemsState>((set, get) => {
  const commit = (systems: SystemDoc[]) => {
    save(systems);
    set({ systems });
  };
  return {
    systems: loadOrSeed(),
    get: (id) => get().systems.find((s) => s.id === id),
    create: (templateId) => {
      const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
      const doc = { ...tpl.build(), id: newId("sys"), updated_at: new Date().toISOString() };
      commit([doc, ...get().systems]);
      return doc;
    },
    importDoc: (doc) => {
      const copy = { ...migrateDoc(doc), id: get().systems.some((s) => s.id === doc.id) ? newId("sys") : doc.id, updated_at: new Date().toISOString() };
      commit([copy, ...get().systems]);
      return copy;
    },
    update: (id, fn) => {
      commit(get().systems.map((s) => (s.id === id ? { ...fn(s), updated_at: new Date().toISOString() } : s)));
    },
    replace: (doc) => {
      commit(get().systems.map((s) => (s.id === doc.id ? { ...doc, updated_at: new Date().toISOString() } : s)));
    },
    duplicate: (id) => {
      const src = get().get(id);
      if (!src) return undefined;
      const copy: SystemDoc = JSON.parse(JSON.stringify(src));
      copy.id = newId("sys");
      copy.name = `${src.name} (copy)`;
      copy.updated_at = new Date().toISOString();
      commit([copy, ...get().systems]);
      return copy;
    },
    remove: (id) => commit(get().systems.filter((s) => s.id !== id)),
    setAll: (systems) => commit(refreshSeeds(systems.map(migrateDoc))),
  };
});
