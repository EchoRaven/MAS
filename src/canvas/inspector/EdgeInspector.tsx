import { defaultBinding } from "@/model/defaults";
import { compat, interfaceOf, sourcePort, targetPort } from "@/model/ports";
import type { EdgeKind, SysEdge, SystemDoc } from "@/model/types";
import { EDGE_LABEL } from "../convert";
import { NumberField, opts, Section, SelectField, TextField, Toggle } from "../fields";
import { BindingEditor } from "./BindingEditor";
import { emptyFn, FunctionEditor } from "./FunctionEditor";
import { Body, Note } from "./shared";

function GateEditor({ e, set }: { e: SysEdge; set: (patch: Partial<SysEdge>) => void }) {
  return (
    <Section title="Gate">
      <Toggle label="Check before crossing" checked={!!e.gate} onChange={(on) => set({ gate: on ? { name: "gate", condition: "", on_fail: "block", escalate_after: 3 } : null })} />
      {e.gate && (
        <>
          <TextField label="Name" value={e.gate.name} onChange={(name) => set({ gate: { ...e.gate!, name } })} />
          <TextField label="Condition" value={e.gate.condition} onChange={(condition) => set({ gate: { ...e.gate!, condition } })} mono hint="check: <command> (runs in the env) · judge: <agent id> (scored by a judge) · expr: <expression>" placeholder="check: npm test" />
          <SelectField label="On failure" value={e.gate.on_fail} onChange={(on_fail) => set({ gate: { ...e.gate!, on_fail } })} items={opts([["block", "Block and tell the sender why"], ["require_approval", "Ask a human to approve"], ["route_back", "Send back to the sender"]])} />
          <NumberField label="Escalate after" hint="Ask a human after this many rejections" value={e.gate.escalate_after} onChange={(v) => set({ gate: { ...e.gate!, escalate_after: v ?? 3 } })} />
        </>
      )}
    </Section>
  );
}

/** A data edge: which ports, what interaction, and the function between them. */
function DataEdge({ e, doc, set, scope }: { e: SysEdge; doc: SystemDoc; set: (patch: Partial<SysEdge>) => void; scope?: string }) {
  const s = doc.nodes.find((n) => n.id === e.source)!;
  const t = doc.nodes.find((n) => n.id === e.target)!;
  const sIfc = interfaceOf(s.data);
  const tIfc = interfaceOf(t.data);
  // inside a group, its inputs are sources and its outputs targets
  const sPorts = s.id === scope ? sIfc.inputs : sIfc.outputs;
  const tPorts = t.id === scope ? tIfc.outputs : tIfc.inputs;
  const sp = sourcePort(doc, e);
  const tp = targetPort(doc, e);
  const c = sp && tp ? compat(sp, tp) : null;
  return (
    <>
      <div className="space-y-2">
        <SelectField label="From port" value={e.source_port} onChange={(source_port) => set({ source_port })} items={sPorts.map((p) => ({ value: p.id, label: p.id, hint: p.type + (p.schema ? `<${p.schema}>` : "") }))} />
        <SelectField label="To port" value={e.target_port} onChange={(target_port) => set({ target_port })} items={tPorts.map((p) => ({ value: p.id, label: p.id, hint: p.type + (p.schema ? `<${p.schema}>` : "") }))} />
      </div>
      {c && c.level !== "ok" && <Note tone={c.level === "needs_transform" && !e.transform ? "warning" : "muted"}>{c.note}{c.level === "needs_transform" && !e.transform ? ". Add a transform below." : ""}</Note>}
      <SelectField label="Interaction" value={e.kind} onChange={(kind) => set({ kind })} items={(["message", "call", "handoff"] as EdgeKind[]).map((k) => ({ value: k, label: EDGE_LABEL[k] }))} />
      <TextField label="Label" value={e.label ?? ""} onChange={(label) => set({ label: label || undefined })} />
      {e.kind === "handoff" && <SelectField label="Carries" value={e.carry ?? "summary"} onChange={(carry) => set({ carry })} items={opts([["none", "None"], ["summary", "Summary"], ["full", "Full history"]])} />}
      <Section title="Function">
        <Toggle label="Transform" checked={!!e.transform} onChange={(on) => set({ transform: on ? emptyFn() : null })} hint="f(input, ctx) → what the target port expects; return null to drop" />
        {e.transform && <FunctionEditor label="Transform" fn={e.transform} onChange={(transform) => set({ transform })} doc={doc} />}
        <TextField label="Only when" value={e.filter ?? ""} onChange={(f) => set({ filter: f || null })} mono placeholder='input.decision == "approve"' />
      </Section>
      <GateEditor e={e} set={set} />
    </>
  );
}

export function EdgeInspector({ e, doc, set, scope }: { e: SysEdge; doc: SystemDoc; set: (patch: Partial<SysEdge>) => void; scope?: string }) {
  const target = doc.nodes.find((n) => n.id === e.target);
  if (!target) return null;
  if (e.kind === "access") {
    return (
      <Body>
        <SelectField label="Access" value={e.access ?? "read_write"} onChange={(access) => set({ access })} items={opts([["read", "Read-only"], ["read_write", "Read and write"]])} />
        <BindingEditor binding={e.binding ?? defaultBinding(target.data)} onChange={(binding) => set({ binding })} target={target.data} access={e.access ?? "read_write"} doc={doc} />
        <GateEditor e={e} set={set} />
      </Body>
    );
  }
  return (
    <Body>
      <DataEdge e={e} doc={doc} set={set} scope={scope} />
    </Body>
  );
}
