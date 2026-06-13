import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { USE_CASE_CHIPS } from "@/components/agent/types";

interface UseCaseChipsProps {
  useCase: string;
  agentPickedUseCase: boolean;
  onSelect: (chip: string) => void;
}

export function UseCaseChips({
  useCase,
  agentPickedUseCase,
  onSelect,
}: UseCaseChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {USE_CASE_CHIPS.map((chip) => {
        const selected = useCase === chip;
        return (
          <button
            key={chip}
            type="button"
            onClick={() => onSelect(chip)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200",
              selected
                ? "border-accent bg-accent/15 text-accent"
                : "border-border bg-secondary/50 text-muted-foreground hover:border-accent/50 hover:text-foreground"
            )}
          >
            {chip}
            {selected && agentPickedUseCase && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                AI
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface SetupPanelProps {
  useCase: string;
  agentPickedUseCase: boolean;
  onUseCaseChange: (value: string) => void;
  onClearUseCase: () => void;
  onChipSelect: (chip: string) => void;
}

export function UseCasePanel({
  useCase,
  agentPickedUseCase,
  onUseCaseChange,
  onClearUseCase,
  onChipSelect,
}: SetupPanelProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-all duration-300 hover:border-accent/50">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">What do you want to build?</h2>
        {useCase && (
          <Button type="button" variant="outline" size="sm" onClick={onClearUseCase}>
            Clear
          </Button>
        )}
      </div>
      <Input
        className="mb-3"
        placeholder="e.g. Fraud detection on credit card transactions"
        value={useCase}
        onChange={(e) => onUseCaseChange(e.target.value)}
      />
      {agentPickedUseCase && useCase && (
        <p className="mb-3 text-xs text-accent">Use case inferred from your chat</p>
      )}
      <UseCaseChips
        useCase={useCase}
        agentPickedUseCase={agentPickedUseCase}
        onSelect={onChipSelect}
      />
    </div>
  );
}
