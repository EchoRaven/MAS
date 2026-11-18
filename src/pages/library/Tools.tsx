import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Panel } from "@/components/shared/Panel";
import type { SystemDoc, ToolSpec } from "@/model/types";
import { EndpointField } from "@/canvas/inspector/EndpointField";
import { FunctionEditor } from "@/canvas/inspector/FunctionEditor";
import { cell } from "./cell";

/** How the runtime calls the tool: a URL, a command, or code; plus its argument schema. */
function RuntimeRow({ t, set, doc }: { t: ToolSpec; set: (patch: Partial<ToolSpec>) => void; doc: SystemDoc }) {
  return (
    <tr className="bg-secondary/40">
      <td colSpan={8} className="px-3 py-2.5">
        <div className="grid gap-2 md:grid-cols-2">
          {(t.adapter === "http" || t.adapter === "mcp") && (
            <div className="space-y-1.5">
              <EndpointField
                kind={t.adapter}
                value={t.endpoint}
                onChange={(endpoint) => set({ endpoint })}
                legacy={
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted-foreground">{t.adapter === "http" ? "URL the arguments are POSTed to" : "MCP server URL (Streamable HTTP)"}</span>
                    <input className={`${cell} font-mono`} value={t.url ?? ""} onChange={(e) => set({ url: e.target.value || undefined })} placeholder="https://…" aria-label="Tool URL" />
                  </label>
                }
              />
            </div>
          )}
          {t.adapter === "cli" && (
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Command (arguments arrive as JSON on stdin)</span>
              <input className={`${cell} font-mono`} value={t.command ?? ""} onChange={(e) => set({ command: e.target.value || undefined })} placeholder="python my_tool.py" aria-label="Tool command" />
            </label>
          )}
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Arguments (JSON Schema; blank = one text field)</span>
            <textarea className={`${cell} h-16 font-mono`} value={t.input_schema ?? ""} onChange={(e) => set({ input_schema: e.target.value || undefined })} placeholder='{"type": "object", "properties": {"query": {"type": "string"}}}' aria-label="Argument schema" />
          </label>
        </div>
        {t.adapter === "code" && (
          <div className="mt-2">
            <FunctionEditor label="Code" fn={t.fn ?? { lang: "js", code: "// f(args, ctx) -> result\nreturn args;" }} onChange={(fn) => set({ fn })} doc={doc} rows={5} hint="f(args, ctx) -> result" />
          </div>
        )}
        {t.needs_env && !t.url && !t.command && !t.fn && <p className="mt-2 text-[11px] text-muted-foreground">Served by the {t.needs_env} env the agent is connected to.</p>}
      </td>
    </tr>
  );
}

export function Tools({ doc, update }: { doc: SystemDoc; update: (fn: (d: SystemDoc) => SystemDoc) => void }) {
  const [open, setOpen] = useState<number | null>(null);
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
              <th className="w-6" />
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
              <Fragment key={i}>
              <tr className="border-t border-border/70">
                <td>
                  <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-label={`Runtime settings for ${t.id}`} className="rounded p-1 text-muted-foreground hover:text-foreground">
                    {open === i ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                </td>
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
              {open === i && <RuntimeRow t={t} set={(patch) => set(i, patch)} doc={doc} />}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Open a row for how the runtime calls the tool. Irreversible tools require human approval by default. Tools from imported envs and plugins are listed on those components, not here.</p>
    </Panel>
  );
}

