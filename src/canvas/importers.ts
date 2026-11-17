// Parse an import by kind and attach each candidate's conformance report.
import { AGENT_EXAMPLE, parseAgentFile } from "@/model/agentspec";
import { conformAgent, conformEnv, conformFunction, conformPlugin, type Conformance } from "@/model/conformance";
import { envFromManifest, parseEnvFile } from "@/model/envspec";
import { FUNCTION_EXAMPLE, parseFunctionFile } from "@/model/functionspec";
import { parsePluginFile, PLUGIN_EXAMPLE } from "@/model/plugins";
import type { NodeData, NodeKind, SystemDoc } from "@/model/types";

export type ImportKind = "agent" | "env" | "plugin" | "function";

export interface Candidate {
  label: string;
  kind: NodeKind;
  data: NodeData;
  conformance: Conformance;
}

export interface Parsed {
  detected: string;
  notes: string[];
  candidates: Candidate[];
}

export const IMPORT_COPY: Record<ImportKind, { title: string; accepts: string; formats: string[]; example: string }> = {
  agent: {
    title: "Import an agent",
    accepts: ".md,.json,.yaml,.yml",
    formats: ["mas-agent/1 manifest", "Claude Code subagent (.md)", "A2A Agent Card (.json)", "langgraph.json"],
    example: AGENT_EXAMPLE,
  },
  env: {
    title: "Import an environment",
    accepts: ".yaml,.yml,.json",
    formats: ["mas-env/1 manifest", "DT registry.yaml", "docker-compose.yml", "env-gen / DT folder → node scripts/import-env.mjs <dir>"],
    example:
      "contract: mas-env/1\nname: My app\nkind: web_app\nlifecycle:\n  start: docker compose up -d\n  health: GET http://127.0.0.1:8078/health\n  reset: POST http://127.0.0.1:8078/api/v1/reset\nexposes:\n  http: [{ name: api, base: http://127.0.0.1:8078 }]\n  mcp: { transport: http, url: http://127.0.0.1:8890/mcp, auth: none, tools: [get_items] }\n",
  },
  plugin: { title: "Import a plugin", accepts: ".yaml,.yml,.json", formats: ["mas-plugin/1 manifest: tools + hooks + backend"], example: PLUGIN_EXAMPLE },
  function: { title: "Import a function", accepts: ".yaml,.yml,.json,.js,.mjs,.ts,.py,.jsonata,.hbs,.prompt", formats: ["mas-function/1 manifest", "a .js / .py / .jsonata / .hbs / .prompt file"], example: FUNCTION_EXAMPLE },
};

/** Throws on input that cannot be read at all; otherwise every candidate carries its checklist. */
export function parseImport(kind: ImportKind, text: string, filename: string, doc?: SystemDoc): Parsed {
  if (kind === "agent") {
    const r = parseAgentFile(text, filename);
    return { detected: r.detected, notes: r.notes, candidates: [{ label: r.agent.name, kind: "agent", data: r.agent, conformance: conformAgent(r.agent, doc) }] };
  }
  if (kind === "plugin") {
    const p = parsePluginFile(text);
    return { detected: "mas-plugin/1", notes: [`${p.spec.tools.length} tools · backend ${p.spec.backend.kind}`], candidates: [{ label: p.name, kind: "plugin", data: p, conformance: conformPlugin(p) }] };
  }
  if (kind === "function") {
    const r = parseFunctionFile(text, filename);
    return { detected: r.detected, notes: [`${r.fn.fn.lang} · ${r.fn.interface.inputs.length} in / ${r.fn.interface.outputs.length} out`], candidates: [{ label: r.fn.name, kind: "function", data: r.fn, conformance: conformFunction(r.fn, doc) }] };
  }
  const r = parseEnvFile(text, filename);
  return { detected: r.detected, notes: r.notes, candidates: r.manifests.map((m) => ({ label: m.name, kind: "env" as const, data: envFromManifest(m), conformance: conformEnv(m) })) };
}
