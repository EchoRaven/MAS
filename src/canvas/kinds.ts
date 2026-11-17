// One icon and tint per component kind, shared by the palette, nodes and the inspector.
import { Bot, Box, Layers, Puzzle, Sparkles, SquareFunction, User, Waypoints, type LucideIcon } from "lucide-react";
import type { NodeKind } from "@/model/types";

export interface KindStyle {
  icon: LucideIcon;
  /** icon tile: background + foreground */
  tint: string;
  label: string;
}

export const KIND_STYLE: Record<NodeKind, KindStyle> = {
  agent: { icon: Bot, tint: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300", label: "Agent" },
  model: { icon: Sparkles, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-300", label: "Model call" },
  function: { icon: SquareFunction, tint: "bg-slate-500/10 text-slate-600 dark:text-slate-300", label: "Function" },
  human: { icon: User, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-300", label: "Human" },
  env: { icon: Box, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300", label: "Environment" },
  plugin: { icon: Puzzle, tint: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300", label: "Plugin" },
  group: { icon: Layers, tint: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300", label: "Group" },
};

export const EDGE_STYLE: KindStyle = { icon: Waypoints, tint: "bg-secondary text-muted-foreground", label: "Edge" };
