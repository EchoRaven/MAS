import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { nodeName } from "@/model/ports";
import type { SystemDoc } from "@/model/types";

/** Where you are: the system, the groups you opened, and an agent's internals. */
export function Breadcrumb({ doc, scope, agent, onScope }: { doc: SystemDoc; scope?: string; agent?: string; onScope: (scope: string | undefined) => void }) {
  const chain: string[] = [];
  for (let s = scope; s; s = doc.nodes.find((n) => n.id === s)?.parent) chain.unshift(s);
  const crumbs: { label: string; scope: string | undefined; current: boolean }[] = [
    { label: doc.name, scope: undefined, current: !scope && !agent },
    ...chain.map((id, i) => ({ label: nodeName(doc.nodes.find((n) => n.id === id)), scope: id, current: !agent && i === chain.length - 1 })),
  ];
  if (agent) crumbs.push({ label: `${nodeName(doc.nodes.find((n) => n.id === agent))} · internals`, scope, current: true });
  if (crumbs.length === 1) return null;
  return (
    <nav aria-label="Location" className="flex min-w-0 items-center gap-1 text-xs">
      {crumbs.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
          <button
            type="button"
            disabled={c.current}
            onClick={() => onScope(c.scope)}
            className={cn("truncate rounded px-1.5 py-0.5", c.current ? "font-medium text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
          >
            {c.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
