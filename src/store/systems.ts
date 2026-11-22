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
  /** undo / redo of edits to one system (update and replace); a burst of edits within 600 ms is one step */
  undo: (id: string) => void;
  redo: (id: string) => void;
  canUndo: (id: string) => boolean;
  canRedo: (id: string) => boolean;
  /** bumped whenever a history changes, so undo and redo buttons re-render */
  historyTick: number;
}

/** Edits within this many milliseconds of the last recorded one join it (a drag is one step, not fifty). */
export const HISTORY_COALESCE_MS = 600;
const HISTORY_LIMIT = 100;

export const useSystems = create<SystemsState>((set, get) => {
  const commit = (systems: SystemDoc[]) => {
    save(systems);
    set({ systems });
  };
  // per system: earlier versions to undo to, later ones to redo to, and when the last step was recorded
  const history = new Map<string, { past: SystemDoc[]; future: SystemDoc[]; at: number }>();
  const tick = () => set({ historyTick: get().historyTick + 1 });
  const record = (prev: SystemDoc | undefined) => {
    if (!prev) return;
    const h = history.get(prev.id) ?? { past: [], future: [], at: 0 };
    const now = Date.now();
    if (now - h.at > HISTORY_COALESCE_MS || !h.past.length) {
      h.past.push(prev);
      if (h.past.length > HISTORY_LIMIT) h.past.shift();
    }
    h.at = now;
    h.future = [];
    history.set(prev.id, h);
    tick();
  };
  const restore = (id: string, from: "past" | "future") => {
    const h = history.get(id);
    const cur = get().get(id);
    const target = h?.[from].pop();
    if (!h || !cur || !target) return;
    (from === "past" ? h.future : h.past).push(cur);
    h.at = 0; // the next edit starts a new step
    commit(get().systems.map((s) => (s.id === id ? { ...target, updated_at: new Date().toISOString() } : s)));
    tick();
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
      record(get().get(id));
      commit(get().systems.map((s) => (s.id === id ? { ...fn(s), updated_at: new Date().toISOString() } : s)));
    },
    replace: (doc) => {
      record(get().get(doc.id));
      commit(get().systems.map((s) => (s.id === doc.id ? { ...doc, updated_at: new Date().toISOString() } : s)));
    },
    undo: (id) => restore(id, "past"),
    redo: (id) => restore(id, "future"),
    canUndo: (id) => !!history.get(id)?.past.length,
    canRedo: (id) => !!history.get(id)?.future.length,
    historyTick: 0,
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
