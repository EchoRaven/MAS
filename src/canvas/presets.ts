// What the palette offers: each component kind with its predefined variants.
// Every variant is just NodeData, so after it lands on the canvas it can be
// edited into anything else of the same kind.
import { Bot, Box, Layers, Puzzle, Sparkles, SquareFunction, User, type LucideIcon } from "lucide-react";
import { defaultAgent, defaultData, defaultRoom, runnerById } from "@/model/defaults";
import { defaultPlugin, PLUGIN_PRESETS } from "@/model/plugins";
import type { AgentData, EnvData, EnvKind, NodeData, NodeKind } from "@/model/types";

export interface Variant {
  id: string;
  label: string;
  hint: string;
  make: () => NodeData;
}

export interface PaletteEntry {
  kind: NodeKind;
  label: string;
  hint: string;
  icon: LucideIcon;
  variants?: Variant[];
  /** offers "Import…" at the end of its menu */
  importable?: "agent" | "env" | "plugin";
}

function agentWith(runner: string, name: string): AgentData {
  const a = defaultAgent(name);
  const r = runnerById(runner)!;
  return { ...a, harness: { ...a.harness, tier: r.tier, runner, loop: r.tier === "native" ? "react" : undefined, capabilities: { ...r.caps } } };
}

function env(kind: EnvKind, name: string, patch: Partial<EnvData> = {}): EnvData {
  return { ...(defaultData("env") as EnvData), name, env_kind: kind, ...patch };
}

export const PALETTE: PaletteEntry[] = [
  {
    kind: "agent",
    label: "Agent",
    hint: "Model + harness + tools, wrapped with input / output stages",
    icon: Bot,
    importable: "agent",
    variants: [
      { id: "native", label: "Platform agent", hint: "Native loop; the platform controls context and tools", make: () => defaultAgent() },
      { id: "claude-code", label: "Claude Code", hint: "claude -p as an external process", make: () => agentWith("claude-code", "Claude Code") },
      { id: "codex", label: "Codex", hint: "codex exec as an external process", make: () => agentWith("codex", "Codex") },
      { id: "acp", label: "ACP agent", hint: "Any Agent Client Protocol agent", make: () => agentWith("acp", "ACP agent") },
      { id: "a2a", label: "Remote (A2A)", hint: "A remote agent by its Agent Card", make: () => agentWith("a2a", "Remote agent") },
      { id: "custom-stdio", label: "Custom program", hint: "Your own harness over stdio JSONL", make: () => agentWith("custom-stdio", "Custom agent") },
    ],
  },
  { kind: "model", label: "Model call", hint: "One model call: no loop, no tools", icon: Sparkles },
  { kind: "function", label: "Function", hint: "Code between components: transform, route, merge", icon: SquareFunction },
  { kind: "human", label: "Human", hint: "Approves, guides, answers", icon: User },
  {
    kind: "env",
    label: "Environment",
    hint: "Where agents act: sandbox, app, browser, room…",
    icon: Box,
    importable: "env",
    variants: [
      { id: "sandbox", label: "Sandbox", hint: "Container with a shell and files", make: () => env("sandbox", "Sandbox") },
      { id: "browser", label: "Browser", hint: "Headless browser", make: () => env("browser", "Browser", { image: "" }) },
      { id: "database", label: "Database", hint: "Managed database", make: () => env("database", "Database", { image: "postgres:16" }) },
      { id: "room", label: "Room", hint: "Shared conversation space", make: () => defaultRoom() },
      { id: "service", label: "Service", hint: "A running service or API", make: () => env("service", "Service", { image: "" }) },
      { id: "external", label: "External system", hint: "Third-party system; actions are logged, not snapshotted", make: () => env("external", "External", { image: "", snapshot: "never" }) },
    ],
  },
  {
    kind: "plugin",
    label: "Plugin",
    hint: "Adds a capability to agents: memory, knowledge, workspace, or your own",
    icon: Puzzle,
    importable: "plugin",
    variants: PLUGIN_PRESETS.map((p) => ({ id: p.id, label: p.label, hint: p.hint, make: () => defaultPlugin(p.id) })),
  },
  { kind: "group", label: "Group", hint: "A sub-system with its own ports; double-click to open", icon: Layers },
];
