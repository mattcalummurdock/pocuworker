import { ChatMarkdown } from "@/app/components/ChatMarkdown";
import { cn } from "@/lib/utils";
import type { ChatBlock } from "@/components/agent/types";
import { stripChatFileSizes } from "@/components/agent/chat-text";
import { AgentAvatar, UserAvatar } from "@/components/agent/ChatChrome";
import { RecommendedDatasetCard, DatasetGrid } from "@/components/agent/DatasetCard";
import { JobQueuedCard } from "@/components/agent/JobQueuedCard";

function isStatusOnlyText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const statusPatterns = [
    /^Starting training pipeline/i,
    /^Inspect:/i,
    /^Prepared:/i,
    /^Downloading/i,
    /^Queueing/i,
    /^Signing/i,
  ];
  return statusPatterns.some((p) => p.test(t));
}

interface ChatMessageProps {
  block: ChatBlock;
  onStartTraining: (ref: string, title: string) => void;
  onShowAlternatives: () => void;
  onDatasetSelect: (ref: string, title: string) => void;
}

export function ChatMessage({
  block,
  onStartTraining,
  onShowAlternatives,
  onDatasetSelect,
}: ChatMessageProps) {
  const isUser = block.role === "user";
  const showText =
    block.text &&
    !(block.role === "assistant" && isStatusOnlyText(block.text) && block.dataset);

  return (
    <div
      className={cn(
        "flex w-full gap-3",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {isUser ? <UserAvatar /> : <AgentAvatar />}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-3",
          isUser ? "items-end" : "items-start"
        )}
      >
        <span className="px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {isUser ? "You" : "Agent"}
        </span>

        {showText && (
          <div
            className={cn(
              "max-w-[95%] text-sm leading-relaxed sm:max-w-[85%]",
              isUser
                ? "rounded-2xl rounded-tr-md bg-accent/15 px-4 py-3 whitespace-pre-wrap text-foreground ring-1 ring-accent/20"
                : "rounded-2xl rounded-tl-md border border-border/80 bg-background/80 px-4 py-3 text-foreground/90 shadow-sm"
            )}
          >
            {isUser ? block.text : <ChatMarkdown content={stripChatFileSizes(block.text!)} />}
          </div>
        )}

        {block.role === "assistant" && block.dataset && (
          <RecommendedDatasetCard
            dataset={block.dataset}
            onStartTraining={onStartTraining}
            onShowAlternatives={onShowAlternatives}
          />
        )}
        {block.role === "assistant" && block.datasets && block.datasets.length > 0 && (
          <DatasetGrid datasets={block.datasets} onSelect={onDatasetSelect} />
        )}
        {block.role === "assistant" && block.job && (
          <JobQueuedCard job={block.job} />
        )}
      </div>
    </div>
  );
}
