import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { ExternalLink, PlayCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CanvasContext } from "@/canvas/context";
import { FlowView } from "@/canvas/FlowView";
import { TEMPLATES, type TemplateInfo } from "@/model/templates";
import { useSystems } from "@/store/systems";

function Notes({ t }: { t: TemplateInfo }) {
  if (!t.notes) return null;
  return (
    <details className="mt-3 rounded-lg bg-secondary/40 text-[12px] ring-1 ring-border/50">
      <summary className="cursor-pointer px-3 py-2 text-muted-foreground hover:text-foreground">How it is mapped · where it differs{t.notes.measured ? " · measured here" : ""}</summary>
      <div className="space-y-2 border-t border-border/50 px-3 py-2">
        <ul className="list-disc space-y-1 pl-4">
          {t.notes.mapped.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
        <p className="font-medium text-muted-foreground">Differs from the paper</p>
        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
          {t.notes.differs.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
        {t.notes.measured && (
          <>
            <p className="font-medium text-muted-foreground">Measured here</p>
            <ul className="list-disc space-y-1 pl-4">
              {t.notes.measured.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}

function TemplateCard({ t, hasDemo }: { t: TemplateInfo; hasDemo?: boolean }) {
  const doc = useMemo(() => t.build(), [t]);
  const create = useSystems((s) => s.create);
  const navigate = useNavigate();
  return (
    <article className="glass-panel flex flex-col overflow-hidden rounded-xl">
      <div className="h-56 border-b border-border/70 bg-background/50">
        {doc.nodes.length ? (
          <ReactFlowProvider>
            <CanvasContext.Provider value={{ modelLabel: (id) => doc.models.find((m) => m.id === id)?.model ?? id }}>
              <FlowView doc={doc} readOnly />
            </CanvasContext.Provider>
          </ReactFlowProvider>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Empty canvas</div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h2 className="font-semibold">{t.name}</h2>
        {t.paper && (
          <a href={t.paper.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-start gap-1 text-[12px] text-info hover:underline">
            <span>
              {t.paper.title} — {t.paper.authors}, {t.paper.year}
            </span>
            <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
          </a>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">{t.summary}</p>
        {doc.description && <p className="mt-2 text-[13px] text-muted-foreground">{doc.description}</p>}
        <Notes t={t} />
        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          <Button size="sm" onClick={() => navigate(`/canvas/${create(t.id).id}`)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Use this template
          </Button>
          {hasDemo && (
            <Button size="sm" variant="outline" onClick={() => navigate(`/demos/${t.id}`)}>
              <PlayCircle className="mr-1.5 h-3.5 w-3.5" /> Watch it run
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function Shelf({ title, subtitle, items, demos }: { title: string; subtitle: string; items: TemplateInfo[]; demos?: Set<string> }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-[13px] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((t) => (
          <TemplateCard key={t.id} t={t} hasDemo={demos?.has(t.id)} />
        ))}
      </div>
    </section>
  );
}

export function TemplatesPage() {
  const papers = TEMPLATES.filter((t) => t.paper);
  const [demos, setDemos] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch("/demos/index.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string }[]) => setDemos(new Set(list.map((d) => d.id))))
      .catch(() => undefined);
  }, []);
  return (
    <div className="h-full overflow-y-auto p-3 md:p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <Shelf
          title={`From papers (${papers.length})`}
          subtitle="Published multi-agent systems rebuilt from the framework's components, each with its mapping and where it departs from the paper. Where a recording exists, you can watch the system actually run."
          items={papers}
          demos={demos}
        />
        <Shelf title="Patterns" subtitle="Starting points for common architectures." items={TEMPLATES.filter((t) => !t.paper)} />
      </div>
    </div>
  );
}
