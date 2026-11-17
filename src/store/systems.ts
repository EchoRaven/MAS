import { create } from "zustand";
import { TEMPLATES } from "@/model/templates";
import { newId } from "@/model/defaults";
import type { SystemDoc } from "@/model/types";

// Systems live in this browser (v0 has no backend). Every read and write of
// localStorage is guarded: private windows and blocked storage fall back to memory.
const KEY = "mas-systems-v0";

function load(): SystemDoc[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SystemDoc[]) : null;
  } catch {
    return null;
  }
}

function save(systems: SystemDoc[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(systems));
  } catch {
    /* storage unavailable: keep in memory */
  }
}

function seed(): SystemDoc[] {
  return TEMPLATES.filter((t) => t.id !== "blank").map((t) => t.build());
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
}

export const useSystems = create<SystemsState>((set, get) => {
  const commit = (systems: SystemDoc[]) => {
    save(systems);
    set({ systems });
  };
  return {
    systems: load() ?? seed(),
    get: (id) => get().systems.find((s) => s.id === id),
    create: (templateId) => {
      const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
      const doc = { ...tpl.build(), id: newId("sys"), updated_at: new Date().toISOString() };
      commit([doc, ...get().systems]);
      return doc;
    },
    importDoc: (doc) => {
      const copy = { ...doc, id: get().systems.some((s) => s.id === doc.id) ? newId("sys") : doc.id, updated_at: new Date().toISOString() };
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
      copy.name = `${src.name}（副本）`;
      copy.updated_at = new Date().toISOString();
      commit([copy, ...get().systems]);
      return copy;
    },
    remove: (id) => commit(get().systems.filter((s) => s.id !== id)),
  };
});
