import type { FnLang, FunctionSpec, SystemDoc } from "@/model/types";
import { AreaField, opts, SelectField } from "../fields";

const LANG_HINT: Record<FnLang, string> = {
  template: "Handlebars-style template over input and ctx, e.g. {{input.text}}",
  jsonata: "JSONata expression over input, e.g. { \"winner\": input.verdict }",
  js: "Function body: (input, ctx) => output. Return null to drop. ctx = { run_id, node, edge, vars, now, tools }",
  python: "Function body: def f(input, ctx) -> output. Return None to drop.",
  llm: "A prompt; {{input}} is the incoming value. The reply is the output.",
};

/** One editor for every piece of user code: edge transforms, function nodes, stages, plugin hooks, access queries. */
export function FunctionEditor({
  label,
  fn,
  onChange,
  doc,
  rows = 5,
  hint,
}: {
  label: string;
  fn: FunctionSpec;
  onChange: (fn: FunctionSpec) => void;
  doc: SystemDoc;
  rows?: number;
  hint?: string;
}) {
  return (
    <div className="space-y-2 rounded-lg p-3 shadow-[0_0_0_1px_hsl(var(--border))]">
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <SelectField<FnLang>
          label=""
          value={fn.lang}
          onChange={(lang) => onChange({ ...fn, lang })}
          items={opts([
            ["template", "template"],
            ["jsonata", "jsonata"],
            ["js", "js"],
            ["python", "python"],
            ["llm", "llm"],
          ])}
        />
      </div>
      {fn.lang === "llm" && (
        <SelectField label="Model" value={fn.model ?? doc.models[0]?.id ?? ""} onChange={(model) => onChange({ ...fn, model })} items={doc.models.map((m) => ({ value: m.id, label: m.model }))} />
      )}
      <AreaField label="" value={fn.code} onChange={(code) => onChange({ ...fn, code })} rows={rows} mono hint={hint ?? LANG_HINT[fn.lang]} />
    </div>
  );
}

export const emptyFn = (lang: FnLang = "js", code = "return input;"): FunctionSpec => ({ lang, code });
