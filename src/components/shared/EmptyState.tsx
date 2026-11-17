// Adapted from MindRoom (https://github.com/mindroom-ai/mindroom,
// frontend/src/components/shared/EmptyState.tsx), Apache License 2.0.
import type { LucideIcon } from "lucide-react";
import { sharedStyles } from "@/lib/styles";

export function EmptyState({ icon: Icon, title, subtitle }: { icon?: LucideIcon; title: string; subtitle?: string }) {
  return (
    <div className={sharedStyles.empty.container}>
      {Icon && <Icon className={sharedStyles.empty.icon} />}
      <p className={sharedStyles.empty.title}>{title}</p>
      {subtitle && <p className={sharedStyles.empty.subtitle}>{subtitle}</p>}
    </div>
  );
}
