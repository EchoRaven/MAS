// The native agent loop (a registry slot) and the agent's lifecycle hooks.
import { CUSTOM_SIGNATURE, optionFor, STEP_CATALOG, type ParamValue } from "@/model/steps";
import type { AgentData, AgentHook, NativeLoop, SystemDoc } from "@/model/types";
import { Section, SelectField, Toggle } from "../fields";
import { emptyFn, FunctionEditor } from "./FunctionEditor";
import { ParamField } from "./StepEditor";

export function LoopEditor({ a, doc, set }: { a: AgentData; doc: SystemDoc; set: (patch: Partial<AgentData>) => void }) {
  const loop = a.harness.loop ?? "react";
  const setHarness = (patch: Partial<AgentData["harness"]>) => set({ harness: { ...a.harness, ...patch } });
  const items = [...STEP_CATALOG.loop.map((o) => ({ value: o.use, label: o.label, hint: o.hint })), { value: "custom", label: "Custom loop", hint: "The whole turn as code" }];
  const opt = optionFor("loop", loop);
  return (
    <>
      <SelectField
        label="Loop"
        value={loop}
        onChange={(l: string) => {
          const o = optionFor("loop", l);
          setHarness({
            loop: l as NativeLoop,
            loop_params: o ? Object.fromEntries(o.params.map((p) => [p.key, p.default])) : undefined,
            loop_fn: l === "custom" ? (a.harness.loop_fn ?? emptyFn("js", `// ${CUSTOM_SIGNATURE.loop}\nconst reply = await model.call(ctx.messages);\nreturn reply;`)) : a.harness.loop_fn,
          });
        }}
        items={items}
      />
      {loop === "custom" ? (
        <FunctionEditor label="Loop" fn={a.harness.loop_fn ?? emptyFn()} onChange={(loop_fn) => setHarness({ loop_fn })} doc={doc} rows={8} hint={CUSTOM_SIGNATURE.loop} />
      ) : (
        opt &&
        opt.params.length > 0 && (
          <div className="space-y-2 rounded-lg bg-secondary/30 p-2.5 ring-1 ring-border/50">
            {opt.params.map((p) => (
              <ParamField key={p.key} def={p} value={(a.harness.loop_params as Record<string, ParamValue> | undefined)?.[p.key]} onChange={(v) => setHarness({ loop_params: { ...(a.harness.loop_params ?? {}), [p.key]: v } })} doc={doc} />
            ))}
          </div>
        )
      )}
    </>
  );
}

const HOOKS: [AgentHook, string][] = [
  ["on_start", "Once, when the agent starts"],
  ["before_model", "Before each model call: edit or block the request"],
  ["after_model", "After each model reply: inspect, rewrite, or reject it"],
  ["before_tool", "Before each tool call: edit arguments, block, or ask a human"],
  ["after_tool", "After each tool result: redact, cache, log"],
  ["on_error", "When a step fails: retry, fall back, or escalate"],
  ["on_finish", "When the turn ends"],
];

/** f(event, ctx) -> event | null. Returning null from a before_* hook blocks the action. */
export function HooksEditor({ a, doc, set }: { a: AgentData; doc: SystemDoc; set: (patch: Partial<AgentData>) => void }) {
  const hooks = a.hooks ?? {};
  const native = a.harness.tier === "native" || a.harness.capabilities.approval_hook;
  return (
    <Section title={`Hooks · ${Object.values(hooks).filter(Boolean).length}`} defaultOpen={Object.values(hooks).some(Boolean)}>
      {!native && <p className="text-[11px] text-muted-foreground">This harness has no step hooks; before/after model and tool hooks run at the platform boundary (MCP proxy) instead.</p>}
      {HOOKS.map(([key, hint]) => {
        const fn = hooks[key];
        return (
          <div key={key} className="space-y-1.5">
            <Toggle label={key} hint={hint} checked={!!fn} onChange={(on) => set({ hooks: { ...hooks, [key]: on ? emptyFn("js", "return event;") : null } })} />
            {fn && <FunctionEditor label={key} fn={fn} onChange={(next) => set({ hooks: { ...hooks, [key]: next } })} doc={doc} rows={3} hint={`${hint}. f(event, ctx) -> event | null`} />}
          </div>
        );
      })}
    </Section>
  );
}
