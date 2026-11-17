// Builds SystemDocs in code: used by the pattern templates and the paper reproductions.
import { defaultAgent, defaultBinding, defaultData, defaultRoom, emptySystem, RUNNERS } from "./defaults";
import { interfaceOf, isResource } from "./ports";
import { defaultPlugin } from "./plugins";
import type { AgentData, EdgeKind, GroupData, NodeData, NodeKind, PluginPreset, PluginSpec, SchemaSpec, SysEdge, SystemDoc } from "./types";
import { RES_PORT } from "./types";

type Patch<D> = Partial<D> & Record<string, unknown>;

export class Builder {
  doc: SystemDoc;
  private n = 0;
  constructor(name: string, description: string) {
    this.doc = emptySystem(name);
    this.doc.description = description;
  }
  agent(id: string, x: number, y: number, patch: Patch<AgentData>, parent?: string) {
    const base = defaultAgent(String(patch.name ?? id));
    const harness = { ...base.harness, ...(patch.harness ?? {}) };
    const runner = RUNNERS.find((r) => r.id === harness.runner);
    if (runner) harness.capabilities = { ...runner.caps };
    const data: AgentData = { ...base, ...patch, harness } as AgentData;
    this.doc.nodes.push({ id, position: { x, y }, parent, data });
    return this;
  }
  node(id: string, kind: Exclude<NodeKind, "agent">, x: number, y: number, patch: Record<string, unknown> = {}, parent?: string) {
    const data = { ...defaultData(kind), ...patch } as NodeData;
    this.doc.nodes.push({ id, position: { x, y }, parent, data });
    return this;
  }
  room(id: string, x: number, y: number, name: string, room: Partial<NonNullable<ReturnType<typeof defaultRoom>["room"]>>, parent?: string) {
    const data = defaultRoom(name);
    data.room = { ...data.room!, ...room };
    this.doc.nodes.push({ id, position: { x, y }, parent, data });
    return this;
  }
  plugin(id: string, preset: PluginPreset, x: number, y: number, patch: { name?: string } & Partial<PluginSpec> = {}, parent?: string) {
    const d = defaultPlugin(preset);
    const { name, ...spec } = patch;
    this.doc.nodes.push({ id, position: { x, y }, parent, data: { ...d, name: name ?? d.name, spec: { ...d.spec, ...spec } } });
    return this;
  }
  group(id: string, x: number, y: number, patch: Partial<GroupData> & Record<string, unknown>, parent?: string) {
    const data = { ...defaultData("group"), ...patch } as NodeData;
    this.doc.nodes.push({ id, position: { x, y }, parent, data });
    return this;
  }
  schema(s: SchemaSpec) {
    this.doc.schemas.push(s);
    return this;
  }
  /** Ports default to the first output / input; inside a group its own ports are used. */
  edge(source: string, target: string, kind: EdgeKind, extra: Partial<SysEdge> = {}) {
    const find = (id: string) => this.doc.nodes.find((n) => n.id === id)!;
    const s = find(source);
    const t = find(target);
    let source_port = extra.source_port;
    let target_port = extra.target_port;
    if (kind === "access" || isResource(t.data.kind)) {
      source_port = RES_PORT;
      target_port = RES_PORT;
      kind = "access";
      const binding = defaultBinding(t.data);
      // a read-only edge never writes back
      if (extra.access === "read" && binding.write) binding.write = { when: "never" };
      extra = { binding, ...extra };
    } else {
      source_port ??= s.data.kind === "group" && t.parent === s.id ? interfaceOf(s.data).inputs[0].id : interfaceOf(s.data).outputs[0].id;
      target_port ??= t.data.kind === "group" && s.parent === t.id ? interfaceOf(t.data).outputs[0].id : interfaceOf(t.data).inputs[0].id;
    }
    this.doc.edges.push({ id: `e${++this.n}`, ...extra, source, target, kind, source_port, target_port });
    return this;
  }
}


export const native = () => defaultAgent().harness;

export interface PaperRef {
  title: string;
  authors: string;
  year: number;
  url: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  summary: string;
  build: () => SystemDoc;
  /** reproductions of published systems carry their source and how they were mapped */
  paper?: PaperRef;
  /** how the paper maps onto components, and where this reproduction departs from it */
  notes?: { mapped: string[]; differs: string[] };
}
