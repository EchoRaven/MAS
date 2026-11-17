import YAML from "yaml";
import { defaultAgent, defaultData, emptySystem } from "./defaults";
import { migrateDoc } from "./migrate";
import { interfaceOf, isResource } from "./ports";
import type { AgentData, NodeData, NodeKind, SysEdge, SysNode, SystemDoc } from "./types";
import { RES_PORT, SPEC_VERSION } from "./types";

// YAML form of a system (Spec 0.2): one section per component kind, keyed by
// id, `connections` for edges (endpoints written as node.port), `layout` for
// canvas positions. The canvas and this text are two views of the same SystemDoc.

const SECTIONS: [NodeKind, string][] = [
  ["group", "groups"],
  ["agent", "agents"],
  ["model", "model_calls"],
  ["function", "functions"],
  ["human", "humans"],
  ["env", "envs"],
  ["plugin", "plugins"],
];
/** read-only: 0.1 files had rooms as their own section */
const LEGACY_SECTIONS: [string, string][] = [["channel", "channels"], ["store", "stores"]];

const endpoint = (node: string, p: string) => (p === RES_PORT ? node : `${node}.${p}`);

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
    ...(doc.entry ? { entry: strip(doc.entry) } : {}),
    termination: doc.termination,
    models: Object.fromEntries(doc.models.map(({ id, ...m }) => [id, m])),
    tools: Object.fromEntries(doc.tools.map(({ id, ...t }) => [id, strip(t)])),
    schemas: Object.fromEntries(doc.schemas.map(({ id, ...x }) => [id, x])),
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
  out.connections = doc.edges.map(({ id, source, target, source_port, target_port, ...e }) =>
    strip({ id, from: endpoint(source, source_port), to: endpoint(target, target_port), ...e }),
  );
  out.policies = doc.policies;
  const canonical = SECTIONS.flatMap(([kind]) => doc.nodes.filter((n) => n.data.kind === kind));
  out.layout = Object.fromEntries(
    canonical.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]),
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
    entry: isObj(raw.entry) && typeof raw.entry.node === "string" ? { node: raw.entry.node, ...(typeof raw.entry.port === "string" ? { port: raw.entry.port } : {}) } : null,
    termination: Array.isArray(raw.termination) ? raw.termination.map(String) : base.termination,
    nodes: [],
    edges: [],
    policies: Array.isArray(raw.policies) ? (raw.policies as SystemDoc["policies"]) : [],
  };
  if (isObj(raw.models)) doc.models = Object.entries(raw.models).map(([id, m]) => ({ ...(m as object), id }) as SystemDoc["models"][number]);
  if (isObj(raw.schemas)) doc.schemas = Object.entries(raw.schemas).map(([id, x]) => ({ description: "", json_schema: "{}", ...(x as object), id }));
  if (isObj(raw.tools)) doc.tools = Object.entries(raw.tools).map(([id, t]) => ({ ...(t as object), needs_env: (t as { needs_env?: unknown }).needs_env ?? null, id }) as SystemDoc["tools"][number]);

  const layout = isObj(raw.layout) ? raw.layout : {};
  const ids = new Set<string>();
  for (const [kind, section] of [...SECTIONS, ...LEGACY_SECTIONS] as [NodeKind, string][]) {
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
      } else if ((kind as string) === "channel" || (kind as string) === "store") {
        data = { ...v, kind } as unknown as NodeData; // migrated below
      } else {
        data = { ...defaultData(kind), ...v, kind } as NodeData;
      }
      const pos = isObj(layout[id]) ? (layout[id] as Record<string, number>) : {};
      const node: SysNode = { id, position: { x: Number(pos.x ?? 80 + doc.nodes.length * 40), y: Number(pos.y ?? 80 + doc.nodes.length * 30) }, data };
      if (parent) node.parent = parent;
      doc.nodes.push(node);
    }
  }
  for (const n of doc.nodes) {
    if (n.parent && !ids.has(n.parent)) throw new YamlError(`Node ${n.id} is in group ${n.parent}, which does not exist`);
  }
  if (raw.connections != null && !Array.isArray(raw.connections)) throw new YamlError("connections must be a list");
  let i = 0;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const split = (v: string) => {
    const dot = v.indexOf(".");
    return dot < 0 ? { node: v, port: undefined } : { node: v.slice(0, dot), port: v.slice(dot + 1) };
  };
  for (const c of (raw.connections as unknown[]) ?? []) {
    if (!isObj(c)) continue;
    const { from, to, id, ...rest } = c;
    if (typeof from !== "string" || typeof to !== "string") throw new YamlError("Every connection needs from and to");
    const a = split(from);
    const z = split(to);
    if (!ids.has(a.node) || !ids.has(z.node)) throw new YamlError(`connection ${from} → ${to} points to a node that does not exist`);
    let kind = (rest.kind ?? "message") as SysEdge["kind"];
    if (!["message", "call", "handoff", "access"].includes(kind)) throw new YamlError(`Unknown connection kind: ${String(kind)}`);
    const s = byId.get(a.node)!;
    const t = byId.get(z.node)!;
    const legacy = (s.data.kind as string) === "channel" || (t.data.kind as string) === "channel";
    let source_port = a.port;
    let target_port = z.port;
    if (!legacy) {
      if (kind === "access" || isResource(t.data.kind)) {
        kind = "access";
        source_port ??= RES_PORT;
        target_port ??= RES_PORT;
      } else {
        source_port ??= s.data.kind === "group" && t.parent === s.id ? interfaceOf(s.data).inputs[0]?.id : interfaceOf(s.data).outputs[0]?.id;
        target_port ??= t.data.kind === "group" && s.parent === t.id ? interfaceOf(t.data).outputs[0]?.id : interfaceOf(t.data).inputs[0]?.id;
        if (!source_port || !target_port) throw new YamlError(`connection ${from} → ${to}: name the port (node.port); this component has no default port`);
      }
    }
    const e = { ...(rest as object), id: typeof id === "string" ? id : `e${++i}_${Date.now() % 10000}`, source: a.node, target: z.node, kind } as SysEdge;
    if (source_port) e.source_port = source_port;
    if (target_port) e.target_port = target_port;
    doc.edges.push(e);
  }
  return migrateDoc(doc);
}
