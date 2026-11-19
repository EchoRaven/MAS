import { useState } from "react";
import { Code2, Maximize2 } from "lucide-react";
import { nodeName } from "@/model/ports";
import type { AgentData, EnvData, FunctionNodeData, GroupData, HumanData, ModelNodeData, NodeData, PluginData, SysEdge, SystemDoc } from "@/model/types";
import type { Issue } from "@/model/validate";
import { EDGE_LABEL } from "../convert";
import { EDGE_STYLE, KIND_STYLE } from "../kinds";
import { deleteNodes } from "../ops";
import { AgentInspector, type AgentTab } from "./AgentInspector";
import { FunctionInspector, GroupInspector, HumanInspector, ModelInspector } from "./ComponentInspectors";
import { EdgeInspector } from "./EdgeInspector";
import { EnvInspector } from "./EnvInspector";
import { PluginInspector } from "./PluginInspector";
import { Header, IconButton, IssueList, KindIcon, type Update } from "./shared";
import { SystemInspector } from "./SystemInspector";
import { YamlTab } from "./YamlTab";

export type { AgentTab } from "./AgentInspector";

export interface InspectorProps {
  doc: SystemDoc;
  update: Update;
  nodeId?: string;
  edgeId?: string;
  scope?: string;
  issues: Issue[];
  agentTab: AgentTab;
  onAgentTab: (t: AgentTab) => void;
  stageFocus?: string;
  onClose: () => void;
  onSelect: (sel: { nodeId?: string; edgeId?: string }) => void;
  onPickIssue: (i: Issue) => void;
  onOpen: (nodeId: string) => void;
}

function NodeBody({ id, data, p }: { id: string; data: NodeData; p: InspectorProps }) {
  const set = (patch: Partial<NodeData>) => p.update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } as NodeData } : n)) }));
  switch (data.kind) {
    case "agent":
      return <AgentInspector key={id} id={id} a={data as AgentData} doc={p.doc} set={set} update={p.update} tab={p.agentTab} onTab={p.onAgentTab} stageFocus={p.stageFocus} onSelectEdge={(edgeId) => p.onSelect({ edgeId })} />;
    case "model":
      return <ModelInspector key={id} id={id} m={data as ModelNodeData} doc={p.doc} set={set} update={p.update} />;
    case "function":
      return <FunctionInspector key={id} id={id} f={data as FunctionNodeData} doc={p.doc} set={set} update={p.update} />;
    case "human":
      return <HumanInspector h={data as HumanData} set={set} />;
    case "group":
      return <GroupInspector key={id} id={id} g={data as GroupData} doc={p.doc} set={set} update={p.update} onOpen={() => p.onOpen(id)} />;
    case "env":
      return <EnvInspector id={id} e={data as EnvData} doc={p.doc} set={set} />;
    case "plugin":
      return <PluginInspector id={id} p={data as PluginData} doc={p.doc} set={(next) => set(next)} />;
  }
}

export function Inspector(p: InspectorProps) {
  // keyed by selection so the code view closes when something else is picked
  return <InspectorBody key={p.nodeId ?? p.edgeId ?? "system"} {...p} />;
}

function CodeToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <IconButton label={on ? "Back to the form" : "Edit as YAML"} onClick={() => set(!on)}>
      <Code2 className={on ? "h-3.5 w-3.5 text-foreground" : "h-3.5 w-3.5"} />
    </IconButton>
  );
}

function InspectorBody(p: InspectorProps) {
  const { doc, update, nodeId, edgeId, issues, onClose } = p;
  const [code, setCode] = useState(false);
  const node = nodeId ? doc.nodes.find((n) => n.id === nodeId) : undefined;
  const edge = edgeId ? doc.edges.find((e) => e.id === edgeId) : undefined;

  if (node) {
    const name = nodeName(node);
    const own = issues.filter((i) => i.nodeId === node.id);
    const openable = node.data.kind === "group" || node.data.kind === "agent";
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Header
          title={name}
          subtitle={
            <>
              {KIND_STYLE[node.data.kind].label} · <span className="font-mono">{node.id}</span>
            </>
          }
          icon={<KindIcon icon={KIND_STYLE[node.data.kind].icon} tint={KIND_STYLE[node.data.kind].tint} />}
          actions={
            <>
              <CodeToggle on={code} set={setCode} />
              {openable && (
                <IconButton label={node.data.kind === "group" ? "Open group canvas" : "Open agent internals"} onClick={() => p.onOpen(node.id)}>
                  <Maximize2 className="h-3.5 w-3.5" />
                </IconButton>
              )}
            </>
          }
          onDelete={() => update((d) => deleteNodes(d, [node.id]))}
          onClose={onClose}
        />
        {own.length > 0 && (
          <div className="px-4 pb-2">
            <IssueList issues={own} />
          </div>
        )}
        {code ? (
          <YamlTab
            value={node.data}
            guard={(next) => ((next as NodeData).kind !== node.data.kind ? `kind must stay ${node.data.kind}` : null)}
            onApply={(next) => update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === node.id ? { ...n, data: next as NodeData } : n)) }))}
          />
        ) : (
          <NodeBody id={node.id} data={node.data} p={p} />
        )}
      </div>
    );
  }
  if (edge) {
    const nm = (id: string) => nodeName(doc.nodes.find((x) => x.id === id));
    const own = issues.filter((i) => i.edgeId === edge.id);
    const setEdge = (patch: Partial<SysEdge>) => update((d) => ({ ...d, edges: d.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)) }));
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Header
          title={`${nm(edge.source)} → ${nm(edge.target)}`}
          subtitle={EDGE_LABEL[edge.kind]}
          icon={<KindIcon icon={EDGE_STYLE.icon} tint={EDGE_STYLE.tint} />}
          actions={<CodeToggle on={code} set={setCode} />}
          onDelete={() => update((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== edgeId) }))}
          onClose={onClose}
        />
        {own.length > 0 && (
          <div className="px-4 pb-2">
            <IssueList issues={own} />
          </div>
        )}
        <div className="border-b border-border/60" />
        {code ? (
          <YamlTab
            value={edge}
            guard={(next) => (next.id !== edge.id ? "id must stay the same" : !doc.nodes.some((n) => n.id === next.source) || !doc.nodes.some((n) => n.id === next.target) ? "source and target must be existing components" : null)}
            onApply={(next) => update((d) => ({ ...d, edges: d.edges.map((e) => (e.id === edge.id ? next : e)) }))}
          />
        ) : (
          <EdgeInspector key={edge.id} e={edge} doc={doc} set={setEdge} scope={p.scope} />
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SystemInspector doc={doc} update={update} issues={issues} onPick={p.onPickIssue} />
    </div>
  );
}
