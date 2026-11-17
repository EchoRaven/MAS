// Harness adapters by runner id (src/model/defaults.ts RUNNERS).
import { claudeCode, codex, customStdio } from "./process";
import { a2a, acp, langgraph } from "./remote";
import type { Adapter } from "./types";

export * from "./types";

export const ADAPTERS: Record<string, Adapter> = {
  "claude-code": claudeCode,
  // the Agent SDK speaks the same stream-json protocol as the CLI it drives
  "claude-agent-sdk": claudeCode,
  codex,
  acp,
  "custom-stdio": customStdio,
  // an Agents SDK program wrapped as a stdio harness (harness.command runs it)
  "openai-agents-sdk": customStdio,
  a2a,
  langgraph,
};
