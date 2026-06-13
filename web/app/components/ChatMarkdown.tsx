import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div
      className={cn(
        "chat-markdown space-y-3 text-sm leading-relaxed",
        "[&_p]:text-foreground/85",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:text-foreground/85",
        "[&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline",
        "[&_code]:rounded [&_code]:bg-secondary/80 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
        "[&_pre]:my-2 [&_pre]:max-h-24 [&_pre]:overflow-hidden [&_pre]:rounded-lg [&_pre]:bg-secondary/40 [&_pre]:p-3 [&_pre]:text-xs [&_pre]:font-mono [&_pre]:text-muted-foreground",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-accent/40 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_strong]:font-medium [&_strong]:text-foreground",
        "[&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold"
      )}
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
