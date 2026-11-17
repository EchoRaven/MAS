// Everything an agent can call in a turn: catalog tools, tools of the envs
// and plugins it is connected to (narrowed by each edge's binding), its call
// edges (ask another component and wait), spawning, and handoff choices.
import type { AgentData, SysEdge, SysNode } from "@/model/types";
import { nameOf, type RunCtx } from "../context";
import type { Hub } from "../resources/hub";
import { S, schema, type RtTool } from "../resources/types";
import { catalogTools } from "../tools/catalog";

export interface ToolServices {
  rc: RunCtx;
  hub: Hub;
  /** call along an edge and wait for the reply */
  call(edge: SysEdge, text: string): Promise<string>;
  /** run the spawn template on one task */
  spawn(template: string, task: string, i: number): Promise<string>;
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);

export async function agentTools(svc: ToolServices, node: SysNode<AgentData>, transfers: Set<string>): Promise<{ tools: RtTool[]; server_tools: ("web_search" | "web_fetch")[]; access: SysEdge[] }> {
  const { rc, hub } = svc;
  const a = node.data;
  const access = rc.doc.edges.filter((e) => e.kind === "access" && e.source === node.id);
  let providerIsAnthropic = false;
  try {
    providerIsAnthropic = rc.models.spec(a.model).provider === "anthropic";
  } catch {
    /* unknown model: reported when the loop calls it */
  }
  const cat = await catalogTools(rc, node.id, a.tools, access, hub, providerIsAnthropic);
  const tools: RtTool[] = [...cat.tools];

  for (const e of access) {
    const target = rc.byId.get(e.target);
    if (!target || (target.data.kind === "env" && target.data.env_kind === "room" && e.binding?.mode !== "tool")) continue;
    try {
      let ts = await hub.get(e.target).tools(e);
      if (e.binding?.tools?.length) ts = ts.filter((t) => e.binding!.tools!.includes(t.name));
      if (e.binding?.write?.when === "never" || e.access === "read") ts = ts.filter((t) => t.effect === "read" || t.effect === "pure");
      // a catalog tool an env already serves (bash through the sandbox) is not offered twice
      tools.push(...ts.filter((t) => !tools.some((x) => x.name === t.name && x.source === t.source)));
    } catch (err) {
      rc.emit({ type: "log", node: node.id, level: "warn", text: `${nameOf(rc, e.target)}: ${(err as Error).message}` });
    }
  }

  // call edges: ask the target and wait
  for (const e of rc.doc.edges.filter((x) => x.kind === "call" && x.source === node.id)) {
    const target = rc.byId.get(e.target);
    if (!target) continue;
    const role = "role" in target.data && target.data.role ? ` (${target.data.role})` : "";
    tools.push({
      name: `ask_${safe(e.target)}`,
      description: `${e.label ? e.label + ": " : ""}ask ${nameOf(rc, e.target)}${role} and wait for the reply`,
      input_schema: schema({ request: { ...S, description: "What you need from them" } }),
      effect: "pure",
      source: `edge:${e.id}`,
      run: async (args) => svc.call(e, String(args.request ?? "")),
    });
  }

  // handoffs: with a choice of targets, the agent picks
  const handoffs = rc.doc.edges.filter((x) => x.kind === "handoff" && x.source === node.id);
  if (handoffs.length > 1)
    for (const e of handoffs)
      tools.push({
        name: `transfer_to_${safe(e.target)}`,
        description: `Hand the task over to ${nameOf(rc, e.target)} when you are done${e.label ? ` (${e.label})` : ""}`,
        input_schema: schema({ reason: S }, []),
        effect: "pure",
        source: `edge:${e.id}`,
        run: async () => {
          transfers.add(e.id);
          return `Will hand over to ${nameOf(rc, e.target)} after this turn.`;
        },
      });

  // spawning: fan out copies of a template agent
  if (a.spawn && rc.byId.get(a.spawn.template)?.data.kind === "agent") {
    const sp = a.spawn;
    tools.push({
      name: "spawn_subagents",
      description: `Run up to ${sp.max_instances} copies of ${nameOf(rc, sp.template)} in parallel, one per task; returns all their answers`,
      input_schema: { type: "object", properties: { tasks: { type: "array", items: S } }, required: ["tasks"] },
      effect: "pure",
      source: `edge:spawn`,
      run: async (args) => {
        const tasks = ((args.tasks as unknown[]) ?? []).map(String).slice(0, sp.max_instances);
        rc.emit({ type: "spawn", node: node.id, template: sp.template, count: tasks.length });
        const outs = await Promise.all(tasks.map((t, i) => svc.spawn(sp.template, t, i + 1)));
        return outs.map((o, i) => `## Task ${i + 1}: ${tasks[i]}\n${o}`).join("\n\n");
      },
    });
  }

  // unique names: a second tool with the same name gets its source as a suffix
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) t.name = `${t.name}_${safe(t.source.replace(/^edge:/, ""))}`.slice(0, 64);
    seen.add(t.name);
  }
  return { tools, server_tools: cat.server_tools, access };
}
