// A harness adapter drives an agent whose loop is not ours: a CLI agent, a
// remote agent, a program. It gets the turn's text and context and returns
// the reply; the platform's tools reach it through the run's MCP endpoint.
import type { AgentData } from "@/model/types";
import type { RunCtx } from "../context";

export interface HarnessTurn {
  rc: RunCtx;
  node: string;
  agent: AgentData;
  input: string;
  /** instructions + injected context, as a system prompt */
  context: string;
  /** the agent's own working folder */
  cwd: string;
  /** the platform tools for this agent, served over MCP */
  mcp?: { url: string; token: string; tools: string[] };
  /** resume token from the previous turn (session id, context id) */
  session?: string;
}

export interface HarnessResult {
  text: string;
  session?: string;
  usage?: { tokens_in: number; tokens_out: number; usd: number; estimated: boolean; model?: string };
}

export type Adapter = (t: HarnessTurn) => Promise<HarnessResult>;
