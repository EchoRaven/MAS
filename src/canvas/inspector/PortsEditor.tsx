import { Trash2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { dropPort, DATA_TYPES, renamePort } from "@/model/ports";
import type { DataType, Interface, PortSpec, SystemDoc } from "@/model/types";
import { Section } from "../fields";
import { TYPE_DOT } from "../nodes";
import { AddButton, RowList, type Update } from "./shared";

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
      <Section title={dir === "inputs" ? inputsLabel : outputsLabel} aside={<AddButton label={`Add ${dir === "inputs" ? "input" : "output"}`} onClick={() => setIfc({ ...ifc, [dir]: [...ports, { id: fresh(dir === "inputs" ? "in" : "out"), type: "message" }] })} />}>
        <RowList empty="None.">
          {ports.map((p, i) => (
            <li key={i} className="group/row space-y-1 px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full border-2 border-card", TYPE_DOT[p.type].replace(/!/g, ""))} />
                <input
                  value={p.id}
                  aria-label={`${dir} port name`}
                  onChange={(e) => setPort(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                  className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 font-mono text-[12px] outline-none hover:bg-secondary focus:bg-card focus:ring-1 focus:ring-ring/40"
                />
                <Select
                  variant="field"
                  size="sm"
                  value={p.type}
                  onValueChange={(type) => setPort(i, { type: type as DataType, schema: type === "json" ? p.schema : undefined })}
                  items={DATA_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                  ariaLabel="Port type"
                  className="w-[84px] font-mono"
                />
                {dir === "inputs" && (
                  <button
                    type="button"
                    onClick={() => setPort(i, { required: !p.required || undefined })}
                    aria-pressed={!!p.required}
                    aria-label="Required"
                    title={p.required ? "Required: it waits for this input" : "Optional"}
                    className={cn("flex h-7 w-6 items-center justify-center rounded-md font-mono text-[13px]", p.required ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground")}
                  >
                    *
                  </button>
                )}
                <button type="button" onClick={() => remove(i)} aria-label={`Delete port ${p.id}`} className="flex h-7 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover/row:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {p.type === "json" && (
                <div className="pl-4">
                  <Select
                    variant="field"
                    size="sm"
                    value={p.schema ?? "__none"}
                    onValueChange={(v) => setPort(i, { schema: v === "__none" ? null : v })}
                    items={[{ value: "__none", label: "Any JSON" }, ...doc.schemas.map((x) => ({ value: x.id, label: x.id }))]}
                    ariaLabel="Schema"
                    className="w-full"
                  />
                </div>
              )}
            </li>
          ))}
        </RowList>
      </Section>
    );
  };

  return (
    <>
      {list("inputs")}
      {list("outputs")}
    </>
  );
}
