import { useState, type ReactNode } from "react";
import { AlertTriangle, CircleAlert, Info, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { cn } from "@/lib/utils";
import { KIND_LABEL, RUNNERS, runnerById } from "@/model/defaults";
import type {
  AgentData,
  ChannelData,
  EdgeKind,
  EnvData,
  GroupData,
  HarnessTier,
  HumanData,
  NodeData,
  StoreBinding,
  StoreData,
  SysEdge,
  SystemDoc,
  Trigger,
} from "@/model/types";
import type { Issue } from "@/model/validate";
import { EDGE_LABEL } from "./convert";
import { AreaField, Chips, NumberField, opts, Section, SelectField, TextField, Toggle } from "./fields";

type Update = (fn: (doc: SystemDoc) => SystemDoc) => void;

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-1.5">
      {issues.map((i, k) => {
        const Icon = i.severity === "error" ? CircleAlert : i.severity === "warning" ? AlertTriangle : Info;
        return (
          <li
            key={k}
            className={cn(
              "flex gap-2 rounded-lg px-2.5 py-2 text-xs",
              i.severity === "error" ? "bg-destructive/10 text-destructive" : i.severity === "warning" ? "bg-warning/10 text-warning" : "bg-secondary text-muted-foreground",
            )}
          >
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{i.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Header({ title, subtitle, avatar, onDelete, onClose }: { title: string; subtitle: string; avatar: ReactNode; onDelete?: () => void; onClose: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {onDelete && (
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="删除">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="关闭">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

const LEVEL_TINT = { full: "bg-success/10 text-success", partial: "bg-info/10 text-info", none: "bg-secondary text-muted-foreground" };

function CapabilityTable({ a }: { a: AgentData }) {
  const c = a.harness.capabilities;
  const rows: [string, ReactNode][] = [
    ["上下文控制", <span className={cn("rounded-full px-2 py-0.5", LEVEL_TINT[c.context_control])}>{c.context_control}</span>],
    ["tool 注入", c.tool_injection.length ? c.tool_injection.join(" / ") : "不支持"],
    ["可观察步骤", <span className={cn("rounded-full px-2 py-0.5", LEVEL_TINT[c.observable_steps])}>{c.observable_steps}</span>],
    ["动作前审批", c.approval_hook ? "支持" : "不支持（只能在 env 边界管控）"],
    ["会话续接", c.resumable ? "支持" : "不支持"],
    ["成本上报", c.cost_reporting ? "支持" : "平台估算"],
  ];
  return (
    <dl className="divide-y divide-border/70 rounded-lg text-xs shadow-[0_0_0_1px_hsl(var(--border))]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-2 px-3 py-1.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const TRIGGERS: { value: Trigger; label: string }[] = [
  { value: "on_message", label: "收到消息" },
  { value: "on_call", label: "被调用" },
  { value: "on_handoff", label: "被移交" },
  { value: "on_state", label: "状态变化" },
  { value: "on_schedule", label: "定时" },
  { value: "on_start", label: "系统启动" },
  { value: "on_event", label: "平台事件" },
];

function AgentInspector({ id, a, doc, set }: { id: string; a: AgentData; doc: SystemDoc; set: (patch: Partial<AgentData>) => void }) {
  const runner = runnerById(a.harness.runner);
  const setHarness = (patch: Partial<AgentData["harness"]>) => set({ harness: { ...a.harness, ...patch } });
  const setContext = (patch: Partial<AgentData["context"]>) => set({ context: { ...a.context, ...patch } });
  const stores = doc.nodes.filter((n) => n.data.kind === "store");
  const others = doc.nodes.filter((n) => n.data.kind === "agent" && n.id !== id);
  const usesModel = a.harness.tier === "native" || a.harness.tier === "sdk";
  const noCtx = a.harness.capabilities.context_control === "none";

  const changeTier = (tier: HarnessTier) => {
    const r = RUNNERS.find((x) => x.tier === tier)!;
    setHarness({ tier, runner: r.id, capabilities: { ...r.caps }, loop: tier === "native" ? (a.harness.loop ?? "react") : undefined });
  };
  const changeRunner = (rid: string) => {
    const r = runnerById(rid)!;
    setHarness({ runner: rid, capabilities: { ...r.caps } });
  };
  const binding = (storeId: string) => a.context.sources.find((s) => s.store === storeId);
  const setBinding = (storeId: string, mode: StoreBinding["mode"] | "off") => {
    const rest = a.context.sources.filter((s) => s.store !== storeId);
    setContext({ sources: mode === "off" ? rest : [...rest, { store: storeId, mode, top_k: binding(storeId)?.top_k ?? 5 }] });
  };

  return (
    <Tabs defaultValue="basic" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="mx-4 mt-3 grid grid-cols-5">
        <TabsTrigger value="basic">基本</TabsTrigger>
        <TabsTrigger value="harness">Harness</TabsTrigger>
        <TabsTrigger value="tools">工具</TabsTrigger>
        <TabsTrigger value="context">上下文</TabsTrigger>
        <TabsTrigger value="schedule">调度</TabsTrigger>
      </TabsList>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <TabsContent value="basic" className="mt-0 space-y-4">
          <TextField label="名称" value={a.name} onChange={(name) => set({ name })} />
          <TextField label="角色" value={a.role} onChange={(role) => set({ role })} placeholder="一句话说明它负责什么" />
          {usesModel ? (
            <SelectField
              label="Base model"
              value={a.model}
              onChange={(model) => set({ model })}
              items={doc.models.map((m) => ({ value: m.id, label: m.model, hint: m.price_in || m.price_out ? `$${m.price_in}/$${m.price_out}` : m.provider }))}
              hint="单价为每百万 token 的输入 / 输出价格，在「模型与工具」里管理"
            />
          ) : (
            <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
              {a.harness.tier === "process" ? "process 级 harness 自己选择和调用模型；模型在它自己的配置里设置。" : "远程 agent 的模型由对方决定。"}
            </p>
          )}
          <NumberField label="单 agent 预算（美元）" value={a.budget_usd} onChange={(budget_usd) => set({ budget_usd })} step={0.5} />
          <Chips
            label="接受的输入模态"
            options={[
              { value: "text", label: "文本" },
              { value: "image", label: "图片" },
              { value: "audio", label: "音频" },
              { value: "video", label: "视频" },
              { value: "file", label: "文件" },
            ]}
            value={a.modalities_in}
            onChange={(modalities_in) => set({ modalities_in })}
          />
          <SelectField
            label="收到不支持的模态时"
            value={a.on_unsupported}
            onChange={(on_unsupported) => set({ on_unsupported })}
            items={opts([
              ["describe", "转成文字描述"],
              ["extract_text", "抽取文字"],
              ["as_file", "落成 env 里的文件"],
              ["reject", "拒收并通知发送方"],
            ])}
          />
        </TabsContent>

        <TabsContent value="harness" className="mt-0 space-y-4">
          <SelectField
            label="接入级别"
            value={a.harness.tier}
            onChange={changeTier}
            items={opts([
              ["native", "native · 平台原生"],
              ["sdk", "sdk · 进程内 SDK"],
              ["process", "process · 外部进程"],
              ["remote", "remote · 远程 agent"],
            ])}
          />
          {a.harness.tier !== "native" && (
            <SelectField
              label="适配器"
              value={a.harness.runner ?? ""}
              onChange={changeRunner}
              items={RUNNERS.filter((r) => r.tier === a.harness.tier).map((r) => ({ value: r.id, label: r.label }))}
              hint={runner?.hint}
            />
          )}
          {a.harness.tier === "native" && (
            <SelectField
              label="Loop"
              value={a.harness.loop ?? "react"}
              onChange={(loop) => setHarness({ loop })}
              items={opts([
                ["react", "react · 思考-行动循环"],
                ["plan_execute", "plan_execute · 先规划再执行"],
                ["single_shot", "single_shot · 单次调用"],
              ])}
            />
          )}
          {a.harness.tier === "process" && <TextField label="启动命令" value={a.harness.command ?? ""} onChange={(command) => setHarness({ command })} mono placeholder={a.harness.runner === "claude-code" ? "默认：claude -p --bare" : "./my_agent --json"} />}
          {a.harness.tier === "remote" && <TextField label="Agent Card 地址" value={a.harness.url ?? ""} onChange={(url) => setHarness({ url })} mono placeholder="https://agent.example.com/.well-known/agent-card.json" />}
          <AreaField label="指令" value={a.harness.instructions} onChange={(instructions) => setHarness({ instructions })} rows={6} hint={a.harness.tier === "process" ? "通过 --append-system-prompt 或首条消息传入" : undefined} />
          <NumberField label="最多步数" value={a.harness.max_steps} onChange={(v) => setHarness({ max_steps: v ?? undefined })} />
          {a.harness.tier !== "native" && (
            <SelectField
              label="harness 自带记忆"
              value={a.harness.own_memory ?? "keep"}
              onChange={(own_memory) => setHarness({ own_memory })}
              items={opts([
                ["keep", "保留"],
                ["disable", "关闭（只用平台的 Store）"],
              ])}
              hint="避免两套记忆系统互相冲突"
            />
          )}
          <Section title="能力声明">
            <CapabilityTable a={a} />
            <p className="text-[11px] text-muted-foreground">能力由适配器决定。平台据此决定上下文、tool 和审批从哪个边界注入。</p>
          </Section>
        </TabsContent>

        <TabsContent value="tools" className="mt-0 space-y-4">
          {a.harness.capabilities.tool_injection.length === 0 && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">这个 harness 不支持注入 tool。</p>}
          <ul className="space-y-1">
            {doc.tools.map((t) => {
              const on = a.tools.includes(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => set({ tools: on ? a.tools.filter((x) => x !== t.id) : [...a.tools, t.id] })}
                    className={cn("flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-secondary", on && "bg-active")}
                  >
                    <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]", on ? "border-foreground bg-foreground text-background" : "border-input")}>{on ? "✓" : ""}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        {t.id}
                        <span className={cn("rounded-full px-1.5 font-sans text-[10px]", t.effect === "irreversible" ? "bg-destructive/10 text-destructive" : t.effect === "write" ? "bg-warning/10 text-warning" : "bg-secondary text-muted-foreground")}>{t.effect}</span>
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {t.description}
                        {t.needs_env ? ` · 需要 ${t.needs_env} env` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted-foreground">通信类 tool（send_message、call_、handoff_to_）由画布上的连线自动注入，不需要在这里选。</p>
          <Section title="运行时招募">
            <Toggle label="允许招募子 agent" checked={!!a.spawn} onChange={(on) => set({ spawn: on ? { template: others[0]?.id ?? "", max_instances: 4 } : null })} hint="平台注入 spawn_agent / retire_agent；新实例的权限和预算不超过它" />
            {a.spawn && (
              <>
                <SelectField label="模板" value={a.spawn.template} onChange={(template) => set({ spawn: { ...a.spawn!, template } })} items={others.map((n) => ({ value: n.id, label: (n.data as AgentData).name }))} />
                <NumberField label="最多实例数" value={a.spawn.max_instances} onChange={(v) => set({ spawn: { ...a.spawn!, max_instances: v ?? 1 } })} />
              </>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="context" className="mt-0 space-y-4">
          {noCtx && <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">这个 harness 不开放上下文控制。下面的设置会通过 MCP tool、env 文件和消息前缀生效，窗口和压缩策略不起作用。</p>}
          <NumberField label="上下文预算（token）" value={a.context.budget_total} onChange={(v) => setContext({ budget_total: v ?? 120000 })} step={1000} />
          <SelectField
            label="历史策略"
            value={a.context.history_strategy}
            onChange={(history_strategy) => setContext({ history_strategy })}
            items={opts([
              ["window", "滑动窗口"],
              ["summary", "全部摘要"],
              ["window_then_summary", "窗口 + 更早的摘要"],
              ["retrieve", "按相关性检索"],
            ])}
          />
          <NumberField label="窗口大小（条）" value={a.context.history_window} onChange={(v) => setContext({ history_window: v ?? 30 })} />
          <Toggle label="观察遮蔽" checked={a.context.mask_tool_output} onChange={(mask_tool_output) => setContext({ mask_tool_output })} hint="较早的大段 tool 输出替换成占位符" />
          <Section title="记忆与知识来源">
            {stores.length === 0 ? (
              <p className="text-xs text-muted-foreground">系统里还没有 Store。从左侧拖一个进来。</p>
            ) : (
              stores.map((s) => (
                <SelectField
                  key={s.id}
                  label={(s.data as StoreData).name}
                  value={binding(s.id)?.mode ?? "off"}
                  onChange={(m) => setBinding(s.id, m as StoreBinding["mode"] | "off")}
                  items={opts([
                    ["off", "不使用"],
                    ["tool", "作为 tool：agent 自己决定何时查"],
                    ["auto_inject", "自动注入：每次调用前检索"],
                    ["pinned", "固定放入"],
                  ])}
                />
              ))
            )}
          </Section>
        </TabsContent>

        <TabsContent value="schedule" className="mt-0 space-y-4">
          <Chips label="触发器" options={TRIGGERS} value={a.triggers} onChange={(triggers) => set({ triggers })} hint="满足任一条件即唤醒" />
          <SelectField
            label="工作中又来了新消息"
            value={a.concurrency}
            onChange={(concurrency) => set({ concurrency })}
            items={opts([
              ["coalesce", "合并：本轮结束后一次唤醒"],
              ["queue", "排队"],
              ["parallel", "并行：开新实例"],
              ["interrupt", "打断当前轮"],
            ])}
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-4">{children}</div>;
}

function OtherNodeInspector({ id, data, doc, set }: { id: string; data: NodeData; doc: SystemDoc; set: (patch: Partial<NodeData>) => void }) {
  switch (data.kind) {
    case "human": {
      const h = data as HumanData;
      return (
        <Body>
          <TextField label="名称" value={h.name} onChange={(name) => set({ name })} />
          <TextField label="角色" value={h.role} onChange={(role) => set({ role })} />
          <Toggle label="可以审批" checked={h.approves} onChange={(approves) => set({ approves } as Partial<HumanData>)} hint="连到它的 call 会作为审批请求出现在它的收件箱" />
        </Body>
      );
    }
    case "env": {
      const e = data as EnvData;
      return (
        <Body>
          <TextField label="名称" value={e.name} onChange={(name) => set({ name })} />
          <SelectField label="类型" value={e.env_kind} onChange={(env_kind) => set({ env_kind } as Partial<EnvData>)} items={opts([["sandbox", "sandbox · 容器 / microVM"], ["browser", "browser · 无头浏览器"], ["database", "database · 托管数据库"], ["service", "service · 托管服务"], ["external", "external · 第三方系统"]])} />
          {e.env_kind === "sandbox" && <TextField label="镜像" value={e.image} onChange={(image) => set({ image } as Partial<EnvData>)} mono />}
          <SelectField label="生命周期" value={e.lifecycle} onChange={(lifecycle) => set({ lifecycle } as Partial<EnvData>)} items={opts([["per_run", "每次运行新建"], ["per_session", "每个会话"], ["persistent", "持久"]])} />
          <SelectField label="快照" value={e.snapshot} onChange={(snapshot) => set({ snapshot } as Partial<EnvData>)} items={opts([["never", "不快照"], ["on_write", "每次写入"], ["on_checkpoint", "检查点时"]])} hint={e.env_kind === "external" ? "external env 无法快照，只能记录动作" : "支持回放与分叉"} />
          <TextField label="允许的网络出口（逗号分隔，默认全部禁止）" value={e.egress.join(", ")} onChange={(v) => set({ egress: v.split(",").map((s) => s.trim()).filter(Boolean) } as Partial<EnvData>)} mono />
        </Body>
      );
    }
    case "store": {
      const s = data as StoreData;
      return (
        <Body>
          <TextField label="名称" value={s.name} onChange={(name) => set({ name })} />
          <SelectField label="类型" value={s.store_kind} onChange={(store_kind) => set({ store_kind } as Partial<StoreData>)} items={opts([["memory", "memory · 记忆"], ["knowledge", "knowledge · 知识库"], ["board", "board · 任务看板"]])} />
          <SelectField label="后端" value={s.backend} onChange={(backend) => set({ backend } as Partial<StoreData>)} items={opts([["builtin", "平台内置"], ["pgvector", "pgvector"], ["qdrant", "Qdrant"], ["mcp", "MCP 知识服务"], ["http", "HTTP"]])} />
          <SelectField label="作用域" value={s.scope} onChange={(scope) => set({ scope } as Partial<StoreData>)} items={opts([["agent", "agent 私有"], ["group", "Group 内共享"], ["end_user", "按最终用户隔离"], ["system", "全系统"]])} />
          <SelectField label="写入方式" value={s.write} onChange={(write) => set({ write } as Partial<StoreData>)} items={opts([["agent_tool", "agent 通过 tool 主动写"], ["auto_extract", "平台自动提取"], ["none", "只读"]])} />
          {s.store_kind === "knowledge" && <TextField label="来源（逗号分隔）" value={s.sources.join(", ")} onChange={(v) => set({ sources: v.split(",").map((x) => x.trim()).filter(Boolean) } as Partial<StoreData>)} mono />}
        </Body>
      );
    }
    case "channel": {
      const c = data as ChannelData;
      const members = doc.edges.filter((e) => e.target === id || e.source === id).map((e) => (e.source === id ? e.target : e.source));
      return (
        <Body>
          <TextField label="名称" value={c.name} onChange={(name) => set({ name })} />
          <SelectField label="类型" value={c.channel_type} onChange={(channel_type) => set({ channel_type } as Partial<ChannelData>)} items={opts([["room", "room · 多方广播"], ["topic", "topic · 发布订阅"]])} />
          <SelectField label="发言策略" value={c.policy} onChange={(policy) => set({ policy } as Partial<ChannelData>)} items={opts([["free", "自由：被触发的都可以回应"], ["round_robin", "轮流"], ["selector", "主持人指定下一个"], ["mention", "只有被 @ 的回应"], ["bid", "竞价：意愿最高者发言"]])} />
          {c.policy === "selector" && (
            <SelectField label="主持者" value={c.selector ?? ""} onChange={(selector) => set({ selector } as Partial<ChannelData>)} items={members.map((m) => ({ value: m, label: (doc.nodes.find((n) => n.id === m)?.data as { name?: string })?.name ?? m }))} />
          )}
          <SelectField label="后加入者能看到历史吗" value={c.history} onChange={(history) => set({ history } as Partial<ChannelData>)} items={opts([["persistent", "能看到全部历史"], ["since_join", "只看加入之后"]])} />
          <p className="text-xs text-muted-foreground">成员：连到这个 room 的 {members.length} 个节点。</p>
        </Body>
      );
    }
    case "group": {
      const g = data as GroupData;
      const members = doc.nodes.filter((n) => n.parent === id).map((n) => ({ value: n.id, label: (n.data as { name?: string }).name ?? n.id }));
      return (
        <Body>
          <TextField label="名称" value={g.name} onChange={(name) => set({ name })} />
          <SelectField label="入口成员" value={g.entry} onChange={(entry) => set({ entry } as Partial<GroupData>)} items={members} hint="外部对 Group 的 message / call 送到这里" />
          <SelectField label="输出来自" value={g.output_from} onChange={(output_from) => set({ output_from } as Partial<GroupData>)} items={members} />
          <NumberField label="Group 预算（美元）" value={g.budget_usd} onChange={(budget_usd) => set({ budget_usd } as Partial<GroupData>)} step={0.5} />
          <SelectField label="内部失败时" value={g.on_error} onChange={(on_error) => set({ on_error } as Partial<GroupData>)} items={opts([["retry_then_fail_up", "重试一次，再向上冒泡"], ["fail_up", "直接向上冒泡"], ["ignore", "忽略"]])} />
          <p className="text-xs text-muted-foreground">把节点拖进框里加入 Group，拖出框外移出。Group 同时是预算、权限和错误的边界。</p>
        </Body>
      );
    }
    default:
      return null;
  }
}

function EdgeInspector({ e, doc, set }: { e: SysEdge; doc: SystemDoc; set: (patch: Partial<SysEdge>) => void }) {
  const target = doc.nodes.find((n) => n.id === e.target);
  const toResource = target?.data.kind === "env" || target?.data.kind === "store";
  const kinds: EdgeKind[] = toResource ? ["access"] : ["message", "call", "handoff", "access"];
  return (
    <Body>
      <SelectField label="交互语义" value={e.kind} onChange={(kind) => set({ kind })} items={kinds.map((k) => ({ value: k, label: EDGE_LABEL[k] }))} hint={toResource ? "连到 env 或 store 的只能是 access" : undefined} />
      {e.kind !== "access" && <TextField label="标签" value={e.label ?? ""} onChange={(label) => set({ label: label || undefined })} />}
      {e.kind === "handoff" && (
        <SelectField label="移交时携带的上下文" value={e.carry ?? "summary"} onChange={(carry) => set({ carry })} items={opts([["none", "不携带"], ["summary", "摘要"], ["full", "完整历史"]])} />
      )}
      {e.kind === "access" && <SelectField label="权限" value={e.access ?? "read_write"} onChange={(access) => set({ access })} items={opts([["read", "只读"], ["read_write", "读写"]])} />}
      {(e.kind === "message" || e.kind === "call") && <TextField label="消息 schema（可选）" value={e.schema ?? ""} onChange={(schema) => set({ schema: schema || undefined })} mono placeholder="ReviewRequest" />}
      <Section title="Gate">
        <Toggle label="经过这条连线前必须通过检查" checked={!!e.gate} onChange={(on) => set({ gate: on ? { name: "gate", condition: "", on_fail: "block", escalate_after: 3 } : null })} />
        {e.gate && (
          <>
            <TextField label="名称" value={e.gate.name} onChange={(name) => set({ gate: { ...e.gate!, name } })} />
            <TextField label="条件" value={e.gate.condition} onChange={(condition) => set({ gate: { ...e.gate!, condition } })} mono hint="check: <命令>（在 env 里运行）· judge: <agent id>（裁判打分）· expr: <表达式>" />
            <SelectField label="不通过时" value={e.gate.on_fail} onChange={(on_fail) => set({ gate: { ...e.gate!, on_fail } })} items={opts([["block", "阻止，并把原因反馈给发起方"], ["require_approval", "请人审批"], ["route_back", "退回发起方"]])} />
            <NumberField label="连续拒绝几次后升级给人" value={e.gate.escalate_after} onChange={(v) => set({ gate: { ...e.gate!, escalate_after: v ?? 3 } })} />
          </>
        )}
      </Section>
    </Body>
  );
}

const TERMINATION = [
  { value: "any_agent_calls_finish", label: "有 agent 调用 finish" },
  { value: "all_idle", label: "全部空闲" },
  { value: "budget_exceeded", label: "超出预算" },
  { value: "max_rounds", label: "达到轮数上限" },
  { value: "judge_outputs_verdict", label: "裁判给出结论" },
];

function SystemInspector({ doc, update, issues }: { doc: SystemDoc; update: Update; issues: Issue[] }) {
  const set = (patch: Partial<SystemDoc>) => update((d) => ({ ...d, ...patch }));
  const [showAll, setShowAll] = useState(false);
  return (
    <>
      <div className="border-b border-border/70 px-4 py-3">
        <p className="text-sm font-semibold">系统设置</p>
        <p className="text-xs text-muted-foreground">选中画布上的节点或连线以编辑它</p>
      </div>
      <Body>
        <TextField label="名称" value={doc.name} onChange={(name) => set({ name })} />
        <AreaField label="描述" value={doc.description} onChange={(description) => set({ description })} rows={3} />
        <Section title="预算">
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="美元" value={doc.budget.usd} onChange={(usd) => set({ budget: { ...doc.budget, usd } })} step={0.5} />
            <NumberField label="轮数" value={doc.budget.max_rounds} onChange={(max_rounds) => set({ budget: { ...doc.budget, max_rounds } })} />
            <NumberField label="分钟" value={doc.budget.wallclock_min} onChange={(wallclock_min) => set({ budget: { ...doc.budget, wallclock_min } })} />
          </div>
        </Section>
        <Chips label="终止条件（任一满足即结束）" options={TERMINATION} value={doc.termination} onChange={(termination) => set({ termination })} />
        <Section
          title="系统级 policy"
          aside={
            <Button variant="ghost" size="sm" className="h-7" onClick={() => set({ policies: [...doc.policies, { id: `p${Date.now() % 100000}`, on: "usage", condition: "", action: "notify" }] })}>
              <Plus className="mr-1 h-3.5 w-3.5" /> 添加
            </Button>
          }
        >
          {doc.policies.length === 0 && <p className="text-xs text-muted-foreground">没有系统级 policy。连线上的 gate 在选中连线时编辑。</p>}
          {doc.policies.map((p, i) => {
            const setP = (patch: Partial<typeof p>) => set({ policies: doc.policies.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={p.id} className="space-y-2 rounded-lg p-3 shadow-[0_0_0_1px_hsl(var(--border))]">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">on</span>
                  <input className="glass-input h-8 min-w-0 flex-1 px-2 font-mono text-xs" value={p.on} onChange={(e) => setP({ on: e.target.value })} aria-label="事件" />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => set({ policies: doc.policies.filter((_, j) => j !== i) })} aria-label="删除 policy">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">if</span>
                  <input className="glass-input h-8 min-w-0 flex-1 px-2 font-mono text-xs" value={p.condition} onChange={(e) => setP({ condition: e.target.value })} aria-label="条件" />
                </div>
                <SelectField label="do" value={p.action} onChange={(action) => setP({ action })} items={opts([["terminate", "terminate"], ["suspend", "suspend"], ["notify", "notify"], ["block", "block"], ["require_approval", "require_approval"]])} />
              </div>
            );
          })}
        </Section>
        <Section title={`检查结果（${issues.length}）`} aside={issues.length > 6 && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll(!showAll)}>{showAll ? "收起" : "全部"}</button>}>
          {issues.length === 0 ? <p className="text-xs text-success">没有发现问题。</p> : <IssueList issues={showAll ? issues : issues.slice(0, 6)} />}
        </Section>
      </Body>
    </>
  );
}

export function Inspector({
  doc,
  update,
  nodeId,
  edgeId,
  issues,
  onClose,
}: {
  doc: SystemDoc;
  update: Update;
  nodeId?: string;
  edgeId?: string;
  issues: Issue[];
  onClose: () => void;
}) {
  const node = nodeId ? doc.nodes.find((n) => n.id === nodeId) : undefined;
  const edge = edgeId ? doc.edges.find((e) => e.id === edgeId) : undefined;

  const setNode = (patch: Partial<NodeData>) =>
    update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } as NodeData } : n)) }));
  const deleteNode = () =>
    update((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => n.id !== nodeId).map((n) => (n.parent === nodeId ? { ...n, parent: undefined, position: { x: n.position.x + (node?.position.x ?? 0), y: n.position.y + (node?.position.y ?? 0) } } : n)),
      edges: d.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    }));
  const setEdge = (patch: Partial<SysEdge>) => update((d) => ({ ...d, edges: d.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)) }));
  const deleteEdge = () => update((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== edgeId) }));

  if (node) {
    const name = "name" in node.data ? node.data.name : node.id;
    const own = issues.filter((i) => i.nodeId === node.id);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Header
          title={name}
          subtitle={`${KIND_LABEL[node.data.kind]} · id: ${node.id}`}
          avatar={<EntityAvatar kind={node.data.kind === "agent" ? "agent" : "system"} id={node.id} name={name} className="h-8 w-8 text-[11px]" />}
          onDelete={deleteNode}
          onClose={onClose}
        />
        {own.length > 0 && (
          <div className="px-4 pt-3">
            <IssueList issues={own} />
          </div>
        )}
        {node.data.kind === "agent" ? (
          <AgentInspector key={node.id} id={node.id} a={node.data as AgentData} doc={doc} set={setNode as (p: Partial<AgentData>) => void} />
        ) : (
          <OtherNodeInspector key={node.id} id={node.id} data={node.data} doc={doc} set={setNode} />
        )}
      </div>
    );
  }
  if (edge) {
    const nm = (id: string) => {
      const n = doc.nodes.find((x) => x.id === id);
      return n && "name" in n.data ? n.data.name : id;
    };
    const own = issues.filter((i) => i.edgeId === edge.id);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Header title={`${nm(edge.source)} → ${nm(edge.target)}`} subtitle={EDGE_LABEL[edge.kind]} avatar={<EntityAvatar kind="system" id={edge.id} name="" className="h-8 w-8" />} onDelete={deleteEdge} onClose={onClose} />
        {own.length > 0 && (
          <div className="px-4 pt-3">
            <IssueList issues={own} />
          </div>
        )}
        <EdgeInspector key={edge.id} e={edge} doc={doc} set={setEdge} />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SystemInspector doc={doc} update={update} issues={issues} />
    </div>
  );
}
