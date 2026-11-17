// Plugin presets and the mas-plugin/1 manifest importer.
import YAML from "yaml";
import type { PluginData, PluginPreset, PluginSpec } from "./types";

export const PLUGIN_CONTRACT = "mas-plugin/1" as const;

export interface PresetInfo {
  id: PluginPreset;
  label: string;
  hint: string;
  name: string;
  spec: () => PluginSpec;
}

export const PLUGIN_PRESETS: PresetInfo[] = [
  {
    id: "memory",
    label: "Memory",
    hint: "Remembers facts across turns and sessions",
    name: "Memory",
    spec: () => ({
      tools: [
        { name: "memory_search", description: "Search remembered facts", effect: "read" },
        { name: "memory_write", description: "Remember a fact", effect: "write" },
      ],
      hooks: {
        before_turn: { lang: "template", code: "Relevant memories:\n{{#each (search input.text 8)}}- {{this.text}}\n{{/each}}" },
        after_turn: { lang: "llm", code: "List new durable facts from this turn (preferences, decisions, open items), one per line.", model: "haiku" },
      },
      backend: { kind: "builtin" },
      scope: "agent",
      storage: "builtin",
    }),
  },
  {
    id: "knowledge",
    label: "Knowledge",
    hint: "Searchable documents (RAG)",
    name: "Knowledge base",
    spec: () => ({
      tools: [{ name: "kb_search", description: "Search the knowledge base", effect: "read" }],
      hooks: { before_turn: { lang: "template", code: "{{#each (search input.text 5)}}- {{this.text}} [{{this.source}}]\n{{/each}}" } },
      backend: { kind: "builtin" },
      scope: "system",
      storage: "pgvector",
      sources: ["./docs"],
    }),
  },
  {
    id: "workspace",
    label: "Workspace",
    hint: "Files the agent reads and writes",
    name: "Workspace",
    spec: () => ({
      tools: [
        { name: "list_files", description: "List files", effect: "read" },
        { name: "read_file", description: "Read a file", effect: "read" },
        { name: "write_file", description: "Write a file", effect: "write" },
      ],
      hooks: { before_turn: { lang: "template", code: "Workspace files:\n{{#each (list \"/\")}}- {{this}}\n{{/each}}" } },
      backend: { kind: "builtin" },
      scope: "group",
      storage: "files",
      sources: ["/work"],
    }),
  },
  {
    id: "board",
    label: "Task board",
    hint: "Shared tasks with owners and states",
    name: "Task board",
    spec: () => ({
      tools: [
        { name: "task_list", description: "List tasks", effect: "read" },
        { name: "task_create", description: "Create a task", effect: "write" },
        { name: "task_update", description: "Update a task's state or owner", effect: "write" },
      ],
      hooks: { before_turn: { lang: "template", code: "Your open tasks:\n{{#each (tasks owner=self state=\"open\")}}- {{this.title}}\n{{/each}}" } },
      backend: { kind: "builtin" },
      scope: "system",
      storage: "builtin",
    }),
  },
  {
    id: "custom",
    label: "Custom",
    hint: "Your own tools and hooks (MCP, HTTP or code)",
    name: "Custom plugin",
    spec: () => ({
      tools: [{ name: "my_tool", description: "What it does", effect: "read" }],
      hooks: { before_turn: { lang: "js", code: "// return text to add to the agent's context, or null\nreturn null;" } },
      backend: { kind: "mcp", command: "uv run python my_plugin.py" },
      scope: "agent",
      storage: "none",
    }),
  },
];

export const presetInfo = (id: PluginPreset) => PLUGIN_PRESETS.find((p) => p.id === id)!;

export function defaultPlugin(preset: PluginPreset = "memory"): PluginData {
  const p = presetInfo(preset);
  return { kind: "plugin", name: p.name, preset, spec: p.spec() };
}

/** Change preset. Going to "custom" keeps everything as is, so a preset becomes a starting point you can edit freely. */
export function switchPreset(d: PluginData, preset: PluginPreset): PluginData {
  if (preset === "custom") return { ...d, preset };
  const p = presetInfo(preset);
  const keepName = d.name !== presetInfo(d.preset).name;
  return { ...d, preset, name: keepName ? d.name : p.name, spec: p.spec() };
}

export class PluginImportError extends Error {}

/** mas-plugin/1 manifest: name, tools, hooks, backend, scope. */
export function parsePluginFile(text: string): PluginData {
  let raw: unknown;
  try {
    raw = text.trim().startsWith("{") ? JSON.parse(text) : YAML.parse(text);
  } catch (err) {
    throw new PluginImportError(`Could not parse: ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PluginImportError("Expected a mapping");
  const r = raw as Record<string, unknown>;
  if (r.contract && r.contract !== PLUGIN_CONTRACT) throw new PluginImportError(`Unsupported contract ${String(r.contract)}; expected ${PLUGIN_CONTRACT}`);
  const base = presetInfo("custom").spec();
  const backend = (r.backend ?? base.backend) as PluginSpec["backend"];
  if (!["builtin", "mcp", "http", "code"].includes(backend.kind)) throw new PluginImportError(`backend.kind must be builtin, mcp, http or code`);
  return {
    kind: "plugin",
    name: String(r.name ?? "Imported plugin"),
    preset: "custom",
    spec: {
      tools: Array.isArray(r.tools) ? (r.tools as PluginSpec["tools"]) : [],
      hooks: (r.hooks as PluginSpec["hooks"]) ?? {},
      backend,
      scope: (r.scope as PluginSpec["scope"]) ?? "agent",
      storage: (r.storage as PluginSpec["storage"]) ?? "none",
      sources: Array.isArray(r.sources) ? r.sources.map(String) : undefined,
    },
  };
}

export const PLUGIN_EXAMPLE = `contract: mas-plugin/1
name: CRM lookup
scope: system
backend:
  kind: mcp
  url: http://127.0.0.1:9100/mcp
tools:
  - { name: crm_find_customer, description: Find a customer by email, effect: read }
  - { name: crm_add_note, description: Add a note to a customer, effect: write }
hooks:
  before_turn:
    lang: js
    code: |
      const c = await tools.crm_find_customer({ email: ctx.user.email });
      return c ? \`Customer: \${c.name}, plan \${c.plan}\` : null;
`;
