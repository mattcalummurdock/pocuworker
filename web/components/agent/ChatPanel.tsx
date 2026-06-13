import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Sparkles } from "lucide-react";
import type { Architecture, ChatBlock, ChatThread } from "@/components/agent/types";
import { ChatMessage } from "@/components/agent/ChatMessage";
import { ConfigSummary } from "@/components/agent/ConfigSummary";
import {
  ChatComposer,
  ChatHeaderBar,
  ChatWindowChrome,
  TypingIndicator,
} from "@/components/agent/ChatChrome";
import { PipelineStatus } from "@/components/agent/PipelineStatus";
import { SetupSheet } from "@/components/agent/SetupSheet";
import { ThreadSelect } from "@/components/agent/ThreadSelect";

interface ChatPanelProps {
  agentError: string | null;
  threadId: string | null;
  threads: ChatThread[];
  useCase: string;
  agentPickedUseCase: boolean;
  agentPickedArch: boolean;
  tierFilter: string;
  architectureId: string;
  architectures: Architecture[];
  selectedArch?: Architecture;
  chat: ChatBlock[];
  message: string;
  loading: boolean;
  pipelineStatus: string | null;
  acpProgressPct?: number;
  onThreadChange: (id: string | null) => void;
  onMessageChange: (value: string) => void;
  onSend: () => void;
  onUseCaseChange: (value: string) => void;
  onClearUseCase: () => void;
  onPresetSelect: (preset: string) => void;
  onTierFilterChange: (tier: string) => void;
  onArchitectureSelect: (id: string) => void;
  onClearArchitecture: () => void;
  onStartTraining: (ref: string, title: string) => void;
  onShowAlternatives: () => void;
  onDatasetSelect: (ref: string, title: string) => void;
}

export function ChatPanel({
  agentError,
  threadId,
  threads,
  useCase,
  agentPickedUseCase,
  agentPickedArch,
  tierFilter,
  architectureId,
  architectures,
  selectedArch,
  chat,
  message,
  loading,
  pipelineStatus,
  acpProgressPct,
  onThreadChange,
  onMessageChange,
  onSend,
  onUseCaseChange,
  onClearUseCase,
  onPresetSelect,
  onTierFilterChange,
  onArchitectureSelect,
  onClearArchitecture,
  onStartTraining,
  onShowAlternatives,
  onDatasetSelect,
}: ChatPanelProps) {
  const canSend = Boolean(message.trim()) && !loading;
  const isEmpty = chat.length === 0;
  const showTyping = loading && !pipelineStatus;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-1 flex-col py-1">
      <ChatWindowChrome>
        <ChatHeaderBar
          title="Training Agent"
          subtitle="Describe a model — I'll find data & queue training"
          actions={
            <>
              <ThreadSelect
                threadId={threadId}
                threads={threads}
                onChange={onThreadChange}
              />
              <SetupSheet
                useCase={useCase}
                agentPickedUseCase={agentPickedUseCase}
                agentPickedArch={agentPickedArch}
                tierFilter={tierFilter}
                architectureId={architectureId}
                architectures={architectures}
                selectedArch={selectedArch}
                onUseCaseChange={onUseCaseChange}
                onClearUseCase={onClearUseCase}
                onPresetSelect={onPresetSelect}
                onTierFilterChange={onTierFilterChange}
                onArchitectureSelect={onArchitectureSelect}
                onClearArchitecture={onClearArchitecture}
              />
            </>
          }
        />

        {(useCase || architectureId) && (
          <ConfigSummary
            useCase={useCase}
            architectureId={architectureId}
            selectedArch={selectedArch}
            className="border-b border-border/50 px-5 py-2.5"
          />
        )}

        {agentError && (
          <div className="mx-4 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive sm:mx-5">
            {agentError}
          </div>
        )}

        <ScrollArea className="chat-messages-surface min-h-0 flex-1">
          <div className="flex flex-col gap-6 px-4 py-6 sm:px-5">
            {isEmpty && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="relative mb-5">
                  <div className="absolute inset-0 scale-150 rounded-full bg-accent/20 blur-2xl" />
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10">
                    <MessageSquare className="h-7 w-7 text-accent" />
                  </div>
                </div>
                <p className="text-base font-medium text-foreground">
                  Start a conversation
                </p>
                <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                  Try asking for a fraud detection model or any ML use case.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-5 gap-2 border-accent/30 text-accent hover:bg-accent/10"
                  onClick={() =>
                    onMessageChange(
                      "Build a fraud detection model on credit card data"
                    )
                  }
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Try an example
                </Button>
              </div>
            )}

            {chat.map((block, i) => (
              <ChatMessage
                key={i}
                block={block}
                onStartTraining={onStartTraining}
                onShowAlternatives={onShowAlternatives}
                onDatasetSelect={onDatasetSelect}
              />
            ))}

            {showTyping && <TypingIndicator />}
          </div>
        </ScrollArea>

        {loading && pipelineStatus && (
          <div className="border-t border-border/50 px-5 py-2">
            <PipelineStatus message={pipelineStatus} progressPct={acpProgressPct} />
          </div>
        )}

        <ChatComposer
          value={message}
          onChange={onMessageChange}
          onSend={onSend}
          disabled={loading}
          loading={loading}
          canSend={canSend}
        />
      </ChatWindowChrome>
    </div>
  );
}
