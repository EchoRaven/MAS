import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { AlertTriangle, Check, CircleAlert, Code2, Download, PlayCircle, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { downloadText, slug } from "@/lib/format";
import { CanvasContext } from "@/canvas/context";
import { FlowView, addNode, freeSpot } from "@/canvas/FlowView";
import { Inspector } from "@/canvas/Inspector";
import { Palette } from "@/canvas/Palette";
import type { NodeKind, SystemDoc } from "@/model/types";
import { validate } from "@/model/validate";
import { fromYaml, toYaml } from "@/model/yaml";
import { useSystems } from "@/store/systems";

function YamlView({ doc, onApply }: { doc: SystemDoc; onApply: (d: SystemDoc) => void }) {
  const original = useMemo(() => toYaml(doc), [doc]);
  const [text, setText] = useState(original);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(original), [original]);
  const dirty = text !== original;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">The canvas and this YAML are the same definition. Edit here and click Apply to update the canvas.</p>
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

function Editor({ doc }: { doc: SystemDoc }) {
  const navigate = useNavigate();
  const systems = useSystems((s) => s.systems);
  const updateStore = useSystems((s) => s.update);
  const replace = useSystems((s) => s.replace);
  const rf = useReactFlow();
  const [view, setView] = useState<"canvas" | "yaml">("canvas");
  const [sel, setSel] = useState<{ nodeId?: string; edgeId?: string }>({});
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const update = useCallback((fn: (d: SystemDoc) => SystemDoc) => updateStore(doc.id, fn), [updateStore, doc.id]);
  const issues = useMemo(() => validate(doc), [doc]);
  const issueCounts = useMemo(() => {
    const nodes: Record<string, number> = {};
    const edges: Record<string, number> = {};
    for (const i of issues) {
      if (i.severity === "info") continue;
      if (i.nodeId) nodes[i.nodeId] = (nodes[i.nodeId] ?? 0) + 1;
      if (i.edgeId) edges[i.edgeId] = (edges[i.edgeId] ?? 0) + 1;
    }
    return { nodes, edges };
  }, [issues]);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const modelLabel = useCallback((id: string) => doc.models.find((m) => m.id === id)?.model ?? id, [doc.models]);

  const onAdd = (kind: NodeKind) => {
    const el = document.querySelector(".react-flow");
    const r = el?.getBoundingClientRect();
    const p = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 100, y: 100 };
    let id = "";
    update((d) => {
      const res = addNode(d, kind, kind === "group" ? { x: Math.round(p.x - 240), y: Math.round(p.y - 150) } : freeSpot(d, { x: p.x - 110, y: p.y - 45 }));
      id = res.id;
      return res.doc;
    });
    setSel({ nodeId: id });
    setInspectorOpen(true);
  };

  // a deleted selection closes back to system settings
  const selValid = (sel.nodeId && doc.nodes.some((n) => n.id === sel.nodeId)) || (sel.edgeId && doc.edges.some((e) => e.id === sel.edgeId));
  const current = selValid ? sel : {};

  return (
    <CanvasContext.Provider value={{ modelLabel }}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2 md:px-4">
          <Select
            value={doc.id}
            onValueChange={(id) => navigate(`/canvas/${id}`)}
            items={systems.map((s) => ({ value: s.id, label: s.name }))}
            ariaLabel="Select system"
            className="max-w-64"
          />
          <div className="flex rounded-full bg-secondary p-0.5" role="tablist" aria-label="View">
            {(
              [
                ["canvas", "Canvas", Workflow],
                ["yaml", "YAML", Code2],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors", view === v ? "bg-card shadow-[var(--ring-shadow)]" : "text-muted-foreground hover:text-foreground")}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setSel({});
              setInspectorOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs hover:bg-secondary"
            title="View all check results"
          >
            {errors > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <CircleAlert className="h-3.5 w-3.5" /> {errors}
              </span>
            )}
            {warnings > 0 && (
              <span className="flex items-center gap-1 text-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> {warnings}
              </span>
            )}
            {errors + warnings === 0 && (
              <span className="flex items-center gap-1 text-success">
                <Check className="h-3.5 w-3.5" /> No issues
              </span>
            )}
          </button>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadText(`${slug(doc.name)}.mas.yaml`, toYaml(doc))}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
            <Button size="sm" asChild>
              <Link to={`/runs/${doc.id}`}>
                <PlayCircle className="mr-1.5 h-3.5 w-3.5" /> Simulate
              </Link>
            </Button>
          </div>
        </div>

        {view === "yaml" ? (
          <YamlView doc={doc} onApply={(d) => replace(d)} />
        ) : (
          <div className="flex min-h-0 flex-1">
            <Palette onAdd={onAdd} className="hidden w-48 shrink-0 border-r border-border/70 xl:flex" />
            <div className="relative min-w-0 flex-1">
              <FlowView
                doc={doc}
                update={update}
                issueCounts={issueCounts}
                onSelect={(s) => {
                  setSel(s);
                  if (s.nodeId || s.edgeId) setInspectorOpen(true);
                }}
              />
              {!inspectorOpen && (
                <Button variant="outline" size="sm" className="absolute right-3 top-3" onClick={() => setInspectorOpen(true)}>
                  Open inspector
                </Button>
              )}
            </div>
            {inspectorOpen && (
              <aside className="w-[330px] shrink-0 border-l border-border/70 max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-10 max-md:w-[min(340px,92vw)] max-md:bg-card max-md:shadow-[var(--pop-shadow)]">
                <Inspector doc={doc} update={update} nodeId={current.nodeId} edgeId={current.edgeId} issues={issues} onClose={() => (current.nodeId || current.edgeId ? setSel({}) : setInspectorOpen(false))} />
              </aside>
            )}
          </div>
        )}
      </div>
    </CanvasContext.Provider>
  );
}

export function CanvasPage() {
  const { systemId } = useParams();
  const systems = useSystems((s) => s.systems);
  if (!systemId) {
    if (systems.length) return <Navigate to={`/canvas/${systems[0].id}`} replace />;
    return <Navigate to="/" replace />;
  }
  const doc = systems.find((s) => s.id === systemId);
  if (!doc) return <Navigate to="/" replace />;
  return (
    <ReactFlowProvider key={doc.id}>
      <Editor doc={doc} />
    </ReactFlowProvider>
  );
}
