import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CanvasContext } from "@/canvas/context";
import { FlowView } from "@/canvas/FlowView";
import { TEMPLATES, type TemplateInfo } from "@/model/templates";
import { useSystems } from "@/store/systems";

function TemplateCard({ t }: { t: TemplateInfo }) {
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
        <p className="mt-0.5 text-xs text-muted-foreground">{t.summary}</p>
        {doc.description && <p className="mt-2 text-[13px] text-muted-foreground">{doc.description}</p>}
        <div className="mt-auto pt-4">
          <Button size="sm" onClick={() => navigate(`/canvas/${create(t.id).id}`)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Use this template
          </Button>
        </div>
      </div>
    </article>
  );
}

export function TemplatesPage() {
  return (
    <div className="h-full overflow-y-auto p-3 md:p-6">
      <div className="mx-auto grid max-w-6xl gap-3 md:grid-cols-2">
        {TEMPLATES.map((t) => (
          <TemplateCard key={t.id} t={t} />
        ))}
      </div>
    </div>
  );
}
