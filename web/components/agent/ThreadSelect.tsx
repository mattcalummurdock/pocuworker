import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChatThread } from "@/components/agent/types";

interface ThreadSelectProps {
  threadId: string | null;
  threads: ChatThread[];
  onChange: (id: string | null) => void;
}

export function ThreadSelect({ threadId, threads, onChange }: ThreadSelectProps) {
  return (
    <Select
      value={threadId ?? "new"}
      onValueChange={(v) => onChange(v === "new" ? null : v)}
    >
      <SelectTrigger size="sm" className="w-[160px] border-transparent bg-secondary/50 shadow-none">
        <SelectValue placeholder="New chat" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="new">New chat</SelectItem>
        {threads.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {(t.title || "Chat").slice(0, 48)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
