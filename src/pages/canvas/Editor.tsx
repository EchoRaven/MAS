import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useReactFlow } from "@xyflow/react";
import { Code2, Download, PanelRightClose, PanelRightOpen, PlayCircle, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AgentView } from "@/canvas/agent/AgentView";
import { CanvasContext } from "@/canvas/context";
import { FlowView } from "@/canvas/FlowView";
import { ImportDialog } from "@/canvas/ImportDialog";
import { Inspector } from "@/canvas/inspector";
import { addNode } from "@/canvas/ops";
import { Palette, type ImportKind } from "@/canvas/Palette";
import { downloadText, slug } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AgentData, NodeData, NodeKind, Processor, SystemDoc } from "@/model/types";
import { validate } from "@/model/validate";
import { toYaml } from "@/model/yaml";
import { useSystems } from "@/store/systems";
import { Breadcrumb } from "./Breadcrumb";
import { IssuesMenu } from "./IssuesMenu";
import { useEditorNav } from "./useEditorNav";
import { YamlView } from "./YamlView";

function ViewSwitch({ view, setView }: { view: "canvas" | "yaml"; setView: (v: "canvas" | "yaml") => void }) {
  return (
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
  );
}

export function Editor({ doc }: { doc: SystemDoc }) {
  const navigate = useNavigate();
  const systems = useSystems((s) => s.systems);
  const updateStore = useSystems((s) => s.update);
  const replace = useSystems((s) => s.replace);
  const rf = useReactFlow();
  const [view, setView] = useState<"canvas" | "yaml">("canvas");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [importing, setImporting] = useState<ImportKind | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const nav = useEditorNav(doc);

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
  const modelLabel = useCallback((id: string) => doc.models.find((m) => m.id === id)?.model ?? id, [doc.models]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  const center = () => {
    const r = document.querySelector(".react-flow")?.getBoundingClientRect();
    return r ? rf.screenToFlowPosition({ x: r.left + r.width / 2 - 110, y: r.top + r.height / 2 - 45 }) : { x: 100, y: 100 };
  };
  const add = (items: { kind: NodeKind; data?: NodeData }[]) => {
    nav.closeAgent();
    let last = "";
    update((d) => {
      let cur = d;
      for (const it of items) {
        const r = addNode(cur, it.kind, center(), nav.scope, it.data);
        cur = r.doc;
        last = r.id;
      }
      return cur;
    });
    if (last) nav.setSel({ nodeId: last });
    setInspectorOpen(true);
  };

  const agentNode = nav.agent ? doc.nodes.find((n) => n.id === nav.agent) : undefined;
  const addStage = (which: "pre" | "post") => {
    if (!nav.agent) return;
    const stage: Processor = which === "pre" ? { id: `s${Date.now() % 100000}`, op: "redact", name: "Redact", fn: null } : { id: `s${Date.now() % 100000}`, op: "parse_json", name: "Parse JSON", schema: null, on_fail: "retry", max_retries: 2 };
    const a = agentNode!.data as AgentData;
    const index = a.pipeline[which].length;
    update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === nav.agent ? { ...n, data: { ...a, pipeline: { ...a.pipeline, [which]: [...a.pipeline[which], stage] } } } : n)) }));
    nav.selectPart(`${which}:${index}`);
    setInspectorOpen(true);
  };

  return (
    <CanvasContext.Provider value={{ modelLabel }}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
          <Select value={doc.id} onValueChange={(id) => navigate(`/canvas/${id}`)} items={systems.map((s) => ({ value: s.id, label: s.name }))} ariaLabel="Select system" className="max-w-56" />
          <ViewSwitch view={view} setView={setView} />
          <IssuesMenu doc={doc} issues={issues} onPick={(i) => { setView("canvas"); nav.pickIssue(i); setInspectorOpen(true); }} />
          <div className="ml-auto flex gap-1.5">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => downloadText(`${slug(doc.name)}.mas.yaml`, toYaml(doc))} aria-label="Export YAML" title="Export YAML">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setInspectorOpen(!inspectorOpen)} aria-label={inspectorOpen ? "Hide inspector" : "Show inspector"} title={inspectorOpen ? "Hide inspector" : "Show inspector"}>
              {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
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
            <Palette onAdd={(kind, data) => add([{ kind, data }])} onImport={setImporting} className="w-14 shrink-0 border-r border-border/70" />
            <div className="relative min-w-0 flex-1">
              <div className="pointer-events-none absolute inset-x-3 top-2 z-10 flex">
                <div className="pointer-events-auto rounded-lg bg-card/90 backdrop-blur empty:hidden">
                  <Breadcrumb doc={doc} scope={nav.scope} agent={nav.agent} onScope={nav.setScope} />
                </div>
              </div>
              {agentNode ? (
                <AgentView key={agentNode.id} doc={doc} id={agentNode.id} a={agentNode.data as AgentData} selected={nav.part} onPart={(p) => { nav.selectPart(p); setInspectorOpen(true); }} onAddStage={addStage} />
              ) : (
                <FlowView
                  doc={doc}
                  scope={nav.scope}
                  update={update}
                  issueCounts={issueCounts}
                  onSelect={(s) => {
                    nav.setSel(s);
                    if (s.nodeId || s.edgeId) setInspectorOpen(true);
                  }}
                  onOpen={nav.open}
                  onError={flash}
                />
              )}
              {toast && <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-foreground px-4 py-1.5 text-xs text-background shadow-[var(--pop-shadow)]">{toast}</div>}
            </div>
            {inspectorOpen && (
              <aside className="w-[340px] shrink-0 border-l border-border/70 max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-20 max-md:w-[min(340px,92vw)] max-md:bg-card max-md:shadow-[var(--pop-shadow)]">
                <Inspector
                  doc={doc}
                  update={update}
                  nodeId={nav.sel.nodeId}
                  edgeId={nav.sel.edgeId}
                  scope={nav.scope}
                  issues={issues}
                  agentTab={nav.agentTab}
                  onAgentTab={nav.setAgentTab}
                  stageFocus={nav.stageFocus}
                  onClose={() => (nav.sel.nodeId || nav.sel.edgeId ? nav.setSel({}) : setInspectorOpen(false))}
                  onSelect={nav.setSel}
                  onPickIssue={nav.pickIssue}
                  onOpen={nav.open}
                />
              </aside>
            )}
          </div>
        )}
      </div>
      <ImportDialog kind={importing} onClose={() => setImporting(null)} onImport={(items) => { add(items); flash(`Added ${items.length} component${items.length > 1 ? "s" : ""}`); }} />
    </CanvasContext.Provider>
  );
}
