import { useCallback, useState } from "react";
import type { AgentTab } from "@/canvas/inspector";
import type { Part } from "@/canvas/agent/layout";
import { edgeScope } from "@/model/ports";
import type { SystemDoc } from "@/model/types";
import type { Issue } from "@/model/validate";

export interface Selection {
  nodeId?: string;
  edgeId?: string;
}

/**
 * Where the editor is looking: which canvas (root or a group), whether an
 * agent is opened up, what is selected, and which inspector tab shows.
 */
export function useEditorNav(doc: SystemDoc) {
  const [scope, setScopeRaw] = useState<string | undefined>();
  const [agent, setAgent] = useState<string | undefined>();
  const [sel, setSel] = useState<Selection>({});
  const [agentTab, setAgentTab] = useState<AgentTab>("basic");
  const [part, setPart] = useState<Part | undefined>();
  const [stageFocus, setStageFocus] = useState<string | undefined>();

  const setScope = useCallback((s: string | undefined) => {
    setScopeRaw(s);
    setAgent(undefined);
    setPart(undefined);
    setSel({});
  }, []);

  /** Double-click: a group opens its canvas, an agent opens its internals. */
  const open = useCallback(
    (id: string) => {
      const n = doc.nodes.find((x) => x.id === id);
      if (!n) return;
      if (n.data.kind === "group") setScope(id);
      else if (n.data.kind === "agent") {
        setScopeRaw(n.parent);
        setAgent(id);
        setSel({ nodeId: id });
        setPart("harness");
        setAgentTab("harness");
      }
    },
    [doc.nodes, setScope],
  );

  /** A click inside an agent's internals picks the matching inspector tab. */
  const selectPart = useCallback((p: Part) => {
    setPart(p);
    setStageFocus(undefined);
    if (p.startsWith("res:")) {
      setSel({ edgeId: p.slice(4) });
      return;
    }
    if (agent) setSel({ nodeId: agent });
    if (p.startsWith("in:") || p.startsWith("out:")) setAgentTab("io");
    else if (p.startsWith("pre:") || p.startsWith("post:")) {
      setAgentTab("io");
      setStageFocus(p);
    } else if (p === "model") setAgentTab("basic");
    else setAgentTab(p as AgentTab);
  }, [agent]);

  /** Jump to an issue: open the canvas it is on and select it. */
  const pickIssue = useCallback(
    (i: Issue) => {
      if (i.nodeId) {
        const n = doc.nodes.find((x) => x.id === i.nodeId);
        setScopeRaw(n?.parent);
        setAgent(undefined);
        setSel({ nodeId: i.nodeId });
      } else if (i.edgeId) {
        const e = doc.edges.find((x) => x.id === i.edgeId);
        if (!e) return;
        const s = edgeScope(doc, e);
        setScopeRaw(s === null ? doc.nodes.find((n) => n.id === e.source)?.parent : s);
        setAgent(undefined);
        setSel({ edgeId: i.edgeId });
      }
    },
    [doc],
  );

  // a deleted selection or scope falls back
  const validScope = scope && doc.nodes.some((n) => n.id === scope) ? scope : undefined;
  const validAgent = agent && doc.nodes.some((n) => n.id === agent) ? agent : undefined;
  const validSel: Selection = (sel.nodeId && doc.nodes.some((n) => n.id === sel.nodeId)) || (sel.edgeId && doc.edges.some((e) => e.id === sel.edgeId)) ? sel : {};

  return { scope: validScope, setScope, agent: validAgent, closeAgent: () => setAgent(undefined), sel: validSel, setSel, agentTab, setAgentTab, part, selectPart, stageFocus, open, pickIssue };
}
