import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase();

  const styles =
    normalized === "completed"
      ? "text-success bg-success/10"
      : normalized === "failed"
        ? "text-destructive bg-destructive/10"
        : normalized === "running"
          ? "text-warning bg-warning/10"
          : "text-muted-foreground bg-secondary";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium capitalize",
        styles,
        className
      )}
    >
      {status}
    </span>
  );
}
