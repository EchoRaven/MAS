import { useMemo, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { NodeData, NodeKind, SystemDoc } from "@/model/types";
import { ConformanceReport } from "./ConformanceReport";
import { IMPORT_COPY, parseImport, type ImportKind, type Parsed } from "./importers";

/**
 * Import an agent, environment, plugin or function. Whatever the source
 * format, it is converted to the platform's contract and checked against it;
 * only candidates that conform can be added.
 */
export function ImportDialog({ kind, doc, onClose, onImport }: { kind: ImportKind | null; doc?: SystemDoc; onClose: () => void; onImport: (items: { kind: NodeKind; data: NodeData }[]) => void }) {
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("pasted");
  /** null = every conforming candidate is chosen */
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const copy = kind ? IMPORT_COPY[kind] : null;

  const result = useMemo((): { ok: Parsed } | { error: string } | null => {
    if (!kind || !text.trim()) return null;
    try {
      return { ok: parseImport(kind, text, filename, doc) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [kind, text, filename, doc]);

  const close = () => {
    setText("");
    setChosen(null);
    onClose();
  };
  const isChosen = (i: number) => chosen === null || chosen.has(i);
  const candidates = result && "ok" in result ? result.ok.candidates : [];
  const picks = candidates.filter((c, i) => isChosen(i) && c.conformance.passed);
  const blocked = candidates.filter((c) => !c.conformance.passed).length;

  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>Accepts: {copy?.formats.join(" · ")}. Everything is checked against the platform contract before it can be added.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs shadow-[var(--ring-shadow)] hover:bg-secondary">
            <FileUp className="h-3.5 w-3.5" /> Choose file
            <input
              type="file"
              accept={copy?.accepts}
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFilename(f.name);
                setText(await f.text());
                setChosen(null);
              }}
            />
          </label>
          <span className="text-xs text-muted-foreground">or paste below</span>
          <button type="button" className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => { setFilename(kind === "function" ? "example.yaml" : "example"); setText(copy?.example ?? ""); }}>
            Use an example
          </button>
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} spellCheck={false} aria-label="Import text" className="font-mono text-xs" />
        {result && "error" in result && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{result.error}</p>}
        {result && "ok" in result && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Detected <span className="font-medium text-foreground">{result.ok.detected}</span>
              {result.ok.notes.length > 0 && <> · {result.ok.notes.join(" · ")}</>}
            </p>
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {candidates.map((c, i) => (
                <li key={i} className="space-y-1.5 rounded-lg p-2.5 shadow-[0_0_0_1px_hsl(var(--border))]">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    {candidates.length > 1 && (
                      <input
                        type="checkbox"
                        checked={isChosen(i) && c.conformance.passed}
                        disabled={!c.conformance.passed}
                        onChange={(e) =>
                          setChosen((s) => {
                            const n = new Set(s ?? candidates.map((_, j) => j));
                            if (e.target.checked) n.add(i);
                            else n.delete(i);
                            return n;
                          })
                        }
                      />
                    )}
                    {c.label}
                  </label>
                  <ConformanceReport c={c.conformance} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter className="items-center">
          {blocked > 0 && <span className="mr-auto text-[12px] text-destructive">{blocked} cannot be added until {blocked > 1 ? "they conform" : "it conforms"}</span>}
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!picks.length} onClick={() => { onImport(picks.map((c) => ({ kind: c.kind, data: c.data }))); close(); }}>
            Add {picks.length > 1 ? `${picks.length} ` : ""}to canvas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
