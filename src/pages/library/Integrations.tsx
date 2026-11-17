import { Panel } from "@/components/shared/Panel";
import { AGENT_EXAMPLE } from "@/model/agentspec";
import { RUNNERS } from "@/model/defaults";
import { PLUGIN_EXAMPLE } from "@/model/plugins";

const CONTRACTS = [
  {
    id: "mas-agent/1",
    title: "Agents & harnesses",
    body: "Any agent that can say how it is launched (protocol + command or URL), what it lets the platform control (capabilities) and what it takes and returns (interface). Imports: this manifest, Claude Code subagents (.md), A2A Agent Cards, langgraph.json.",
    example: AGENT_EXAMPLE,
  },
  {
    id: "mas-env/1",
    title: "Environments",
    body: "Anything with a health check, a reset, and something agents can use (an MCP server or HTTP bases). Imports: this manifest, DT registry.yaml, docker-compose; for a DT env folder or an env-gen delivery run node scripts/import-env.mjs <dir>.",
    example: "contract: mas-env/1\nname: My app\nkind: web_app\nlifecycle:\n  health: GET http://127.0.0.1:8078/health\n  reset: POST http://127.0.0.1:8078/api/v1/reset\nexposes:\n  http: [{ name: api, base: http://127.0.0.1:8078 }]\n  mcp: { transport: http, url: http://127.0.0.1:8890/mcp, auth: none, tools: [get_items] }",
  },
  {
    id: "mas-plugin/1",
    title: "Plugins",
    body: "Memory, knowledge, workspaces, boards and your own: tools the agent can call, hooks (before_turn, after_turn, on_start) and a backend (built-in, MCP, HTTP or code).",
    example: PLUGIN_EXAMPLE,
  },
];

/** The three contracts anything must meet to plug in, and the harness adapters the platform ships. */
export function Integrations() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        {CONTRACTS.map((c) => (
          <Panel key={c.id} title={<span>{c.title} <span className="font-mono text-[11px] font-normal text-muted-foreground">{c.id}</span></span>}>
            <p className="text-xs text-muted-foreground">{c.body}</p>
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-secondary/60 p-2.5 font-mono text-[10px] leading-relaxed">{c.example}</pre>
          </Panel>
        ))}
      </div>
      <Panel title="Harness adapters">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-2 font-medium">Adapter</th>
                <th className="py-1.5 pr-2 font-medium">Tier</th>
                <th className="py-1.5 pr-2 font-medium">Context</th>
                <th className="py-1.5 pr-2 font-medium">Tools via</th>
                <th className="py-1.5 pr-2 font-medium">Approval hook</th>
                <th className="py-1.5 pr-2 font-medium">How</th>
              </tr>
            </thead>
            <tbody>
              {RUNNERS.map((r) => (
                <tr key={r.id} className="border-t border-border/70">
                  <td className="py-1.5 pr-2 font-medium">{r.label}</td>
                  <td className="py-1.5 pr-2">{r.tier}</td>
                  <td className="py-1.5 pr-2">{r.caps.context_control}</td>
                  <td className="py-1.5 pr-2">{r.caps.tool_injection.join(" / ") || "—"}</td>
                  <td className="py-1.5 pr-2">{r.caps.approval_hook ? "yes" : "no"}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{r.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
