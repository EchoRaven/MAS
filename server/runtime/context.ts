// What every part of a running system can reach: the document, the model
// gateway, the event stream, budgets, people, and live resources.
import type { SysNode, SystemDoc } from "@/model/types";
import type { HumanRequest, RunEventBody } from "@/run/events";
import type { Config } from "../config";
import type { Store } from "../store/files";
import type { Secrets } from "../store/secrets";
import type { Models, Usage } from "./models";

export interface HumanAnswer {
  approved?: boolean;
  text?: string;
}

export interface RunCtx {
  runId: string;
  /** what the run was started with: a step deep in a pipeline can still see the original task (ctx.run_input) */
  input?: string;
  doc: SystemDoc;
  byId: Map<string, SysNode>;
  models: Models;
  store: Store;
  secrets: Secrets;
  config: Config;
  signal: AbortSignal;
  /** end the run now, with this reason (a policy that ends it, say) */
  stop(reason: string): void;
  /** shared variables code can read and write (ctx.vars) */
  vars: Record<string, unknown>;
  emit(e: RunEventBody): void;
  /** account for a model call: emits usage, enforces budgets (throws BudgetError) */
  usage(node: string, u: Usage, estimated?: boolean): void;
  /** ask a person and wait for the answer */
  ask(req: Omit<HumanRequest, "id">): Promise<HumanAnswer>;
  /** count one component activation against max_rounds (throws BudgetError) */
  tick(): void;
}

export class BudgetError extends Error {}
export class StopError extends Error {}

export const nameOf = (rc: RunCtx, id: string) => {
  const d = rc.byId.get(id)?.data;
  return d && "name" in d ? d.name : id;
};
