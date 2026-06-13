"use client";

import { SlidersHorizontal } from "lucide-react";
import type { Architecture } from "@/components/agent/types";
import { USE_CASE_CHIPS } from "@/components/agent/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface SetupSheetProps {
  useCase: string;
  agentPickedUseCase: boolean;
  agentPickedArch: boolean;
  tierFilter: string;
  architectureId: string;
  architectures: Architecture[];
  selectedArch?: Architecture;
  onUseCaseChange: (value: string) => void;
  onClearUseCase: () => void;
  onPresetSelect: (preset: string) => void;
  onTierFilterChange: (tier: string) => void;
  onArchitectureSelect: (id: string) => void;
  onClearArchitecture: () => void;
}

export function SetupSheet({
  useCase,
  agentPickedUseCase,
  agentPickedArch,
  tierFilter,
  architectureId,
  architectures,
  selectedArch,
  onUseCaseChange,
  onClearUseCase,
  onPresetSelect,
  onTierFilterChange,
  onArchitectureSelect,
  onClearArchitecture,
}: SetupSheetProps) {
  const filtered = architectures.filter(
    (a) => !tierFilter || a.tier === tierFilter
  );

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Setup
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="gap-0 overflow-y-auto">
        <SheetHeader className="pb-6">
          <SheetTitle>Training setup</SheetTitle>
          <SheetDescription>
            Optional — the agent can infer these from your chat.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-8 px-6 pb-8">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Use case</Label>
              {useCase && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={onClearUseCase}
                >
                  Clear
                </Button>
              )}
            </div>
            <Input
              placeholder="What do you want to build?"
              value={useCase}
              onChange={(e) => onUseCaseChange(e.target.value)}
            />
            {agentPickedUseCase && useCase && (
              <p className="text-xs text-accent">Set by agent</p>
            )}
            <Select
              value={
                USE_CASE_CHIPS.includes(
                  useCase as (typeof USE_CASE_CHIPS)[number]
                )
                  ? useCase
                  : "none"
              }
              onValueChange={(v) => v !== "none" && onPresetSelect(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Pick a template…</SelectItem>
                {USE_CASE_CHIPS.map((chip) => (
                  <SelectItem key={chip} value={chip}>{chip}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Model Architecture</Label>
              {architectureId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={onClearArchitecture}
                >
                  Clear
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {["", "low", "mid"].map((t) => (
                <Button
                  key={t || "all"}
                  type="button"
                  size="sm"
                  variant={tierFilter === t ? "default" : "secondary"}
                  className={cn(
                    "capitalize",
                    tierFilter === t &&
                      "bg-accent text-accent-foreground hover:bg-accent/90"
                  )}
                  onClick={() => onTierFilterChange(t)}
                >
                  {t || "All"}
                </Button>
              ))}
            </div>
            <Select
              value={architectureId || "none"}
              onValueChange={(v) => v !== "none" && onArchitectureSelect(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select architecture" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select architecture…</SelectItem>
                {filtered.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.tier} · {a.taskType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedArch && agentPickedArch && (
              <p className="text-xs text-muted-foreground">Picked by agent</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
