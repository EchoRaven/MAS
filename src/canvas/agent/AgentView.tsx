import { memo, useMemo } from "react";
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import { Bot, Box, Cpu, Layers3, LogIn, LogOut, Plus, Puzzle, Sparkles, SquareFunction, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentData, SystemDoc } from "@/model/types";
import { resolveTheme, useUiStore } from "@/store/ui";
import { TYPE_DOT } from "../nodes";
import { agentGraph, type Part, type PartNode } from "./layout";

const ICON = { "port-in": LogIn, "port-out": LogOut, stage: SquareFunction, context: Layers3, harness: Cpu, model: Sparkles, tools: Wrench, plugin: Puzzle, env: Box } as const;
const HIDDEN = "!h-1.5 !w-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent";

const PartCard = memo(function PartCard({ data, selected }: NodeProps<PartNode>) {
  const Icon = ICON[data.icon];
  const isPort = data.icon === "port-in" || data.icon === "port-out";
  const big = data.icon === "harness";
  return (
    <div
      className={cn(
        "relative cursor-pointer rounded-xl bg-card shadow-[var(--ring-shadow)] transition-shadow hover:shadow-[var(--pop-shadow)]",
        isPort ? "w-[150px] rounded-full px-3 py-2" : big ? "w-[200px] p-3.5" : "w-[180px] p-3",
        data.dim && "opacity-55",
        (data.icon === "plugin" || data.icon === "env") && "border border-dashed border-border bg-secondary/40",
        selected && "ring-2 ring-ring",
      )}
    >
      <Handle type="target" position={Position.Left} className={HIDDEN} />
      <Handle type="source" position={Position.Right} className={HIDDEN} />
      <Handle id="t" type="source" position={Position.Top} className={HIDDEN} />
      <Handle id="t" type="target" position={Position.Top} className={HIDDEN} />
      <Handle id="b" type="source" position={Position.Bottom} className={HIDDEN} />
      <Handle id="b" type="target" position={Position.Bottom} className={HIDDEN} />
      <div className="flex items-center gap-2">
        {isPort ? <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full border-2 border-card", TYPE_DOT[data.port!.type].replace(/!/g, ""))} /> : <Icon className={cn("h-4 w-4 shrink-0 text-muted-foreground", big && "text-foreground")} />}
        <p className={cn("min-w-0 flex-1 truncate font-semibold", isPort ? "font-mono text-xs" : "text-[13px]")}>{data.title}</p>
        {data.badge && <span className="rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{data.badge}</span>}
      </div>
      <p className={cn("truncate text-[11px] text-muted-foreground", isPort ? "pl-[18px]" : "mt-0.5")}>{data.subtitle}</p>
    </div>
  );
});

const TYPES = { part: PartCard };

/**
 * An agent opened up: its interface, input and output stages, context and
 * the plugins feeding it, the harness loop with its model and tools. Parts
 * the harness manages itself are dimmed. Click a part to edit it.
 */
export function AgentView({ doc, id, a, selected, onPart, onAddStage }: { doc: SystemDoc; id: string; a: AgentData; selected?: Part; onPart: (p: Part) => void; onAddStage: (which: "pre" | "post") => void }) {
  const theme = useUiStore((s) => s.theme);
  const graph = useMemo(() => agentGraph(doc, id, a), [doc, id, a]);
  const nodes = useMemo(() => graph.nodes.map((n) => ({ ...n, selected: n.data.part === selected, draggable: false, connectable: false })), [graph, selected]);
  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={TYPES}
        onNodeClick={(_, n) => onPart((n as PartNode).data.part)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        zoomOnDoubleClick={false}
        colorMode={resolveTheme(theme)}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      <div className="absolute right-3 top-3 flex items-center gap-2 rounded-xl bg-card/90 p-1.5 shadow-[var(--ring-shadow)] backdrop-blur">
        <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
          <Bot className="h-3.5 w-3.5" /> Wrapper
        </span>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onAddStage("pre")}>
          <Plus className="mr-1 h-3 w-3" /> Input stage
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onAddStage("post")}>
          <Plus className="mr-1 h-3 w-3" /> Output stage
        </Button>
      </div>
    </div>
  );
}
