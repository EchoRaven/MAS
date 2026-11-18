// What each env is doing at a point in a run, for its node on the canvas:
// whether its machine is up and how it is isolated, its last tool call and
// exit code, how many calls it served, and how many connections its egress
// proxy refused. Folded from the run's events, so a replay shows the same.
import type { EnvLive } from "@/canvas/convert";
import { envToolNames } from "@/model/envTools";
import type { EnvData, SystemDoc } from "@/model/types";
import type { RunEvent } from "./events";

export function envLiveAt(events: RunEvent[], upto: number, doc: SystemDoc): Record<string, EnvLive> {
  const envs = doc.nodes.filter((n) => n.data.kind === "env");
  if (!envs.length) return {};
  // which env serves a tool for an agent: the envs it is connected to that offer that tool
  const toolsOf = new Map(envs.map((n) => [n.id, new Set(envToolNames(n.data as EnvData, n.id))]));
  const servedBy = (agent: string, tool: string) => doc.edges.find((e) => e.kind === "access" && e.source === agent && toolsOf.get(e.target)?.has(tool))?.target;
  const out: Record<string, EnvLive> = {};
  const at = (id: string) => (out[id] ??= { state: "ready", calls: 0, refused: 0 });
  for (const e of events.slice(0, upto)) {
    if (e.type === "log" && e.node && toolsOf.has(e.node)) {
      const m = /^Sandbox \S+(?: for \S+)?: (.+)$/.exec(e.text);
      if (m) Object.assign(at(e.node), { state: "ready", isolation: m[1] });
      else if (/^Starting sandbox/.test(e.text)) at(e.node).state = "starting";
      else if (/^egress: .* refused/.test(e.text)) at(e.node).refused++;
    }
    if (e.type === "tool") {
      const env = servedBy(e.node, e.tool);
      if (!env) continue;
      const live = at(env);
      live.calls++;
      const exit = /^exit (-?\d+)/.exec(e.result);
      live.last = { tool: e.tool, args: e.args.slice(0, 200), ...(exit ? { exit: Number(exit[1]) } : {}) };
    }
    if (e.type === "system_finished") for (const n of envs) if (out[n.id] && (n.data as EnvData).lifecycle === "per_run") out[n.id].state = "stopped";
  }
  return out;
}
