// Adapted from MindRoom (https://github.com/mindroom-ai/mindroom,
// frontend/src/components/shared/EntityAvatar.tsx + AvatarImage.tsx),
// Apache License 2.0. Modified: no image fetch; deterministic tinted initials.
import { Bot, Hash, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

const TINTS = [
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
];

export function tintFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

export function EntityAvatar({
  kind,
  id,
  name,
  className,
}: {
  kind: "agent" | "run" | "system";
  id: string;
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[28%] text-xs font-semibold outline -outline-offset-1 outline-border",
        kind === "system" ? "bg-secondary text-muted-foreground" : tintFor(id),
        className,
      )}
    >
      {kind === "run" ? (
        <Hash className="h-1/2 w-1/2" />
      ) : kind === "system" ? (
        <Workflow className="h-1/2 w-1/2" />
      ) : initialsOf(name) ? (
        initialsOf(name)
      ) : (
        <Bot className="h-1/2 w-1/2" />
      )}
    </span>
  );
}
