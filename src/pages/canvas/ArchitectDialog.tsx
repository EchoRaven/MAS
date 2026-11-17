// Describe a system in words and let the architect build it on the canvas.
// It uses the same editing operations a person has, and has to clear the
// validator and the contracts before it finishes.
import { useState } from "react";
import { CheckCircle2, CircleAlert, Sparkles, Wand2 } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { usd } from "@/lib/format";
import type { SystemDoc } from "@/model/types";
import { useServer } from "@/store/server";

interface DesignResult {
  doc: SystemDoc;
  log: { tool: string; args: string; result: string }[];
  summary: string;
  errors: string[];
  warnings: string[];
  usage: { tokens_in: number; tokens_out: number; usd: number };
}

const EXAMPLES = [
  "A team that researches a question: one agent plans the searches, several search in parallel, and one writes the answer with sources.",
  "Two agents that debate a claim for three rounds, then a judge decides which side was better supported.",
  "Triage incoming support emails: classify them, answer the simple ones, and hand anything about a refund to a person to approve.",
];

export function ArchitectDialog({ open, onClose, doc, onApply }: { open: boolean; onClose: () => void; doc?: SystemDoc; onApply: (doc: SystemDoc) => void }) {
  const connected = useServer((s) => s.status === "connected");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DesignResult | null>(null);

  const close = () => {
    setResult(null);
    setError("");
    onClose();
  };

  const run = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await api<DesignResult>("POST", "/design", { prompt, ...(doc ? { doc } : {}) }));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" /> {doc ? "Change this system" : "Design a system"}
          </DialogTitle>
          <DialogDescription>
            {doc
              ? "Say what to change. The architect edits this system and has to leave it valid."
              : "Say what the system should do. The architect builds it from the same components you would use, and has to clear every error before it finishes."}
          </DialogDescription>
        </DialogHeader>

        {!connected ? (
          <p className="rounded-lg bg-secondary px-3 py-2 text-[13px] text-muted-foreground">The architect runs on the server. Connect one under Settings first.</p>
        ) : (
          <>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder="What should it do?" aria-label="What the system should do" className="text-[13px]" />
            {!doc && !result && (
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((e) => (
                  <button key={e} type="button" onClick={() => setPrompt(e)} className="rounded-full bg-secondary px-2.5 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground">
                    {e.slice(0, 60)}…
                  </button>
                ))}
              </div>
            )}
            {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{error}</p>}
            {busy && <p className="text-[13px] text-muted-foreground">Designing… it adds the components, wires them, then fixes what the validator finds. This takes a minute.</p>}
            {result && (
              <div className="space-y-2">
                <p className="text-[13px]">{result.summary}</p>
                <p className={`flex items-center gap-1.5 text-[12px] ${result.errors.length ? "text-destructive" : "text-success"}`}>
                  {result.errors.length ? <CircleAlert className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {result.errors.length ? `${result.errors.length} error(s) left: ${result.errors[0]}` : "No errors"}
                  <span className="text-muted-foreground">
                    · {result.doc.nodes.length} components · {result.log.length} steps · {usd(result.usage.usd)}
                  </span>
                </p>
                <details className="rounded-lg bg-secondary/40 text-[12px] ring-1 ring-border/50">
                  <summary className="cursor-pointer px-3 py-2 text-muted-foreground hover:text-foreground">What it did ({result.log.length} steps)</summary>
                  <ol className="max-h-56 space-y-0.5 overflow-y-auto border-t border-border/50 px-3 py-2 font-mono text-[11px]">
                    {result.log.map((l, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="w-20 shrink-0 text-info">{l.tool}</span>
                        <span className="min-w-0 break-words text-muted-foreground">{l.result.split("\n")[0]}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          {result ? (
            <>
              <Button variant="outline" onClick={() => void run()} disabled={busy}>
                Try again
              </Button>
              <Button onClick={() => { onApply(result.doc); close(); }}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Put it on the canvas
              </Button>
            </>
          ) : (
            <Button onClick={() => void run()} disabled={!connected || busy || !prompt.trim()}>
              <Wand2 className="mr-1.5 h-3.5 w-3.5" /> {busy ? "Designing…" : "Design it"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
