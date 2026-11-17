import YAML from "yaml";
import { defaultAgent, defaultData, emptySystem } from "./defaults";
import type { AgentData, NodeData, NodeKind, SysEdge, SysNode, SystemDoc } from "./types";
import { SPEC_VERSION } from "./types";

// YAML form of a system (Spec v0 layout): one section per node kind, keyed by
// id, `connections` for edges, `layout` for canvas positions. The canvas and
// this text are two views of the same SystemDoc.

const SECTIONS: [NodeKind, string][] = [
  ["group", "groups"],
  ["agent", "agents"],
  ["human", "humans"],
  ["env", "envs"],
  ["store", "stores"],
  ["channel", "channels"],
];

/** Drop undefined keys (null and [] are meaningful values and stay). */
function strip<T extends object>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

export function toYamlObject(doc: SystemDoc) {
  const out: Record<string, unknown> = {
    spec_version: doc.spec_version,
    system: strip({ id: doc.id, name: doc.name, description: doc.description }),
    budget: strip(doc.budget),
    termination: doc.termination,
    models: Object.fromEntries(doc.models.map(({ id, ...m }) => [id, m])),
    tools: Object.fromEntries(doc.tools.map(({ id, ...t }) => [id, strip(t)])),
  };
  for (const [kind, section] of SECTIONS) {
    const nodes = doc.nodes.filter((n) => n.data.kind === kind);
    if (!nodes.length) continue;
    out[section] = Object.fromEntries(
      nodes.map((n) => {
        const { kind: _k, ...rest } = n.data as NodeData & Record<string, unknown>;
        void _k;
        const harness = "harness" in rest ? { harness: strip(rest.harness as object) } : {};
        return [n.id, strip({ ...rest, ...harness, group: n.parent })];
      }),
    );
  }
  out.connections = doc.edges.map(({ id, source, target, ...e }) => strip({ id, from: source, to: target, ...e }));
  out.policies = doc.policies;
  const canonical = SECTIONS.flatMap(([kind]) => doc.nodes.filter((n) => n.data.kind === kind));
  out.layout = Object.fromEntries(
    canonical.map((n) => [n.id, strip({ x: Math.round(n.position.x), y: Math.round(n.position.y), w: n.size?.width, h: n.size?.height })]),
  );
  return out;
}

export function toYaml(doc: SystemDoc): string {
  return YAML.stringify(toYamlObject(doc), { lineWidth: 0 });
}

export class YamlError extends Error {}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Parse YAML back into a SystemDoc. Missing fields take their defaults; unknown kinds are rejected. */
export function fromYaml(text: string, keepId?: string): SystemDoc {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    throw new YamlError(`YAML syntax error: ${(err as Error).message}`);
  }
  if (!isObj(raw)) throw new YamlError("The top level must be a mapping");
  const base = emptySystem();
  const sys = isObj(raw.system) ? raw.system : {};
  const doc: SystemDoc = {
    ...base,
    spec_version: String(raw.spec_version ?? SPEC_VERSION),
    id: keepId ?? String(sys.id ?? base.id),
    name: String(sys.name ?? base.name),
    description: String(sys.description ?? ""),
    budget: { usd: null, max_rounds: null, wallclock_min: null, ...(isObj(raw.budget) ? raw.budget : {}) } as SystemDoc["budget"],
    termination: Array.isArray(raw.termination) ? raw.termination.map(String) : base.termination,
    nodes: [],
    edges: [],
    policies: Array.isArray(raw.policies) ? (raw.policies as SystemDoc["policies"]) : [],
  };
  if (isObj(raw.models)) doc.models = Object.entries(raw.models).map(([id, m]) => ({ ...(m as object), id }) as SystemDoc["models"][number]);
  if (isObj(raw.tools)) doc.tools = Object.entries(raw.tools).map(([id, t]) => ({ ...(t as object), needs_env: (t as { needs_env?: unknown }).needs_env ?? null, id }) as SystemDoc["tools"][number]);

  const layout = isObj(raw.layout) ? raw.layout : {};
  const ids = new Set<string>();
  for (const [kind, section] of SECTIONS) {
    const entries = raw[section];
    if (entries == null) continue;
    if (!isObj(entries)) throw new YamlError(`${section} must be a mapping keyed by id`);
    for (const [id, value] of Object.entries(entries)) {
      if (ids.has(id)) throw new YamlError(`Duplicate node id: ${id}`);
      ids.add(id);
      const v = isObj(value) ? { ...value } : {};
      const parent = typeof v.group === "string" ? v.group : undefined;
      delete v.group;
      let data: NodeData;
      if (kind === "agent") {
        const d = defaultAgent(String(v.name ?? id));
        const h = isObj(v.harness) ? v.harness : {};
        if (h.tier && h.tier !== "native" && !("loop" in h)) delete d.harness.loop;
        data = {
          ...d,
          ...v,
          kind: "agent",
          harness: { ...d.harness, ...(isObj(v.harness) ? v.harness : {}), capabilities: { ...d.harness.capabilities, ...(isObj(v.harness) && isObj(v.harness.capabilities) ? v.harness.capabilities : {}) } },
          context: { ...d.context, ...(isObj(v.context) ? v.context : {}) },
        } as AgentData;
      } else {
        data = { ...defaultData(kind), ...v, kind } as NodeData;
      }
      const pos = isObj(layout[id]) ? (layout[id] as Record<string, number>) : {};
      const node: SysNode = { id, position: { x: Number(pos.x ?? 80 + doc.nodes.length * 40), y: Number(pos.y ?? 80 + doc.nodes.length * 30) }, data };
      if (parent) node.parent = parent;
      if (kind === "group") node.size = { width: Number(pos.w ?? 480), height: Number(pos.h ?? 320) };
      doc.nodes.push(node);
    }
  }
  for (const n of doc.nodes) {
    if (n.parent && !ids.has(n.parent)) throw new YamlError(`Node ${n.id} is in group ${n.parent}, which does not exist`);
  }
  if (raw.connections != null && !Array.isArray(raw.connections)) throw new YamlError("connections must be a list");
  let i = 0;
  for (const c of (raw.connections as unknown[]) ?? []) {
    if (!isObj(c)) continue;
    const { from, to, id, ...rest } = c;
    if (typeof from !== "string" || typeof to !== "string") throw new YamlError("Every connection needs from and to");
    if (!ids.has(from) || !ids.has(to)) throw new YamlError(`connection ${from} → ${to} points to a node that does not exist`);
    const kind = (rest.kind ?? "message") as SysEdge["kind"];
    if (!["message", "call", "handoff", "access"].includes(kind)) throw new YamlError(`Unknown connection kind: ${String(kind)}`);
    doc.edges.push({ ...(rest as object), id: typeof id === "string" ? id : `e${++i}_${Date.now() % 10000}`, source: from, target: to, kind } as SysEdge);
  }
  return doc;
}
