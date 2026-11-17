import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { dropPort, DATA_TYPES, renamePort } from "@/model/ports";
import type { DataType, Interface, PortSpec, SystemDoc } from "@/model/types";
import { Section } from "../fields";
import { AddButton, type Update } from "./shared";

/**
 * Edit a component's interface. Renaming a port rewrites the edges that use
 * it; deleting one drops them. Port names are unique across inputs and outputs.
 */
export function PortsEditor({ nodeId, ifc, doc, update, inputsLabel = "Inputs", outputsLabel = "Outputs" }: { nodeId: string; ifc: Interface; doc: SystemDoc; update: Update; inputsLabel?: string; outputsLabel?: string }) {
  const setIfc = (next: Interface, rewrite?: (d: SystemDoc) => SystemDoc) =>
    update((d) => {
      const withEdges = rewrite ? rewrite(d) : d;
      return { ...withEdges, nodes: withEdges.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, interface: next } as typeof n.data } : n)) };
    });
  const taken = new Set([...ifc.inputs, ...ifc.outputs].map((p) => p.id));
  const fresh = (base: string) => {
    let i = 1;
    while (taken.has(`${base}${i > 1 ? i : ""}`)) i++;
    return `${base}${i > 1 ? i : ""}`;
  };

  const list = (dir: "inputs" | "outputs") => {
    const ports = ifc[dir];
    const setPort = (i: number, patch: Partial<PortSpec>) => {
      const old = ports[i];
      const next = { ...ifc, [dir]: ports.map((p, j) => (j === i ? { ...p, ...patch } : p)) };
      const renamed = patch.id && patch.id !== old.id;
      setIfc(next, renamed ? (d) => renamePort(d, nodeId, old.id, patch.id!) : undefined);
    };
    const remove = (i: number) => setIfc({ ...ifc, [dir]: ports.filter((_, j) => j !== i) }, (d) => dropPort(d, nodeId, ports[i].id));
    return (
      <Section title={dir === "inputs" ? inputsLabel : outputsLabel} aside={<AddButton onClick={() => setIfc({ ...ifc, [dir]: [...ports, { id: fresh(dir === "inputs" ? "in" : "out"), type: "message" }] })} />}>
        {ports.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
        <ul className="space-y-2">
          {ports.map((p, i) => (
            <li key={i} className="space-y-1.5 rounded-lg p-2 shadow-[0_0_0_1px_hsl(var(--border))]">
              <div className="flex items-center gap-1.5">
                <Input
                  value={p.id}
                  aria-label={`${dir} port name`}
                  onChange={(e) => setPort(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                  className="h-8 min-w-0 flex-1 font-mono text-xs"
                />
                <Select
                  value={p.type}
                  onValueChange={(type) => setPort(i, { type: type as DataType, schema: type === "json" ? p.schema : undefined })}
                  items={DATA_TYPES.map((t) => ({ value: t.value, label: t.label, hint: t.hint }))}
                  ariaLabel="Port type"
                  className="w-28"
                />
                <button type="button" onClick={() => remove(i)} aria-label={`Delete port ${p.id}`} className="rounded p-1 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {p.type === "json" && (
                <Select
                  value={p.schema ?? "__none"}
                  onValueChange={(v) => setPort(i, { schema: v === "__none" ? null : v })}
                  items={[{ value: "__none", label: "Any JSON" }, ...doc.schemas.map((s) => ({ value: s.id, label: s.id, hint: s.description }))]}
                  ariaLabel="Schema"
                  className="w-full"
                />
              )}
              {dir === "inputs" && (
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input type="checkbox" checked={!!p.required} onChange={(e) => setPort(i, { required: e.target.checked || undefined })} /> Required before it runs
                </label>
              )}
            </li>
          ))}
        </ul>
      </Section>
    );
  };

  return (
    <div className="space-y-4">
      {list("inputs")}
      {list("outputs")}
      <p className="text-[11px] text-muted-foreground">Edges connect an output to an input. Types that do not match need a transform on the edge; json ports can require a schema (manage schemas under Library).</p>
    </div>
  );
}
