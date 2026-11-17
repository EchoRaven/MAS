// Retrieval, indexing and memory pipelines: an ordered list of steps, some of
// which (search, filter) can hold several.
import { INDEX_SLOTS, MEMORY_SLOTS, RETRIEVAL_SLOTS, type IndexSpec, type MemoryPolicy, type RetrievalSpec } from "@/model/pipelines";
import { makeStep, STEP_CATALOG, type Slot, type Step } from "@/model/steps";
import type { SystemDoc } from "@/model/types";
import { Section } from "../fields";
import { AddButton, RowList } from "./shared";
import { StepCard } from "./StepEditor";

type SlotDef<K> = { key: K; slot: Slot; title: string; many?: boolean };

function Pipeline<T extends object>({ title, slots, value, onChange, doc, hint }: { title: string; slots: SlotDef<keyof T>[]; value: T; onChange: (v: T) => void; doc: SystemDoc; hint?: string }) {
  const set = (key: keyof T, v: Step | Step[]) => onChange({ ...value, [key]: v });
  const firstUse = (slot: Slot) => STEP_CATALOG[slot][0].use;
  return (
    <Section title={title}>
      {hint && <p className="-mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      <RowList>
        {slots.flatMap((d) => {
          const v = value[d.key] as unknown as Step | Step[];
          if (!d.many) return [<StepCard key={String(d.key)} slot={d.slot} title={d.title} step={v as Step} onChange={(s) => set(d.key, s)} doc={doc} />];
          const list = (v as Step[]) ?? [];
          return [
            ...list.map((s, i) => (
              <StepCard
                key={`${String(d.key)}${i}`}
                slot={d.slot}
                title={list.length > 1 ? `${d.title} ${i + 1}` : d.title}
                step={s}
                onChange={(n) => set(d.key, list.map((x, j) => (j === i ? n : x)))}
                onRemove={list.length > (d.slot === "search" ? 1 : 0) ? () => set(d.key, list.filter((_, j) => j !== i)) : undefined}
                doc={doc}
              />
            )),
            <li key={`${String(d.key)}-add`} className="flex h-8 items-center justify-between pl-[30px] pr-1 text-[11px] text-muted-foreground">
              {list.length === 0 ? `No ${d.title.toLowerCase()} step` : d.slot === "search" ? "Several searches run together (hybrid)" : "Applied in order"}
              <AddButton label={`Add ${d.title.toLowerCase()}`} onClick={() => set(d.key, [...list, makeStep(d.slot, firstUse(d.slot))])} />
            </li>,
          ];
        })}
      </RowList>
    </Section>
  );
}

export function RetrievalEditor({ value, onChange, doc, title = "Retrieval" }: { value: RetrievalSpec; onChange: (v: RetrievalSpec) => void; doc: SystemDoc; title?: string }) {
  return <Pipeline title={title} slots={RETRIEVAL_SLOTS} value={value} onChange={onChange} doc={doc} hint="query → search → fuse → filter → rerank → select → format. Any step can be custom code." />;
}

export function IndexEditor({ value, onChange, doc }: { value: IndexSpec; onChange: (v: IndexSpec) => void; doc: SystemDoc }) {
  return <Pipeline title="Indexing" slots={INDEX_SLOTS} value={value} onChange={onChange} doc={doc} hint="How sources become searchable." />;
}

export function MemoryPolicyEditor({ value, onChange, doc }: { value: MemoryPolicy; onChange: (v: MemoryPolicy) => void; doc: SystemDoc }) {
  return <Pipeline title="Memory lifecycle" slots={MEMORY_SLOTS} value={value} onChange={onChange} doc={doc} hint="How turns become records, how conflicts resolve, how long they last." />;
}
