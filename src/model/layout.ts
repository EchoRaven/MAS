// A readable layout for a system: each canvas (the root, and each group's own
// canvas) is laid out on its own. Components that pass work along go left to
// right by how far they are from where the input arrives; envs, plugins and
// spawn templates sit in a row underneath, under the components that use them.
import { entryPoints, spawnTemplates } from "./entry";
import type { SystemDoc } from "./types";

const COL = 340;
const ROW = 150;
const RESOURCE_GAP = 300;

const isResource = (k: string) => k === "env" || k === "plugin";

function layoutScope(doc: SystemDoc, scope: string | undefined) {
  const nodes = doc.nodes.filter((n) => n.parent === scope);
  const ids = new Set(nodes.map((n) => n.id));
  const kind = new Map(nodes.map((n) => [n.id, n.data.kind]));
  const flow = doc.edges.filter((e) => e.kind !== "access" && ids.has(e.source) && ids.has(e.target));
  // spawn templates sit under the agent that spawns them, like resources under their users
  const templates = spawnTemplates(doc);
  const below = (n: { id: string; data: { kind: string } }) => isResource(n.data.kind) || templates.has(n.id);
  const actors = nodes.filter((n) => !below(n));
  if (!actors.length && !nodes.length) return;

  // roots: the entry first, then whatever nothing feeds, then (for cycles) the rest in order
  const fed = new Set(flow.map((e) => e.target));
  const entry = scope ? [] : entryPoints(doc).map((p) => p.node).filter((id) => ids.has(id) && !isResource(kind.get(id)!));
  const roots = [...new Set([...entry, ...actors.filter((n) => !fed.has(n.id)).map((n) => n.id)])];
  const col = new Map<string, number>();
  const visit = (starts: string[]) => {
    const queue = starts.filter((id) => !col.has(id));
    for (const id of queue) col.set(id, 0);
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of flow) {
        if (e.source !== id || col.has(e.target) || isResource(kind.get(e.target)!)) continue;
        col.set(e.target, col.get(id)! + 1);
        queue.push(e.target);
      }
    }
  };
  visit(roots);
  for (const n of actors) if (!col.has(n.id)) visit([n.id]);

  // stack each column, centred on y = 0, in the order the components were added
  const columns = new Map<number, string[]>();
  for (const n of actors) columns.set(col.get(n.id)!, [...(columns.get(col.get(n.id)!) ?? []), n.id]);
  const pos = new Map<string, { x: number; y: number }>();
  let bottom = 0;
  for (const [c, members] of columns) {
    members.forEach((id, i) => {
      const y = (i - (members.length - 1) / 2) * ROW;
      pos.set(id, { x: c * COL, y });
      bottom = Math.max(bottom, y);
    });
  }

  // resources: one row below, each under the mean x of what uses it, pushed apart
  const resources = nodes.filter(below);
  const want = resources.map((r) => {
    const spawners = doc.nodes.filter((n) => n.data.kind === "agent" && (n.data as { spawn?: { template?: string } }).spawn?.template === r.id).map((n) => pos.get(n.id));
    const users = [...doc.edges.filter((e) => e.kind === "access" && (e.target === r.id || e.source === r.id)).map((e) => pos.get(e.target === r.id ? e.source : e.target)), ...spawners].filter(Boolean) as { x: number }[];
    return { id: r.id, x: users.length ? users.reduce((s, p) => s + p.x, 0) / users.length : 0 };
  });
  want.sort((a, b) => a.x - b.x);
  let last = -Infinity;
  for (const w of want) {
    const x = Math.max(w.x, last + RESOURCE_GAP);
    pos.set(w.id, { x, y: bottom + ROW + 40 });
    last = x;
  }

  for (const n of nodes) n.position = pos.get(n.id) ?? n.position;
}

/** Lays out every canvas of the system in place, and returns it. */
export function autoLayout(doc: SystemDoc): SystemDoc {
  layoutScope(doc, undefined);
  for (const g of doc.nodes.filter((n) => n.data.kind === "group")) layoutScope(doc, g.id);
  return doc;
}
