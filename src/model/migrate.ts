// Bring any stored or imported document up to the current spec (0.2):
// - Room nodes (kind "channel") become envs with env_kind "room"; their edges become access edges
// - every component gets an interface, agents a pipeline
// - groups lose entry / output_from / size: that wiring becomes edges on the group's own ports
// - edges get explicit ports; edges that crossed a group boundary are routed through its ports
import { DEFAULT_MODELS, defaultAgent, defaultBinding, defaultData } from "./defaults";
import { defaultInterface, edgeScope, interfaceOf, isResource, usesResources } from "./ports";
import { defaultPlugin } from "./plugins";
import type { EnvData, NodeData, PluginPreset, PluginSpec, SysEdge, SysNode, SystemDoc } from "./types";
import { RES_PORT, SPEC_VERSION } from "./types";

type Loose = Record<string, unknown>;

export function migrateDoc(input: SystemDoc): SystemDoc {
  const doc = structuredClone(input) as SystemDoc & Loose;
  doc.schemas ??= [];
  const KEY_ENV: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GEMINI_API_KEY" };
  doc.models = doc.models.map((m) => (m.api ? m : { ...m, api: DEFAULT_MODELS.find((x) => x.id === m.id)?.api ?? (KEY_ENV[m.provider] ? { key_env: KEY_ENV[m.provider] } : {}) }));
  // 0.1 kept memory/knowledge bindings on the agent; they now live on the access edge
  const legacySources: { agent: string; store: string; mode: "tool" | "auto_inject" | "pinned"; top_k?: number }[] = [];
  const groupWiring: { group: string; entry?: string; output_from?: string }[] = [];

  doc.nodes = doc.nodes.map((n) => {
    const d = n.data as NodeData & Loose;
    const node = { ...n } as SysNode & Loose;
    delete node.size;
    if ((d.kind as string) === "store") {
      const preset = (["memory", "knowledge", "board"].includes(String(d.store_kind)) ? d.store_kind : "custom") as PluginPreset;
      const p = defaultPlugin(preset);
      const backend = String(d.backend ?? "builtin");
      p.name = String(d.name ?? p.name);
      p.spec.scope = (d.scope as PluginSpec["scope"]) ?? p.spec.scope;
      if (backend === "mcp" || backend === "http") p.spec.backend = { kind: backend };
      else if (backend === "pgvector" || backend === "qdrant") p.spec.storage = backend;
      if (Array.isArray(d.sources) && d.sources.length) p.spec.sources = d.sources.map(String);
      if (d.write === "none") p.spec.hooks = { ...p.spec.hooks, after_turn: null };
      return { ...node, data: p };
    }
    if ((d.kind as string) === "channel") {
      const env: EnvData = {
        kind: "env",
        name: String(d.name ?? "room"),
        env_kind: "room",
        image: "",
        lifecycle: "per_run",
        snapshot: "never",
        egress: [],
        room: { policy: (d.policy as never) ?? "free", selector: d.selector as string | undefined, history: (d.history as never) ?? "persistent" },
      };
      if (!env.room!.selector) delete env.room!.selector;
      return { ...node, data: env };
    }
    switch (d.kind) {
      case "agent": {
        const base = defaultAgent(String(d.name ?? n.id));
        const ctx = { ...base.context, ...((d.context as object) ?? {}) } as Loose;
        for (const src of (ctx.sources as typeof legacySources | undefined) ?? []) legacySources.push({ ...src, agent: n.id });
        delete ctx.sources;
        return { ...node, data: { ...base, ...d, context: ctx, interface: d.interface ?? base.interface, pipeline: d.pipeline ?? base.pipeline } as unknown as NodeData };
      }
      case "group": {
        const { entry, output_from, ...rest } = d as Loose;
        if (entry || output_from) groupWiring.push({ group: n.id, entry: entry as string, output_from: output_from as string });
        return { ...node, data: { ...defaultData("group"), ...rest, interface: (rest.interface as never) ?? defaultInterface("group") } as NodeData };
      }
      case "plugin":
        return { ...node, data: { ...defaultPlugin((d.preset as never) ?? "custom"), ...d } as NodeData };
      case "model":
      case "function":
        return { ...node, data: { ...defaultData(d.kind), ...d } as NodeData };
      case "env": {
        const e = { ...defaultData("env"), ...d } as EnvData;
        if (e.env_kind === "room" && !e.room) e.room = { policy: "free", history: "persistent" };
        return { ...node, data: e };
      }
      default:
        return node;
    }
  });

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const kind = (id: string) => byId.get(id)?.data.kind;
  const firstOut = (id: string) => { const n = byId.get(id); return n ? interfaceOf(n.data).outputs[0]?.id : undefined; };
  const firstIn = (id: string) => { const n = byId.get(id); return n ? interfaceOf(n.data).inputs[0]?.id : undefined; };
  let k = 0;
  const nid = () => `m${++k}_${doc.edges.length}`;

  const edges: SysEdge[] = [];
  for (const raw of doc.edges as (SysEdge & Loose)[]) {
    const e = { ...raw } as SysEdge & Loose;
    delete e.schema;
    if (e.bend) e.points = [e.bend as { x: number; y: number }];
    delete e.bend;
    const s = kind(e.source);
    const t = kind(e.target);
    if (!s || !t) { edges.push(e); continue; }
    // anything touching an env or store (rooms included) is an access edge from its user
    if (isResource(s) || isResource(t)) {
      if (e.kind === "access" && e.source_port === RES_PORT && e.target_port === RES_PORT && usesResources(s)) { edges.push(e); continue; }
      let source = e.source;
      let target = e.target;
      if (isResource(s) && !isResource(t)) [source, target] = [target, source];
      if (!usesResources(kind(source)!)) { continue; }
      const dup = edges.some((x) => x.kind === "access" && x.source === source && x.target === target);
      if (dup) continue;
      edges.push({ ...e, source, target, kind: "access", access: e.access ?? "read_write", source_port: RES_PORT, target_port: RES_PORT });
      continue;
    }
    e.source_port ??= firstOut(e.source) ?? "out";
    e.target_port ??= firstIn(e.target) ?? "in";
    edges.push(e);
  }

  // edges whose ends sit in different scopes: route them through group ports
  const parentOf = (id: string) => byId.get(id)?.parent;
  const out: SysEdge[] = [];
  for (const e of edges) {
    if (e.kind === "access" || edgeScope(doc, e) !== null) { out.push(e); continue; }
    const ps = parentOf(e.source);
    const pt = parentOf(e.target);
    if (ps === pt) { out.push(e); continue; }
    if (pt && byId.get(pt)?.data.kind === "group" && ps === parentOf(pt)) {
      // outside -> member: outside -> group.in, group.in -> member
      const gIn = firstIn(pt) ?? "in";
      out.push({ ...e, target: pt, target_port: gIn });
      out.push({ id: nid(), source: pt, source_port: gIn, target: e.target, target_port: e.target_port, kind: e.kind });
    } else if (ps && byId.get(ps)?.data.kind === "group" && pt === parentOf(ps)) {
      // member -> outside: member -> group.out, group.out -> outside
      const gOut = firstOut(ps) ?? "out";
      out.push({ id: nid(), source: e.source, source_port: e.source_port, target: ps, target_port: gOut, kind: e.kind });
      out.push({ ...e, source: ps, source_port: gOut });
    } else {
      out.push(e); // left for the validator to flag
    }
  }

  for (const w of groupWiring) {
    const gIn = firstIn(w.group) ?? "in";
    const gOut = firstOut(w.group) ?? "out";
    if (w.entry && byId.has(w.entry) && !out.some((e) => e.source === w.group && e.source_port === gIn)) {
      out.push({ id: nid(), source: w.group, source_port: gIn, target: w.entry, target_port: firstIn(w.entry) ?? "in", kind: "message" });
    }
    if (w.output_from && byId.has(w.output_from) && !out.some((e) => e.target === w.group && e.target_port === gOut)) {
      out.push({ id: nid(), source: w.output_from, source_port: firstOut(w.output_from) ?? "out", target: w.group, target_port: gOut, kind: "message" });
    }
  }
  for (const src of legacySources) {
    const e = out.find((x) => x.kind === "access" && x.source === src.agent && x.target === src.store);
    const binding = { ...defaultBinding(byId.get(src.store)?.data ?? defaultData("plugin")), mode: src.mode };
    if (src.top_k) binding.read = { ...(binding.read ?? {}), top_k: src.top_k };
    if (e) e.binding = binding;
    else if (byId.has(src.store)) out.push({ id: nid(), source: src.agent, source_port: RES_PORT, target: src.store, target_port: RES_PORT, kind: "access", access: "read", binding });
  }
  for (const e of out) if (e.kind === "access" && e.binding === undefined && byId.has(e.target)) e.binding = defaultBinding(byId.get(e.target)!.data);
  doc.edges = out;
  doc.spec_version = SPEC_VERSION;
  return doc;
}
