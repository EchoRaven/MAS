// What a live plugin or env offers the agents attached to it.
import type { AccessBinding, SysEdge, ToolEffect } from "@/model/types";
import type { Msg } from "../values";

export interface RtTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  effect: ToolEffect;
  /** component that provides it */
  source: string;
  run(args: Record<string, unknown>, call: ToolCall): Promise<string>;
}

export interface ToolCall {
  /** the agent calling */
  node: string;
}

/** One agent turn, as resources see it. */
export interface TurnInfo {
  node: string;
  /** the incoming text */
  input: string;
  output: string;
  messages: Msg[];
  edge: SysEdge;
  binding: AccessBinding;
}

export interface Resource {
  id: string;
  /** tools for an agent on this edge (already narrowed by the binding's allowlist by the caller) */
  tools(edge: SysEdge): Promise<RtTool[]>;
  /** context to put in front of the agent's turn (auto_inject / pinned) */
  beforeTurn?(turn: { node: string; input: string; edge: SysEdge }): Promise<string | null>;
  /** after the agent's turn (binding.write.when === "after_turn") */
  afterTurn?(turn: TurnInfo): Promise<void>;
  /** record an observation for an agent (memory plugins store it through their policy) */
  observe?(node: string, text: string): Promise<void>;
  close?(): Promise<void>;
}

export const schema = (props: Record<string, { type: string; description?: string; enum?: string[] }>, required: string[] = Object.keys(props)) => ({
  type: "object",
  properties: props,
  required,
});

export const S = { type: "string" } as const;
export const N = { type: "number" } as const;
