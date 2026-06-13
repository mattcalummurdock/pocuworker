import type { Architecture } from "@/components/agent/types";
import { cn } from "@/lib/utils";

interface ConfigSummaryProps {
  useCase: string;
  architectureId: string;
  selectedArch?: Architecture;
  className?: string;
}

export function ConfigSummary({
  useCase,
  architectureId,
  selectedArch,
  className,
}: ConfigSummaryProps) {
  if (!useCase && !architectureId) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {useCase && (
        <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
          {useCase}
        </span>
      )}
      {selectedArch && (
        <span className="rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
          {selectedArch.name}
        </span>
      )}
    </div>
  );
}
