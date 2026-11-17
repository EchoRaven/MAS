// Where a run starts. A system may name its entry point; otherwise it is
// inferred from the graph. The canvas, the validator and the runtime all read
// this, so what the canvas marks is what the run does.
import { interfaceOf } from "./ports";
import type { AgentData, SysNode, SystemDoc } from "./types";

export interface EntryPoint {
  node: string;
  /** input port the run's input arrives on (components with ports) */
  port?: string;
  /** why this component starts: shown on the canvas and in the inspector */
  why: "chosen" | "human" | "on_start" | "no_input" | "only";
}

const STARTABLE = ["agent", "model", "function", "group"];
const isRoom = (doc: SystemDoc, id: string) => {
  const d = doc.nodes.find((n) => n.id === id)?.data;
  return d?.kind === "env" && d.env_kind === "room";
};

/** Components that could start a run: top-level, and able to receive the input. */
export function entryCandidates(doc: SystemDoc): SysNode[] {
  return doc.nodes.filter((n) => !n.parent && (n.data.kind === "human" || (STARTABLE.includes(n.data.kind) && interfaceOf(n.data).inputs.length > 0)));
}

/**
 * The components the run's input goes to, in order of preference:
 *   1. the entry point the system names (`doc.entry`), if it still exists
 *   2. every top-level human with an outgoing edge or a room
 *   3. every agent triggered `on_start`
 *   4. the first top-level component nothing feeds
 *   5. the first top-level component at all
 */
export function entryPoints(doc: SystemDoc): EntryPoint[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  if (doc.entry) {
    const n = byId.get(doc.entry.node);
    if (n && !n.parent) {
      const ports = interfaceOf(n.data).inputs;
      const port = doc.entry.port && ports.some((p) => p.id === doc.entry!.port) ? doc.entry.port : ports[0]?.id;
      return [{ node: n.id, port, why: "chosen" }];
    }
  }
  const humans = doc.nodes.filter(
    (n) =>
      n.data.kind === "human" &&
      !n.parent &&
      (doc.edges.some((e) => e.source === n.id && e.kind !== "access") || doc.edges.some((e) => e.kind === "access" && e.source === n.id && isRoom(doc, e.target))),
  );
  if (humans.length) return humans.map((n) => ({ node: n.id, why: "human" as const }));

  const onStart = doc.nodes.filter((n) => n.data.kind === "agent" && !n.parent && (n.data as AgentData).triggers.includes("on_start"));
  if (onStart.length) return onStart.map((n) => ({ node: n.id, port: interfaceOf(n.data).inputs[0]?.id, why: "on_start" as const }));

  const fed = new Set(doc.edges.filter((e) => e.kind !== "access").map((e) => e.target));
  const startable = doc.nodes.filter((n) => !n.parent && STARTABLE.includes(n.data.kind));
  const unfed = startable.find((n) => !fed.has(n.id));
  const first = unfed ?? startable[0];
  return first ? [{ node: first.id, port: interfaceOf(first.data).inputs[0]?.id, why: unfed ? "no_input" : "only" }] : [];
}

export const ENTRY_REASON: Record<EntryPoint["why"], string> = {
  chosen: "Starts the run (chosen for this system)",
  human: "Starts the run: a person at the edge of the system",
  on_start: "Starts the run: triggered on_start",
  no_input: "Starts the run: nothing feeds it",
  only: "Starts the run: the first component",
};
