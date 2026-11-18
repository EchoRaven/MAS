// The Architect as an assistant: a panel beside the canvas where you describe a
// system in a conversation. Each message designs (or, after the first, changes)
// the system; every reply shows what it built and can be put on the canvas.
// It uses the same editing operations a person has, and has to clear the
// validator before it finishes.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUp, CheckCircle2, CircleAlert, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

type Turn = { role: "user"; text: string } | { role: "assistant"; result: DesignResult; applied?: boolean } | { role: "error"; text: string };

const EXAMPLES = [
  "A research team: one agent plans the searches, several search in parallel, and one writes the answer with sources.",
  "Two agents debate a claim for three rounds, then a judge decides which side was better supported.",
  "Triage support emails: classify them, answer the simple ones, and send anything about a refund to a person to approve.",
];

const WORKING = ["Reading what you asked…", "Adding the components…", "Wiring them together…", "Checking it with the validator…", "Fixing what the validator found…"];

export function ArchitectPanel({ open, onClose, doc, onApply }: { open: boolean; onClose: () => void; doc?: SystemDoc; onApply: (doc: SystemDoc) => void }) {
  const status = useServer((s) => s.status);
  const connected = status === "connected";
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // the design the next message changes: the latest one in this conversation, else the system that is open
  const latest = [...turns].reverse().find((t): t is Extract<Turn, { role: "assistant" }> => t.role === "assistant")?.result.doc;
  const base = latest ?? doc;

  useEffect(() => {
    if (open) window.setTimeout(() => input.current?.focus(), 50);
  }, [open]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);
  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, WORKING.length - 1)), 9000);
    return () => window.clearInterval(t);
  }, [busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const send = async (message = text) => {
    const prompt = message.trim();
    if (!prompt || busy || !connected) return;
    setText("");
    setTurns((t) => [...t, { role: "user", text: prompt }]);
    setBusy(true);
    try {
      const result = await api<DesignResult>("POST", "/design", { prompt, ...(base ? { doc: base } : {}) });
      setTurns((t) => [...t, { role: "assistant", result }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "error", text: (e as Error).message }]);
    }
    setBusy(false);
    window.setTimeout(() => input.current?.focus(), 50);
  };

  const apply = (i: number) => {
    const t = turns[i];
    if (t.role !== "assistant") return;
    onApply(t.result.doc);
    setTurns((ts) => ts.map((x, j) => (j === i && x.role === "assistant" ? { ...x, applied: true } : x)));
  };

  if (!open) return null;
  return (
    <aside aria-label="Architect" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[440px] flex-col border-l border-border bg-background shadow-2xl">
      <header className="flex items-center gap-2.5 border-b border-border/70 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Wand2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">Architect</p>
          <p className="truncate text-[11px] text-muted-foreground">{doc ? `Working on “${doc.name}”` : "Designs a multi-agent system from a description"}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close the architect" disabled={busy}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div ref={list} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!connected ? (
          <div className="rounded-xl bg-secondary/60 p-4 text-[13px]">
            <p className="font-medium">The architect needs the server</p>
            <p className="mt-1 text-muted-foreground">It designs systems by calling a model on the server, so this browser has to be connected to it first.</p>
            <Button asChild size="sm" className="mt-3">
              <Link to="/settings">Connect in Settings</Link>
            </Button>
          </div>
        ) : turns.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-secondary/50 px-4 py-3 text-[13px] leading-relaxed">
              {doc ? (
                <>Tell me what to change in <span className="font-medium">{doc.name}</span>: add a reviewer, split a step into two agents, give an agent a tool… I edit the system and keep it valid.</>
              ) : (
                <>Describe the system you want: who the agents are, what each does, and how work moves between them. I build it from the same components you would use, check it, and you can keep refining it here.</>
              )}
            </div>
            {!doc && (
              <div className="space-y-1.5">
                <p className="px-1 text-[11px] text-muted-foreground">Or start from one of these:</p>
                {EXAMPLES.map((e) => (
                  <button key={e} type="button" onClick={() => void send(e)} className="block w-full rounded-lg border border-border/70 px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-secondary/50 hover:text-foreground">
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] text-primary-foreground">{t.text}</p>
              </div>
            ) : t.role === "error" ? (
              <p key={i} className="rounded-xl bg-destructive/10 px-3.5 py-2 text-[13px] text-destructive" role="alert">
                {t.text}
              </p>
            ) : (
              <div key={i} className="space-y-2">
                <div className="rounded-2xl rounded-bl-md bg-secondary/60 px-3.5 py-2.5 text-[13px] leading-relaxed">
                  <p className="whitespace-pre-wrap">{t.result.summary}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px]">
                  <span className={cn("flex items-center gap-1", t.result.errors.length ? "text-destructive" : "text-success")}>
                    {t.result.errors.length ? <CircleAlert className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {t.result.errors.length ? `${t.result.errors.length} problem${t.result.errors.length > 1 ? "s" : ""} left` : "Checks pass"}
                  </span>
                  <span className="text-muted-foreground">
                    {t.result.doc.nodes.length} components · {t.result.doc.edges.length} connections · {usd(t.result.usage.usd)}
                  </span>
                </div>
                {t.result.errors.length > 0 && <p className="px-1 text-[11px] text-destructive">{t.result.errors[0]}</p>}
                <div className="flex items-center gap-2 px-1">
                  <Button size="sm" className="h-7" onClick={() => apply(i)} disabled={t.applied}>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {t.applied ? "On the canvas" : doc ? "Apply to the canvas" : "Put it on the canvas"}
                  </Button>
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What I did ({t.result.log.length} steps)</summary>
                    <ol className="mt-1.5 max-h-48 space-y-0.5 overflow-y-auto rounded-lg bg-secondary/40 p-2 font-mono text-[10.5px]">
                      {t.result.log.map((l, k) => (
                        <li key={k} className="flex gap-2">
                          <span className="w-16 shrink-0 text-info">{l.tool}</span>
                          <span className="min-w-0 break-words text-muted-foreground">{l.result.split("\n")[0]}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                </div>
              </div>
            ),
          )
        )}
        {busy && (
          <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-secondary/60 px-3.5 py-2.5 text-[13px] text-muted-foreground" aria-live="polite">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {WORKING[step]}
          </div>
        )}
      </div>

      {connected && (
        <form
          className="border-t border-border/70 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
            <textarea
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a new line; Enter while an input method is composing (Chinese, Japanese…) picks the word
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={Math.min(6, Math.max(1, text.split("\n").length))}
              placeholder={latest ? "Ask for a change…" : doc ? "What should change?" : "Describe the system you want…"}
              aria-label="Message to the architect"
              className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground"
              disabled={busy}
            />
            <Button type="submit" size="icon" className="h-7 w-7 shrink-0 rounded-full" disabled={busy || !text.trim()} aria-label="Send">
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1.5 px-1 text-[10.5px] text-muted-foreground">Enter to send · Shift+Enter for a new line · each design takes about a minute</p>
        </form>
      )}
    </aside>
  );
}
