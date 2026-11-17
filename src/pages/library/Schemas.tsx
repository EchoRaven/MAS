import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/shared/Panel";
import { interfaceOf } from "@/model/ports";
import type { SchemaSpec, SystemDoc } from "@/model/types";
import { cell } from "./cell";

const parses = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/** Named JSON Schemas that json ports, parse and validate stages refer to. */
export function Schemas({ doc, update }: { doc: SystemDoc; update: (fn: (d: SystemDoc) => SystemDoc) => void }) {
  const set = (i: number, patch: Partial<SchemaSpec>) => update((d) => ({ ...d, schemas: d.schemas.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const used = (id: string) =>
    doc.nodes.reduce((k, n) => {
      const ifc = interfaceOf(n.data);
      const ports = [...ifc.inputs, ...ifc.outputs].filter((p) => p.schema === id).length;
      const stages = n.data.kind === "agent" ? [...n.data.pipeline.pre, ...n.data.pipeline.post].filter((s) => s.schema === id).length : 0;
      return k + ports + stages;
    }, 0);
  return (
    <Panel
      title="Schemas"
      actions={
        <Button variant="ghost" size="sm" className="h-7" onClick={() => update((d) => ({ ...d, schemas: [...d.schemas, { id: `Schema${d.schemas.length + 1}`, description: "", json_schema: '{\n  "type": "object",\n  "properties": {}\n}' }] }))}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      }
    >
      {doc.schemas.length === 0 && <p className="text-xs text-muted-foreground">No schemas yet. A json port can name one to make its shape part of the interface.</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {doc.schemas.map((s, i) => (
          <div key={i} className="space-y-2 rounded-lg p-3 shadow-[0_0_0_1px_hsl(var(--border))]">
            <div className="flex items-center gap-2">
              <input className={`${cell} max-w-40 font-mono`} value={s.id} onChange={(e) => set(i, { id: e.target.value.replace(/[^A-Za-z0-9_]/g, "") })} aria-label="Schema id" />
              <input className={cell} value={s.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="What it describes" aria-label="Schema description" />
              <span className="shrink-0 text-[11px] text-muted-foreground">{used(s.id)} uses</span>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={used(s.id) > 0} onClick={() => update((d) => ({ ...d, schemas: d.schemas.filter((_, j) => j !== i) }))} aria-label="Delete schema">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Textarea value={s.json_schema} onChange={(e) => set(i, { json_schema: e.target.value })} rows={7} spellCheck={false} aria-label={`${s.id} JSON Schema`} className={`font-mono text-[11px] ${parses(s.json_schema) ? "" : "ring-1 ring-destructive"}`} />
          </div>
        ))}
      </div>
    </Panel>
  );
}
