import { Trash2 } from "lucide-react";
import type { DbQuerySpec } from "@/model/pipelines";
import type { SystemDoc } from "@/model/types";
import { NumberField, opts, Section, SelectField, TextField, Toggle } from "../fields";
import { FunctionEditor } from "./FunctionEditor";
import { AddButton, Note, RowList } from "./shared";

/** How agents may query a database env: named templates, text-to-SQL within an allowlist, the env's tools, or code. */
export function DbQueryEditor({ value, onChange, doc }: { value: DbQuerySpec; onChange: (v: DbQuerySpec) => void; doc: SystemDoc }) {
  const set = (patch: Partial<DbQuerySpec>) => onChange({ ...value, ...patch });
  const setT = (i: number, patch: Partial<DbQuerySpec["templates"][number]>) => set({ templates: value.templates.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const chat = doc.models.filter((m) => (m.kind ?? "chat") === "chat");
  return (
    <Section title="Queries">
      <SelectField
        label="Agents query by"
        value={value.mode}
        onChange={(mode) => set({ mode, fn: mode === "custom" ? (value.fn ?? { lang: "python", code: "# def f(request, ctx) -> rows\nreturn ctx.db.execute(request['sql'], request.get('params', {}))" }) : value.fn })}
        items={opts([
          ["templates", "Named templates", "Only the parameterised queries below; safest"],
          ["text_to_sql", "Text-to-SQL", "An LLM writes SQL, limited to the listed tables"],
          ["tools", "The env's own tools", "Whatever its MCP server exposes"],
          ["custom", "Custom code", "Your function receives the request and the connection"],
        ])}
      />
      <Toggle label="Read-only" checked={value.read_only} onChange={(read_only) => set({ read_only })} hint="Writes are rejected at the connection, whatever the query says" />
      <NumberField label="Row limit" value={value.row_limit} onChange={(v) => set({ row_limit: v ?? 200 })} />
      {value.mode === "templates" && (
        <>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[12px] font-medium">Templates · {value.templates.length}</span>
            <AddButton label="Add template" onClick={() => set({ templates: [...value.templates, { name: `query_${value.templates.length + 1}`, description: "", sql: "SELECT * FROM table WHERE id = :id" }] })} />
          </div>
          <RowList empty="No templates: agents cannot query.">
            {value.templates.map((t, i) => (
              <li key={i} className="group/row space-y-1 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <input value={t.name} onChange={(e) => setT(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })} aria-label="Template name" className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 font-mono text-[12px] outline-none hover:bg-secondary focus:bg-card focus:ring-1 focus:ring-ring/40" />
                  <button type="button" onClick={() => set({ templates: value.templates.filter((_, j) => j !== i) })} aria-label={`Delete template ${t.name}`} className="flex h-7 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover/row:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input value={t.description} onChange={(e) => setT(i, { description: e.target.value })} placeholder="When to use it" aria-label="Template description" className="h-6 w-full rounded-md bg-transparent px-1.5 text-[12px] text-muted-foreground outline-none hover:bg-secondary focus:bg-card focus:ring-1 focus:ring-ring/40" />
                <textarea value={t.sql} onChange={(e) => setT(i, { sql: e.target.value })} rows={2} spellCheck={false} aria-label={`${t.name} SQL`} className="prop-field block w-full resize-y px-2 py-1.5 font-mono text-[11px]" />
              </li>
            ))}
          </RowList>
          <p className="text-[11px] text-muted-foreground">Each template becomes a tool for connected agents; :name placeholders become its arguments.</p>
        </>
      )}
      {value.mode === "text_to_sql" && (
        <>
          <SelectField label="Model" value={value.model ?? chat[0]?.id ?? ""} onChange={(model) => set({ model })} items={chat.map((m) => ({ value: m.id, label: m.id, hint: m.model }))} />
          <TextField label="Tables" hint="Only these are described to the model and allowed in its SQL" value={value.tables.join(", ")} onChange={(v) => set({ tables: v.split(",").map((s) => s.trim()).filter(Boolean) })} mono placeholder="orders, customers" />
          {value.tables.length === 0 && <Note tone="warning">No tables listed: the model would see the whole schema.</Note>}
        </>
      )}
      {value.mode === "custom" && value.fn && <FunctionEditor label="Query handler" fn={value.fn} onChange={(fn) => set({ fn })} doc={doc} rows={5} hint="f(request, ctx) -> rows. ctx.db is the connection (read-only if set above)." />}
    </Section>
  );
}
