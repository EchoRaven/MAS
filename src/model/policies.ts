// System policies: rules the runtime checks as a run goes. Each says when it
// is checked (`on`), a condition (an expression), and what to do when it holds.
//
//   on: tool            every tool call — block | require_approval | notify
//   on: usage           after every model call — terminate | notify
//   on: output          every value a component sends on — terminate | block | require_approval | notify
//   on: output(node)        … only from that component
//   on: output(node.port)   … only from that port
import { interfaceOf } from "./ports";
import type { SystemDoc, SystemPolicy } from "./types";

export type PolicyEvent = "tool" | "usage" | "output";

export const POLICY_ACTIONS: Record<PolicyEvent, SystemPolicy["action"][]> = {
  tool: ["block", "require_approval", "notify"],
  usage: ["terminate", "notify"],
  output: ["terminate", "block", "require_approval", "notify"],
};

/** What a policy's `on` means, or null if the runtime does not know it. */
export function policyTrigger(on: string): { event: PolicyEvent; node?: string; port?: string } | null {
  const t = on.trim();
  if (t === "tool" || t === "tool_call") return { event: "tool" };
  if (t === "usage") return { event: "usage" };
  if (t === "output") return { event: "output" };
  const m = /^output\(\s*([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_-]+))?\s*\)$/.exec(t);
  return m ? { event: "output", node: m[1], port: m[2] } : null;
}

/** The policies checked at this event (and, for outputs, this component and port). */
export function policiesAt(doc: SystemDoc, event: PolicyEvent, node?: string, port?: string): SystemPolicy[] {
  return doc.policies.filter((p) => {
    const t = policyTrigger(p.on);
    if (!t || t.event !== event) return false;
    if (t.node && t.node !== node) return false;
    return !t.port || t.port === port;
  });
}

/** Whether a policy's condition holds; an empty condition always does. */
export const conditionHolds = (p: SystemPolicy, test: (expr: string) => boolean) => !p.condition.trim() || test(p.condition);

/** Why a policy will never act, or null when it is fine. */
export function policyProblem(doc: SystemDoc, p: SystemPolicy): string | null {
  const t = policyTrigger(p.on);
  if (!t) return `policy ${p.id}: "on: ${p.on}" is not something the runtime checks. Use tool, usage, output, output(<component>) or output(<component>.<port>)`;
  if (!POLICY_ACTIONS[t.event].includes(p.action)) return `policy ${p.id}: "${p.action}" cannot be done on ${t.event}; there it can be ${POLICY_ACTIONS[t.event].join(", ")}`;
  const node = t.node ? doc.nodes.find((n) => n.id === t.node) : undefined;
  if (t.node && !node) return `policy ${p.id}: there is no component "${t.node}"`;
  if (node && t.port && !interfaceOf(node.data).outputs.some((o) => o.id === t.port)) return `policy ${p.id}: ${t.node} has no output "${t.port}" (it has ${interfaceOf(node.data).outputs.map((o) => o.id).join(", ") || "none"})`;
  if (!p.condition.trim()) return `policy ${p.id}: the condition is empty, so it holds every time`;
  return null;
}
