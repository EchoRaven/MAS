import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { KIND_LABEL } from "@/model/defaults";
import { nodeName } from "@/model/ports";
import type { AgentData, EnvData, FunctionNodeData, GroupData, HumanData, ModelNodeData, NodeData, PluginData, SysEdge, SystemDoc } from "@/model/types";
import type { Issue } from "@/model/validate";
import { EDGE_LABEL } from "../convert";
import { deleteNodes } from "../ops";
import { AgentInspector, type AgentTab } from "./AgentInspector";
import { FunctionInspector, GroupInspector, HumanInspector, ModelInspector } from "./ComponentInspectors";
import { EdgeInspector } from "./EdgeInspector";
import { EnvInspector, PluginInspector } from "./ResourceInspectors";
import { Header, IssueList, type Update } from "./shared";
import { SystemInspector } from "./SystemInspector";

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
      return <PluginInspector p={data as PluginData} doc={p.doc} set={(next) => set(next)} />;
  }
}

export function Inspector(p: InspectorProps) {
  const { doc, update, nodeId, edgeId, issues, onClose } = p;
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
          subtitle={`${KIND_LABEL[node.data.kind]} · ${node.id}`}
          avatar={<EntityAvatar kind={node.data.kind === "agent" ? "agent" : "system"} id={node.id} name={name} className="h-8 w-8 text-[11px]" />}
          actions={
            openable && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => p.onOpen(node.id)} aria-label={node.data.kind === "group" ? "Open group canvas" : "Open agent internals"} title={node.data.kind === "group" ? "Open its canvas" : "Open its internals"}>
                <Maximize2 className="h-4 w-4" />
              </Button>
            )
          }
          onDelete={() => update((d) => deleteNodes(d, [node.id]))}
          onClose={onClose}
        />
        {own.length > 0 && (
          <div className="px-4 pt-3">
            <IssueList issues={own} />
          </div>
        )}
        <NodeBody id={node.id} data={node.data} p={p} />
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
          avatar={<EntityAvatar kind="system" id={edge.id} name="" className="h-8 w-8" />}
          onDelete={() => update((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== edgeId) }))}
          onClose={onClose}
        />
        {own.length > 0 && (
          <div className="px-4 pt-3">
            <IssueList issues={own} />
          </div>
        )}
        <EdgeInspector key={edge.id} e={edge} doc={doc} set={setEdge} scope={p.scope} />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SystemInspector doc={doc} update={update} issues={issues} onPick={p.onPickIssue} />
    </div>
  );
}
