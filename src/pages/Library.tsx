import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Panel } from "@/components/shared/Panel";
import type { ModelSpec, SystemDoc, ToolSpec } from "@/model/types";
import { useSystems } from "@/store/systems";

const cell = "glass-input h-8 w-full px-2 text-xs";

function Models({ doc, update }: { doc: SystemDoc; update: (fn: (d: SystemDoc) => SystemDoc) => void }) {
  const set = (i: number, patch: Partial<ModelSpec>) => update((d) => ({ ...d, models: d.models.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const used = (id: string) => doc.nodes.filter((n) => n.data.kind === "agent" && n.data.model === id).length;
  return (
    <Panel
      title="模型目录"
      actions={
        <Button variant="ghost" size="sm" className="h-7" onClick={() => update((d) => ({ ...d, models: [...d.models, { id: `model_${d.models.length + 1}`, provider: "openai_compatible", model: "", price_in: 0, price_out: 0, modalities: ["text"] }] }))}>
          <Plus className="mr-1 h-3.5 w-3.5" /> 添加
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-2 font-medium">引用 id</th>
              <th className="py-1.5 pr-2 font-medium">厂商</th>
              <th className="py-1.5 pr-2 font-medium">模型</th>
              <th className="py-1.5 pr-2 font-medium">输入 $/M</th>
              <th className="py-1.5 pr-2 font-medium">输出 $/M</th>
              <th className="py-1.5 pr-2 font-medium">使用中</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {doc.models.map((m, i) => (
              <tr key={i} className="border-t border-border/70">
                <td className="py-1.5 pr-2"><input className={`${cell} font-mono`} value={m.id} onChange={(e) => set(i, { id: e.target.value })} aria-label="引用 id" /></td>
                <td className="py-1.5 pr-2">
                  <Select size="sm" value={m.provider} onValueChange={(provider) => set(i, { provider: provider as ModelSpec["provider"] })} ariaLabel="厂商" items={["anthropic", "openai", "google", "openai_compatible", "local"].map((v) => ({ value: v, label: v }))} />
                </td>
                <td className="py-1.5 pr-2"><input className={`${cell} font-mono`} value={m.model} onChange={(e) => set(i, { model: e.target.value })} aria-label="模型" /></td>
                <td className="py-1.5 pr-2"><input type="number" step="0.01" className={cell} value={m.price_in} onChange={(e) => set(i, { price_in: Number(e.target.value) })} aria-label="输入单价" /></td>
                <td className="py-1.5 pr-2"><input type="number" step="0.01" className={cell} value={m.price_out} onChange={(e) => set(i, { price_out: Number(e.target.value) })} aria-label="输出单价" /></td>
                <td className="py-1.5 pr-2 text-muted-foreground">{used(m.id)} 个 agent</td>
                <td className="py-1.5">
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={used(m.id) > 0} onClick={() => update((d) => ({ ...d, models: d.models.filter((_, j) => j !== i) }))} aria-label="删除模型" title={used(m.id) > 0 ? "仍有 agent 在用" : "删除"}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Claude 单价为 Anthropic 官方 API 价格（2026-11）；其他行请按你的实际价格填写。单价只用于成本估算。</p>
    </Panel>
  );
}

function Tools({ doc, update }: { doc: SystemDoc; update: (fn: (d: SystemDoc) => SystemDoc) => void }) {
  const set = (i: number, patch: Partial<ToolSpec>) => update((d) => ({ ...d, tools: d.tools.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const used = (id: string) => doc.nodes.filter((n) => n.data.kind === "agent" && n.data.tools.includes(id)).length;
  return (
    <Panel
      title="工具目录"
      actions={
        <Button variant="ghost" size="sm" className="h-7" onClick={() => update((d) => ({ ...d, tools: [...d.tools, { id: `tool_${d.tools.length + 1}`, description: "", adapter: "mcp", effect: "read", needs_env: null }] }))}>
          <Plus className="mr-1 h-3.5 w-3.5" /> 添加
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-2 font-medium">id</th>
              <th className="py-1.5 pr-2 font-medium">说明</th>
              <th className="py-1.5 pr-2 font-medium">适配器</th>
              <th className="py-1.5 pr-2 font-medium">副作用</th>
              <th className="py-1.5 pr-2 font-medium">需要的 env</th>
              <th className="py-1.5 pr-2 font-medium">使用中</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {doc.tools.map((t, i) => (
              <tr key={i} className="border-t border-border/70">
                <td className="py-1.5 pr-2"><input className={`${cell} font-mono`} value={t.id} onChange={(e) => set(i, { id: e.target.value })} aria-label="tool id" /></td>
                <td className="py-1.5 pr-2"><input className={cell} value={t.description} onChange={(e) => set(i, { description: e.target.value })} aria-label="说明" /></td>
                <td className="py-1.5 pr-2"><Select size="sm" value={t.adapter} onValueChange={(adapter) => set(i, { adapter: adapter as ToolSpec["adapter"] })} ariaLabel="适配器" items={["mcp", "http", "cli", "code", "builtin"].map((v) => ({ value: v, label: v }))} /></td>
                <td className="py-1.5 pr-2"><Select size="sm" value={t.effect} onValueChange={(effect) => set(i, { effect: effect as ToolSpec["effect"] })} ariaLabel="副作用" items={["pure", "read", "write", "irreversible"].map((v) => ({ value: v, label: v }))} /></td>
                <td className="py-1.5 pr-2"><Select size="sm" value={t.needs_env ?? ""} onValueChange={(v) => set(i, { needs_env: (v || null) as ToolSpec["needs_env"] })} ariaLabel="需要的 env" items={[{ value: "", label: "无" }, ...["sandbox", "browser", "database", "service", "external"].map((v) => ({ value: v, label: v }))]} /></td>
                <td className="py-1.5 pr-2 text-muted-foreground">{used(t.id)} 个 agent</td>
                <td className="py-1.5">
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={used(t.id) > 0} onClick={() => update((d) => ({ ...d, tools: d.tools.filter((_, j) => j !== i) }))} aria-label="删除 tool">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">irreversible 的 tool 默认需要人工审批。v0 中 tool 只做声明，真实的 MCP / HTTP 接入在 runtime 实现后生效。</p>
    </Panel>
  );
}

export function LibraryPage() {
  const { systemId } = useParams();
  const systems = useSystems((s) => s.systems);
  const updateStore = useSystems((s) => s.update);
  const navigate = useNavigate();
  if (!systemId) return systems.length ? <Navigate to={`/library/${systems[0].id}`} replace /> : <Navigate to="/" replace />;
  const doc = systems.find((s) => s.id === systemId);
  if (!doc) return <Navigate to="/" replace />;
  const update = (fn: (d: SystemDoc) => SystemDoc) => updateStore(doc.id, fn);
  return (
    <div className="h-full overflow-y-auto p-3 md:p-6">
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">系统</span>
          <Select value={doc.id} onValueChange={(id) => navigate(`/library/${id}`)} items={systems.map((s) => ({ value: s.id, label: s.name }))} ariaLabel="选择系统" className="max-w-64" />
          <span className="text-xs text-muted-foreground">每个系统有自己的模型和工具目录，随 YAML 一起导出。</span>
        </div>
        <Models doc={doc} update={update} />
        <Tools doc={doc} update={update} />
      </div>
    </div>
  );
}
