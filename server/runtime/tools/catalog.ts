// Tools from the system's tool catalog, as an agent gets them. Tools that
// act on an env (bash, run_sql, browser…) are served by the env of that kind
// the agent is connected to; others run by their adapter settings.
import { mcpClientFor, resolveEndpoint } from "../../hosting/resolve";
import type { EnvKind, SysEdge, ToolSpec } from "@/model/types";
import type { RunCtx } from "../context";
import { runFn } from "../functions";
import { McpClient } from "../mcp/client";
import { runCommand } from "../resources/plugins/external";
import type { Hub } from "../resources/hub";
import { S, schema, type RtTool } from "../resources/types";
import { fetchText } from "./web";

function argsSchema(t: ToolSpec): Record<string, unknown> {
  if (t.input_schema) {
    try {
      return JSON.parse(t.input_schema);
    } catch {
      /* fall through */
    }
  }
  if (t.id === "fetch") return schema({ url: S });
  return schema({ input: S }, []);
}

export interface CatalogResult {
  tools: RtTool[];
  server_tools: ("web_search" | "web_fetch")[];
}

const warnedSearch = new Set<string>();

export async function catalogTools(rc: RunCtx, agent: string, ids: string[], access: SysEdge[], hub: Hub, providerIsAnthropic: boolean): Promise<CatalogResult> {
  const out: CatalogResult = { tools: [], server_tools: [] };
  const envOfKind = (kind: EnvKind) => access.find((e) => {
    const d = rc.byId.get(e.target)?.data;
    return d?.kind === "env" && d.env_kind === kind;
  });
  for (const id of ids) {
    const t = rc.doc.tools.find((x) => x.id === id);
    if (!t) continue;
    const base = { name: t.id, description: t.description, effect: t.effect, source: "catalog" };
    if (t.id === "web_search" && t.adapter === "builtin") {
      if (providerIsAnthropic) out.server_tools.push("web_search");
      else if (!warnedSearch.has(`${rc.runId}|${agent}`)) {
        // offering a tool that can only fail wastes a model call every time the agent tries it: leave it out, and say so once
        warnedSearch.add(`${rc.runId}|${agent}`);
        rc.emit({ type: "log", node: agent, level: "warn", text: "web_search is left out: the built-in search runs only on Anthropic models. Connect a search MCP env to give this agent web search on other providers" });
      }
      continue;
    }
    if (t.id === "fetch" && t.adapter === "builtin") {
      out.tools.push({ ...base, input_schema: schema({ url: S }), run: async (a) => fetchText(String(a.url)) });
      continue;
    }
    if (t.needs_env) {
      const edge = envOfKind(t.needs_env);
      if (!edge) {
        out.tools.push({ ...base, input_schema: argsSchema(t), run: async () => { throw new Error(`${t.id} needs a ${t.needs_env} env connected to this agent`); } });
        continue;
      }
      const envTools = await hub.get(edge.target).tools(edge);
      const same = envTools.filter((x) => x.name === t.id || (t.needs_env === "database" && x.name === "run_sql"));
      // a browser / external env serves the tool with whatever its MCP server offers
      if (same.length) out.tools.push(...same.map((x) => ({ ...x, name: t.id, description: t.description || x.description })));
      else if (!t.url && !t.command && !t.fn) out.tools.push(...envTools);
      if (same.length || (!t.url && !t.command && !t.fn)) continue;
    }
    const input_schema = argsSchema(t);
    // an endpoint (remote with auth, or a hosted service) takes the place of url for http and mcp tools
    if (t.endpoint && (t.adapter === "http" || t.adapter === "mcp")) {
      const endpoint = t.endpoint;
      let client: Promise<import("../mcp/client").McpClient> | undefined;
      out.tools.push({ ...base, input_schema, run: async (a) => {
        if (t.adapter === "mcp") {
          client ??= mcpClientFor(rc, endpoint);
          const r = await (await client).call(t.id, a);
          if (r.error) throw new Error(r.text);
          return r.text;
        }
        const target = await resolveEndpoint(rc, endpoint);
        if (!("url" in target)) throw new Error(`${t.id}: an HTTP tool cannot be an MCP-on-stdio service`);
        const res = await fetch(target.url, { method: "POST", headers: { "content-type": "application/json", ...target.headers }, body: JSON.stringify(a), signal: AbortSignal.timeout(60_000) });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
        return text;
      } });
      continue;
    }
    if (t.adapter === "http" && t.url) out.tools.push({ ...base, input_schema, run: async (a) => {
      const res = await fetch(t.url!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(a), signal: AbortSignal.timeout(60_000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      return text;
    } });
    else if (t.adapter === "mcp" && t.url) {
      const client = new McpClient({ url: t.url });
      out.tools.push({ ...base, input_schema, run: async (a) => {
        const r = await client.call(t.id, a);
        if (r.error) throw new Error(r.text);
        return r.text;
      } });
    } else if (t.adapter === "cli" && t.command) {
      if (!rc.config.allowLocalExec) out.tools.push({ ...base, input_schema, run: async () => { throw new Error(`${t.id} runs a host command; enable MAS_ALLOW_LOCAL_EXEC or give it a sandbox env`); } });
      else out.tools.push({ ...base, input_schema, run: async (a) => runCommand(t.command!, JSON.stringify(a)) });
    } else if (t.fn) out.tools.push({ ...base, input_schema, run: async (a, c) => {
      const r = await runFn(t.fn!, a, rc, { node: c.node });
      return typeof r === "string" ? r : JSON.stringify(r);
    } });
    else out.tools.push({ ...base, input_schema, run: async () => { throw new Error(`${t.id} has no implementation configured (Library → Tools: set its URL, command or code)`); } });
  }
  void agent;
  return out;
}
