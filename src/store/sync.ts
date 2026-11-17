// Keeps the browser's systems and the server's in step once connected:
// on connect, newer copies win in both directions; afterwards every change is
// pushed (debounced) and deletions are mirrored.
import { Api } from "@/api/client";
import type { SystemDoc } from "@/model/types";
import { useServer } from "./server";
import { useSystems } from "./systems";

let synced = new Map<string, string>(); // id -> updated_at last known on the server
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;

async function pull() {
  const { systems: remote, deleted = {} } = await Api.systems();
  // a system deleted on the server goes here too, unless it was changed here after the deletion
  const local = useSystems.getState().systems.filter((d) => !(deleted[d.id] && d.updated_at <= deleted[d.id]));
  const byId = new Map(local.map((d) => [d.id, d]));
  const merged: SystemDoc[] = [...local];
  synced = new Map(remote.map((d) => [d.id, d.updated_at]));
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l) merged.push(r);
    else if (r.updated_at > l.updated_at) merged[merged.indexOf(l)] = r;
  }
  useSystems.getState().setAll(merged.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
  await push();
}

async function push() {
  const docs = useSystems.getState().systems;
  const ids = new Set(docs.map((d) => d.id));
  for (const d of docs) {
    if (synced.get(d.id) === d.updated_at) continue;
    try {
      await Api.putSystem(d);
      synced.set(d.id, d.updated_at);
    } catch {
      /* retried on the next change */
    }
  }
  for (const id of [...synced.keys()]) {
    if (ids.has(id)) continue;
    try {
      await Api.deleteSystem(id);
      synced.delete(id);
    } catch {
      /* retried on the next change */
    }
  }
}

/** Start syncing; safe to call more than once. */
export function startSync() {
  if (started) return;
  started = true;
  const onStatus = (status: string) => {
    if (status === "connected") void pull().catch(() => undefined);
  };
  useServer.subscribe((s, prev) => s.status !== prev.status && onStatus(s.status));
  onStatus(useServer.getState().status);
  useSystems.subscribe((s, prev) => {
    if (s.systems === prev.systems || useServer.getState().status !== "connected") return;
    clearTimeout(timer);
    timer = setTimeout(() => void push(), 800);
  });
}
