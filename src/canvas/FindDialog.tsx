// Find a component by name, at any depth of groups: "/" on the canvas. Choosing one opens its group's level, selects
// it and centres the view on it.
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SystemDoc } from "@/model/types";

const nameOf = (data: unknown) => String((data as { name?: string }).name ?? "");

export function FindDialog({ doc, open, onOpenChange, onPick }: { doc: SystemDoc; open: boolean; onOpenChange: (v: boolean) => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const byId = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes]);
  // the groups a node sits in, outermost first, so two components with one name can be told apart
  const path = (id: string) => {
    const out: string[] = [];
    for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) out.unshift(nameOf(byId.get(p)?.data));
    return out.join(" › ");
  };
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return doc.nodes
      .filter((n) => nameOf(n.data).toLowerCase().includes(t) || n.id.toLowerCase() === t)
      .sort((a, b) => Number(!nameOf(a.data).toLowerCase().startsWith(t)) - Number(!nameOf(b.data).toLowerCase().startsWith(t)))
      .slice(0, 10);
  }, [q, doc.nodes]);
  const pick = (id: string) => {
    onOpenChange(false);
    setQ("");
    onPick(id);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setQ("");
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Find a component</DialogTitle>
          <DialogDescription>By name, inside groups too. Enter goes to the first match.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={q}
          placeholder="Name…"
          aria-label="Component name"
          onChange={(e) => {
            setQ(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setAt((i) => Math.min(i + 1, hits.length - 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setAt((i) => Math.max(i - 1, 0)));
            if (e.key === "Enter" && hits[at]) (e.preventDefault(), pick(hits[at].id));
          }}
        />
        {q.trim() && !hits.length && <p className="text-xs text-muted-foreground">No component by that name.</p>}
        <ul className="space-y-0.5">
          {hits.map((n, i) => (
            <li key={n.id}>
              <button
                className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary ${i === at ? "bg-secondary" : ""}`}
                onClick={() => pick(n.id)}
              >
                <span>
                  {nameOf(n.data) || n.id}
                  {path(n.id) && <span className="ml-2 text-xs text-muted-foreground">in {path(n.id)}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{n.data.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
