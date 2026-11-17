import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Panel } from "@/components/shared/Panel";
import type { ModelSpec, SystemDoc } from "@/model/types";
import { cell } from "./cell";

const KEY_ENV: Record<ModelSpec["provider"], string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GEMINI_API_KEY", openai_compatible: "OPENAI_API_KEY", local: "", mock: "" };

/** A JSON object field that only commits when the text parses. */
function JsonCell({ value, onChange, label }: { value: Record<string, unknown> | undefined; onChange: (v: Record<string, unknown> | undefined) => void; label: string }) {
  const [text, setText] = useState(value && Object.keys(value).length ? JSON.stringify(value) : "");
  const [bad, setBad] = useState(false);
  return (
    <input
      className={`${cell} font-mono ${bad ? "ring-1 ring-destructive" : ""}`}
      value={text}
      placeholder="{}"
      aria-label={label}
      onChange={(e) => {
        setText(e.target.value);
        if (!e.target.value.trim()) { setBad(false); onChange(undefined); return; }
        try {
          const v = JSON.parse(e.target.value);
          if (v && typeof v === "object" && !Array.isArray(v)) { setBad(false); onChange(v); } else setBad(true);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}

function ApiRow({ m, set }: { m: ModelSpec; set: (patch: Partial<ModelSpec>) => void }) {
  const api = m.api ?? {};
  const setApi = (patch: Partial<ModelSpec["api"]>) => set({ api: { ...api, ...patch } });
  return (
    <tr className="bg-secondary/40">
      <td colSpan={9} className="px-3 py-2.5">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Base URL (blank = the provider's default)</span>
            <input className={`${cell} font-mono`} value={api.base_url ?? ""} onChange={(e) => setApi({ base_url: e.target.value || undefined })} placeholder={m.provider === "openai_compatible" || m.provider === "local" ? "http://127.0.0.1:8000/v1" : "default"} aria-label="Base URL" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">API key from env var (the key itself is never stored)</span>
            <input className={`${cell} font-mono`} value={api.key_env ?? ""} onChange={(e) => setApi({ key_env: e.target.value || undefined })} placeholder={KEY_ENV[m.provider] || "none"} aria-label="Key env var" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Extra headers (JSON)</span>
            <JsonCell value={api.headers} onChange={(headers) => setApi({ headers: headers as Record<string, string> | undefined })} label="Headers" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Default request params (JSON), e.g. {"{\"max_tokens\": 4096}"}</span>
            <JsonCell value={api.params} onChange={(params) => setApi({ params })} label="Params" />
          </label>
        </div>
      </td>
    </tr>
  );
}

export function Models({ doc, update }: { doc: SystemDoc; update: (fn: (d: SystemDoc) => SystemDoc) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const set = (i: number, patch: Partial<ModelSpec>) => update((d) => ({ ...d, models: d.models.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const used = (id: string) =>
    doc.nodes.filter((n) => (n.data.kind === "agent" && n.data.model === id) || (n.data.kind === "model" && n.data.model === id)).length +
    doc.edges.filter((e) => e.transform?.lang === "llm" && e.transform.model === id).length +
    // pipeline steps and loops that name it
    (JSON.stringify(doc.nodes).match(new RegExp(`"(model|embedding|planner|critic|evaluator)":"${id}"`, "g"))?.length ?? 0);
  return (
    <Panel
      title="Models"
      actions={
        <Button variant="ghost" size="sm" className="h-7" onClick={() => update((d) => ({ ...d, models: [...d.models, { id: `model_${d.models.length + 1}`, provider: "openai_compatible", model: "", api: { base_url: "http://127.0.0.1:8000/v1" }, price_in: 0, price_out: 0, modalities: ["text"] }] }))}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="w-6" />
              <th className="py-1.5 pr-2 font-medium">Ref id</th>
              <th className="py-1.5 pr-2 font-medium">Kind</th>
              <th className="py-1.5 pr-2 font-medium">Provider</th>
              <th className="py-1.5 pr-2 font-medium">Model</th>
              <th className="py-1.5 pr-2 font-medium">Input $/M</th>
              <th className="py-1.5 pr-2 font-medium">Output $/M</th>
              <th className="py-1.5 pr-2 font-medium">In use</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {doc.models.map((m, i) => (
              <Fragment key={i}>
                <tr className="border-t border-border/70">
                  <td>
                    <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-label={`API settings for ${m.id}`} className="rounded p-1 text-muted-foreground hover:text-foreground">
                      {open === i ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                  <td className="py-1.5 pr-2"><input className={`${cell} font-mono`} value={m.id} onChange={(e) => set(i, { id: e.target.value })} aria-label="Ref id" /></td>
                  <td className="py-1.5 pr-2">
                    <Select size="sm" value={m.kind ?? "chat"} onValueChange={(kind) => set(i, { kind: kind as ModelSpec["kind"] })} ariaLabel="Kind" items={["chat", "embedding", "rerank"].map((v) => ({ value: v, label: v }))} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Select size="sm" value={m.provider} onValueChange={(provider) => set(i, { provider: provider as ModelSpec["provider"] })} ariaLabel="Provider" items={["anthropic", "openai", "google", "openai_compatible", "local", "mock"].map((v) => ({ value: v, label: v }))} />
                  </td>
                  <td className="py-1.5 pr-2"><input className={`${cell} font-mono`} value={m.model} onChange={(e) => set(i, { model: e.target.value })} aria-label="Model" /></td>
                  <td className="py-1.5 pr-2"><input type="number" step="0.01" className={cell} value={m.price_in} onChange={(e) => set(i, { price_in: Number(e.target.value) })} aria-label="Input price" /></td>
                  <td className="py-1.5 pr-2"><input type="number" step="0.01" className={cell} value={m.price_out} onChange={(e) => set(i, { price_out: Number(e.target.value) })} aria-label="Output price" /></td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{used(m.id)}</td>
                  <td className="py-1.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={used(m.id) > 0} onClick={() => update((d) => ({ ...d, models: d.models.filter((_, j) => j !== i) }))} aria-label="Delete model" title={used(m.id) > 0 ? "Still in use" : "Delete"}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
                {open === i && <ApiRow m={m} set={(patch) => set(i, patch)} />}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Open a row for its API: endpoint, which env var holds the key, extra headers and default params. Claude prices are Anthropic's API prices (2026-11); prices only drive cost estimates.</p>
    </Panel>
  );
}
