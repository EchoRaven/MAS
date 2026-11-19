// Interfaces, scopes and type compatibility: the rules every edge obeys.
import type { DataType, Interface, NodeData, NodeKind, PortSpec, SysEdge, SysNode, SystemDoc } from "./types";
import { RES_PORT } from "./types";

export const port = (id: string, type: DataType, extra: Partial<PortSpec> = {}): PortSpec => ({ id, type, ...extra });

export const DATA_TYPES: { value: DataType; label: string; hint: string }[] = [
  { value: "message", label: "message", hint: "Chat message: role + text / image / file parts" },
  { value: "text", label: "text", hint: "Plain string" },
  { value: "json", label: "json", hint: "JSON value, optionally checked against a schema" },
  { value: "file", label: "file", hint: "File reference: uri, mime, name" },
  { value: "event", label: "event", hint: "Platform event: type + payload" },
  { value: "any", label: "any", hint: "Anything" },
];

export function defaultInterface(kind: "agent" | "model" | "function" | "group"): Interface {
  switch (kind) {
    case "agent":
    case "group":
      return { inputs: [port("in", "message")], outputs: [port("out", "message")] };
    case "model":
      return { inputs: [port("in", "text")], outputs: [port("out", "text")] };
    case "function":
      return { inputs: [port("in", "any")], outputs: [port("out", "any")] };
  }
}

const HUMAN_IFACE: Interface = { inputs: [port("in", "message")], outputs: [port("out", "message")] };
const NONE: Interface = { inputs: [], outputs: [] };

/** The ports a component exposes. Humans have a fixed interface; envs and plugins have none (they are used through access edges). */
export function interfaceOf(data: NodeData): Interface {
  if ("interface" in data && data.interface) return data.interface;
  if (data.kind === "human") return HUMAN_IFACE;
  return NONE;
}

/** Who can hold an access edge, and who can be accessed. */
/** Who can use an env or plugin through an access edge: agents, people, and functions (ctx.tool: a code-only actor). */
export const usesResources = (k: NodeKind) => k === "agent" || k === "human" || k === "function";
export const isResource = (k: NodeKind) => k === "env" || k === "plugin";
export const hasInterfaceEditor = (k: NodeKind) => k === "agent" || k === "model" || k === "function" || k === "group";

export const nodeName = (n: SysNode | undefined) => (n ? ("name" in n.data ? n.data.name : n.id) : "?");

/**
 * The scope an edge endpoint lives in (undefined = the root canvas).
 * Inside group G, G's input ports are sources and its output ports are
 * targets, so (G, input port) as a source and (G, output port) as a target
 * belong to G's own canvas. Port ids are unique across a component's inputs
 * and outputs, which keeps this unambiguous.
 */
export function endpointScope(doc: SystemDoc, nodeId: string, portId: string, end: "source" | "target"): string | undefined {
  const n = doc.nodes.find((x) => x.id === nodeId);
  if (!n) return undefined;
  if (n.data.kind === "group") {
    const ifc = interfaceOf(n.data);
    const inner = end === "source" ? ifc.inputs.some((p) => p.id === portId) : ifc.outputs.some((p) => p.id === portId);
    if (inner) return n.id;
  }
  return n.parent;
}

/** The scope an edge is drawn in, or null when its two ends are in different scopes. */
export function edgeScope(doc: SystemDoc, e: SysEdge): string | undefined | null {
  const a = endpointScope(doc, e.source, e.source_port, "source");
  const b = endpointScope(doc, e.target, e.target_port, "target");
  return a === b ? a : null;
}

/** Is the edge internal wiring of a group (touches the group's own ports from inside)? */
export const isBoundaryEdge = (doc: SystemDoc, e: SysEdge, groupId: string) =>
  (e.source === groupId && endpointScope(doc, e.source, e.source_port, "source") === groupId) ||
  (e.target === groupId && endpointScope(doc, e.target, e.target_port, "target") === groupId);

/** The port an edge leaves from, seen from the edge's scope. */
export function sourcePort(doc: SystemDoc, e: SysEdge): PortSpec | undefined {
  const n = doc.nodes.find((x) => x.id === e.source);
  if (!n) return undefined;
  const ifc = interfaceOf(n.data);
  return ifc.outputs.find((p) => p.id === e.source_port) ?? (n.data.kind === "group" ? ifc.inputs.find((p) => p.id === e.source_port) : undefined);
}

export function targetPort(doc: SystemDoc, e: SysEdge): PortSpec | undefined {
  const n = doc.nodes.find((x) => x.id === e.target);
  if (!n) return undefined;
  const ifc = interfaceOf(n.data);
  return ifc.inputs.find((p) => p.id === e.target_port) ?? (n.data.kind === "group" ? ifc.outputs.find((p) => p.id === e.target_port) : undefined);
}

export type CompatLevel = "ok" | "coerce" | "needs_transform";

const COERCE: Partial<Record<`${DataType}>${DataType}`, string>> = {
  "text>message": "wrapped as a user message",
  "message>text": "text parts joined",
  "json>text": "serialised as JSON text",
  "json>message": "serialised into a message",
  "file>message": "attached as a file part",
  "message>file": "its first attachment",
  "event>message": "rendered as a message",
  "event>text": "rendered as text",
};

/** Can a value from `out` flow into `inp` without a transform? */
export function compat(out: PortSpec, inp: PortSpec, schemaName: (id: string) => string = (x) => x): { level: CompatLevel; note: string } {
  if (out.type === "any" || inp.type === "any") return { level: "ok", note: "" };
  if (out.type === inp.type) {
    if (out.type === "json" && out.schema && inp.schema && out.schema !== inp.schema) {
      return { level: "needs_transform", note: `schema ${schemaName(out.schema)} → ${schemaName(inp.schema)} needs a transform` };
    }
    return { level: "ok", note: "" };
  }
  const c = COERCE[`${out.type}>${inp.type}`];
  if (c) return { level: "coerce", note: `${out.type} → ${inp.type}: ${c}` };
  return { level: "needs_transform", note: `${out.type} → ${inp.type} needs a transform` };
}

export const resPort = RES_PORT;

/** Rename a port and rewrite every edge that uses it. */
export function renamePort(doc: SystemDoc, nodeId: string, from: string, to: string): SystemDoc {
  return {
    ...doc,
    edges: doc.edges.map((e) => ({
      ...e,
      source_port: e.source === nodeId && e.source_port === from ? to : e.source_port,
      target_port: e.target === nodeId && e.target_port === from ? to : e.target_port,
    })),
  };
}

/** Edges that use a port that no longer exists are dropped when a port is deleted. */
export function dropPort(doc: SystemDoc, nodeId: string, portId: string): SystemDoc {
  return { ...doc, edges: doc.edges.filter((e) => !((e.source === nodeId && e.source_port === portId) || (e.target === nodeId && e.target_port === portId))) };
}
