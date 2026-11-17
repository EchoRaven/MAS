// Per-agent overrides of a plugin's retrieval pipeline, set on the access edge.
import { RETRIEVAL_SLOTS, type RetrievalSpec } from "@/model/pipelines";
import type { Step } from "@/model/steps";
import type { SystemDoc } from "@/model/types";
import { Section, Toggle } from "../fields";
import { RowList } from "./shared";
import { StepCard } from "./StepEditor";

export function RetrievalOverrides({ base, value, onChange, doc }: { base: RetrievalSpec; value: Partial<RetrievalSpec>; onChange: (v: Partial<RetrievalSpec> | null) => void; doc: SystemDoc }) {
  const count = Object.keys(value).length;
  const set = (key: keyof RetrievalSpec, v: Step | Step[] | undefined) => {
    const next = { ...value } as Record<string, unknown>;
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(Object.keys(next).length ? (next as Partial<RetrievalSpec>) : null);
  };
  return (
    <Section title={`Retrieval for this agent${count ? ` · ${count} overridden` : ""}`} defaultOpen={count > 0}>
      <p className="-mt-1 text-[11px] text-muted-foreground">The plugin's pipeline applies; switch a step on to change it for this agent only.</p>
      {RETRIEVAL_SLOTS.map((d) => {
        const own = value[d.key];
        const inherited = base[d.key];
        return (
          <div key={d.key} className="space-y-1.5">
            <Toggle label={d.title} checked={own !== undefined} onChange={(on) => set(d.key, on ? structuredClone(inherited) : undefined)} />
            {own !== undefined && (
              <RowList>
                {(Array.isArray(own) ? own : [own]).map((s, i) => (
                  <StepCard
                    key={i}
                    slot={d.slot}
                    title={Array.isArray(own) && own.length > 1 ? `${d.title} ${i + 1}` : d.title}
                    step={s}
                    defaultOpen
                    onChange={(n) => set(d.key, Array.isArray(own) ? own.map((x, j) => (j === i ? n : x)) : n)}
                    doc={doc}
                  />
                ))}
              </RowList>
            )}
          </div>
        );
      })}
    </Section>
  );
}
