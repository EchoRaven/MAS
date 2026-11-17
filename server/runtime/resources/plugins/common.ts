// Shared by every plugin: its state folder, the scope key a turn writes
// under, and running the plugin's own hooks.
import fs from "node:fs";
import path from "node:path";
import type { PluginData, SysNode } from "@/model/types";
import type { RunCtx } from "../../context";
import { runFn } from "../../functions";
import { asText } from "../../values";

export function stateFile(rc: RunCtx, plugin: string, name: string) {
  return path.join(rc.store.stateDir(rc.doc.id, plugin), name);
}

export function readState<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeState(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
}

/** Who shares the plugin's state with this agent: itself, its group, the end user, or everyone. */
export function scopeKey(rc: RunCtx, plugin: SysNode<PluginData>, node: string): string {
  switch (plugin.data.spec.scope) {
    case "agent":
      return node;
    case "group":
      return rc.byId.get(node)?.parent ?? "root";
    case "end_user":
      return String(rc.vars.user_id ?? "default");
    default:
      return "system";
  }
}

/** A plugin's before_turn / after_turn / on_start hook, run with the plugin's helpers. */
export async function runHook(rc: RunCtx, plugin: SysNode<PluginData>, hook: "before_turn" | "after_turn" | "on_start", input: unknown, node: string, helpers: Record<string, unknown>): Promise<string | null> {
  const fn = plugin.data.spec.hooks[hook];
  if (!fn) return null;
  const out = await runFn(fn, input, rc, { node, helpers: { ...helpers, self: node } });
  return out == null ? null : asText(out);
}

export const uid = () => Math.random().toString(36).slice(2, 10);
