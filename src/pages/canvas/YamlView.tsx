import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SystemDoc } from "@/model/types";
import { fromYaml, toYaml } from "@/model/yaml";

/** The same definition as text. Apply parses it back; a bad file leaves the system untouched. */
export function YamlView({ doc, onApply }: { doc: SystemDoc; onApply: (d: SystemDoc) => void }) {
  const original = useMemo(() => toYaml(doc), [doc]);
  const [text, setText] = useState(original);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(original), [original]);
  const dirty = text !== original;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" disabled={!dirty} onClick={() => { setText(original); setError(null); }}>
            Revert
          </Button>
          <Button
            size="sm"
            disabled={!dirty}
            onClick={() => {
              try {
                onApply(fromYaml(text, doc.id));
                setError(null);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" /> Apply
          </Button>
        </div>
      </div>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="System YAML" className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed" />
    </div>
  );
}
