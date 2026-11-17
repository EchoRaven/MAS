import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Panel } from "@/components/shared/Panel";
import type { SystemDoc, ToolSpec } from "@/model/types";
import { cell } from "./cell";

export function Tools({ doc, update }: { doc: SystemDoc; update: (fn: (d: SystemDoc) => SystemDoc) => void }) {
  const set = (i: number, patch: Partial<ToolSpec>) => update((d) => ({ ...d, tools: d.tools.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const used = (id: string) => doc.nodes.filter((n) => n.data.kind === "agent" && n.data.tools.includes(id)).length;
  return (
    <Panel
      title="Tool catalog"
      actions={
        <Button variant="ghost" size="sm" className="h-7" onClick={() => update((d) => ({ ...d, tools: [...d.tools, { id: `tool_${d.tools.length + 1}`, description: "", adapter: "mcp", effect: "read", needs_env: null }] }))}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-2 font-medium">id</th>
              <th className="py-1.5 pr-2 font-medium">Description</th>
              <th className="py-1.5 pr-2 font-medium">Adapter</th>
              <th className="py-1.5 pr-2 font-medium">Effect</th>
              <th className="py-1.5 pr-2 font-medium">Needs env</th>
              <th className="py-1.5 pr-2 font-medium">In use</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {doc.tools.map((t, i) => (
              <tr key={i} className="border-t border-border/70">
                <td className="py-1.5 pr-2"><input className={`${cell} font-mono`} value={t.id} onChange={(e) => set(i, { id: e.target.value })} aria-label="tool id" /></td>
                <td className="py-1.5 pr-2"><input className={cell} value={t.description} onChange={(e) => set(i, { description: e.target.value })} aria-label="Description" /></td>
                <td className="py-1.5 pr-2"><Select size="sm" value={t.adapter} onValueChange={(adapter) => set(i, { adapter: adapter as ToolSpec["adapter"] })} ariaLabel="Adapter" items={["mcp", "http", "cli", "code", "builtin"].map((v) => ({ value: v, label: v }))} /></td>
                <td className="py-1.5 pr-2"><Select size="sm" value={t.effect} onValueChange={(effect) => set(i, { effect: effect as ToolSpec["effect"] })} ariaLabel="Effect" items={["pure", "read", "write", "irreversible"].map((v) => ({ value: v, label: v }))} /></td>
                <td className="py-1.5 pr-2"><Select size="sm" value={t.needs_env ?? ""} onValueChange={(v) => set(i, { needs_env: (v || null) as ToolSpec["needs_env"] })} ariaLabel="Needs env" items={[{ value: "", label: "None" }, ...["app", "sandbox", "browser", "database", "service", "external"].map((v) => ({ value: v, label: v }))]} /></td>
                <td className="py-1.5 pr-2 text-muted-foreground">{used(t.id)} agents</td>
                <td className="py-1.5">
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={used(t.id) > 0} onClick={() => update((d) => ({ ...d, tools: d.tools.filter((_, j) => j !== i) }))} aria-label="Delete tool">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Irreversible tools require human approval by default. Tools from imported envs and plugins are listed on those components, not here.</p>
    </Panel>
  );
}

