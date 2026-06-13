import { Progress } from "@/components/ui/progress";

interface PipelineStatusProps {
  message: string;
  progressPct?: number;
}

export function PipelineStatus({ message, progressPct }: PipelineStatusProps) {
  const shortMessage =
    message.length > 72 ? `${message.slice(0, 72)}…` : message;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
        <span className="truncate">{shortMessage}</span>
        {progressPct != null && (
          <span className="shrink-0 text-accent">{progressPct}%</span>
        )}
      </div>
      {progressPct != null && (
        <Progress
          value={progressPct}
          className="h-1 bg-secondary [&_[data-slot=progress-indicator]]:bg-accent"
        />
      )}
    </div>
  );
}
