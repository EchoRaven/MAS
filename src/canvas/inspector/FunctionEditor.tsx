import { Select } from "@/components/ui/select";
import type { FnLang, FunctionSpec, SystemDoc } from "@/model/types";
import { Hint } from "../fields";

const LANG_HINT: Record<FnLang, string> = {
  template: "Handlebars-style template over input and ctx, e.g. {{input.text}}",
  jsonata: 'JSONata expression over input, e.g. { "winner": input.verdict }',
  js: "Function body: (input, ctx) => output. Return null to drop. ctx = { run_id, node, edge, vars, now, tools }",
  python: "Function body: def f(input, ctx) -> output. Return None to drop.",
  llm: "A prompt; {{input}} is the incoming value. The reply is the output.",
};

const LANGS: FnLang[] = ["template", "jsonata", "js", "python", "llm"];

/** One editor for every piece of user code: edge transforms, function nodes, stages, plugin hooks, access queries. */
export function FunctionEditor({ label, fn, onChange, doc, rows = 5, hint }: { label: string; fn: FunctionSpec; onChange: (fn: FunctionSpec) => void; doc: SystemDoc; rows?: number; hint?: string }) {
  return (
    <div className="overflow-hidden rounded-lg bg-secondary/50 ring-1 ring-border/60 focus-within:ring-ring/40">
      <div className="flex items-center gap-1.5 border-b border-border/60 py-1 pl-2.5 pr-1">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">{label}</span>
        <Hint>{hint ?? LANG_HINT[fn.lang]}</Hint>
        {fn.lang === "llm" && (
          <Select
            variant="field"
            size="sm"
            value={fn.model ?? doc.models[0]?.id ?? ""}
            onValueChange={(model) => onChange({ ...fn, model })}
            items={doc.models.filter((m) => (m.kind ?? "chat") === "chat").map((m) => ({ value: m.id, label: m.id }))}
            ariaLabel={`${label} model`}
            className="w-auto !bg-transparent hover:!bg-secondary"
          />
        )}
        <Select
          variant="field"
          size="sm"
          value={fn.lang}
          onValueChange={(lang) => onChange({ ...fn, lang: lang as FnLang })}
          items={LANGS.map((l) => ({ value: l, label: l }))}
          ariaLabel={`${label} language`}
          className="w-auto font-mono !bg-transparent hover:!bg-secondary"
        />
      </div>
      <textarea
        value={fn.code}
        rows={rows}
        spellCheck={false}
        aria-label={label}
        onChange={(e) => onChange({ ...fn, code: e.target.value })}
        className="block w-full resize-y bg-transparent px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );
}

export const emptyFn = (lang: FnLang = "js", code = "return input;"): FunctionSpec => ({ lang, code });
