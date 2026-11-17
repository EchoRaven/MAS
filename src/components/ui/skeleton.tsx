// Copied from MindRoom (https://github.com/mindroom-ai/mindroom,
// frontend/src/components/ui/skeleton.tsx), Apache License 2.0.
import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
