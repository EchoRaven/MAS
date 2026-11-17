// Edit any component's or edge's definition as YAML: full freedom for
// anything the forms do not cover. Apply replaces it if the text parses and
// keeps its kind (and, for edges, its ends).
import { useEffect, useMemo, useState } from "react";
import YAML from "yaml";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Body } from "./shared";

export function YamlTab<T extends object>({ value, onApply, guard }: { value: T; onApply: (v: T) => void; guard?: (next: T) => string | null }) {
  const original = useMemo(() => YAML.stringify(JSON.parse(JSON.stringify(value)), { lineWidth: 0 }), [value]);
  const [text, setText] = useState(original);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(original), [original]);
  const dirty = text !== original;
  const apply = () => {
    try {
      const next = YAML.parse(text) as T;
      if (!next || typeof next !== "object" || Array.isArray(next)) throw new Error("Expected a mapping");
      const why = guard?.(next);
      if (why) throw new Error(why);
      onApply(next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Body className="flex flex-col">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">Everything about it, including what the forms do not show.</p>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={!dirty} onClick={() => { setText(original); setError(null); }}>
            Revert
          </Button>
          <Button size="sm" className="h-7 text-xs" disabled={!dirty} onClick={apply}>
            <Check className="mr-1 h-3 w-3" /> Apply
          </Button>
        </div>
      </div>
      {error && <p className="rounded-md bg-destructive/[0.08] px-2.5 py-1.5 text-[12px] text-destructive">{error}</p>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Definition YAML"
        className="prop-field min-h-[420px] w-full flex-1 resize-none px-2.5 py-2 font-mono text-[11px] leading-relaxed"
      />
    </Body>
  );
}
