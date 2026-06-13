import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Architecture } from "@/components/agent/types";

interface ArchitecturePickerProps {
  architectures: Architecture[];
  tierFilter: string;
  architectureId: string;
  agentPickedArch: boolean;
  selectedArch?: Architecture;
  onTierFilterChange: (tier: string) => void;
  onSelect: (id: string) => void;
  onClear: () => void;
}

export function ArchitecturePicker({
  architectures,
  tierFilter,
  architectureId,
  agentPickedArch,
  selectedArch,
  onTierFilterChange,
  onSelect,
  onClear,
}: ArchitecturePickerProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-all duration-300 hover:border-accent/50">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Model Architecture</h2>
        <div className="flex items-center gap-2">
          {["", "low", "mid"].map((t) => (
            <Button
              key={t || "all"}
              type="button"
              size="sm"
              variant={tierFilter === t ? "default" : "secondary"}
              className={cn(
                "h-7 text-xs capitalize",
                tierFilter === t && "bg-accent text-accent-foreground hover:bg-accent/90"
              )}
              onClick={() => onTierFilterChange(t)}
            >
              {t || "all"}
            </Button>
          ))}
          {architectureId && (
            <Button type="button" variant="outline" size="sm" onClick={onClear}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {selectedArch && (
        <p className="mb-3 text-sm text-accent">
          Selected: <strong>{selectedArch.name}</strong> ({selectedArch.id})
          {agentPickedArch && (
            <span className="ml-2 text-xs text-muted-foreground">
              · picked by agent
            </span>
          )}
        </p>
      )}

      <div className="flex max-h-[280px] flex-col gap-2 overflow-y-auto">
        {architectures.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id)}
            className={cn(
              "rounded-lg border p-3 text-left transition-all duration-200 hover:bg-secondary/50",
              architectureId === a.id
                ? "border-accent bg-accent/5"
                : "border-border bg-background"
            )}
          >
            <div className="text-sm font-semibold">{a.name}</div>
            <div className="text-xs text-muted-foreground">
              {a.tier} · {a.taskType} · ≤{a.maxInputDim} features
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
