import type { ReactNode } from "react";
import { Bot, Loader2, User } from "lucide-react";
import { cn } from "@/lib/utils";

export function AgentAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/25 to-chart-1/20 ring-1 ring-accent/35",
        className
      )}
    >
      <Bot className="h-4 w-4 text-accent" strokeWidth={2.25} />
    </div>
  );
}

export function UserAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary ring-1 ring-border",
        className
      )}
    >
      <User className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <AgentAvatar />
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3">
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:0ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
      </div>
    </div>
  );
}

export function ChatWindowChrome({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl",
        "bg-gradient-to-b from-accent/[0.07] via-transparent to-accent/[0.04]",
        "p-px shadow-[0_0_0_1px_oklch(0.22_0.005_260),0_8px_40px_-12px_oklch(0_0_0/0.5),0_0_60px_-20px_oklch(0.7_0.18_145/0.15)]",
        className
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[15px] bg-card/95 backdrop-blur-sm">
        {children}
      </div>
    </div>
  );
}

export function ChatHeaderBar({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border/80 bg-secondary/30 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <AgentAvatar />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {title}
            </h2>
            <span className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              Live
            </span>
          </div>
          {subtitle && (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  disabled,
  loading,
  canSend,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  loading?: boolean;
  canSend: boolean;
}) {
  return (
    <div className="shrink-0 border-t border-border/80 bg-background/50 p-4 sm:p-5">
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-secondary/40 p-2 pl-4 shadow-inner ring-1 ring-white/[0.03] focus-within:border-accent/50 focus-within:ring-accent/20">
        <textarea
          rows={1}
          placeholder="Message the training agent…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && canSend) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={disabled}
          className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className={cn(
            "mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all",
            canSend
              ? "bg-accent text-accent-foreground shadow-[0_0_16px_oklch(0.7_0.18_145/0.4)] hover:bg-accent/90"
              : "bg-muted text-muted-foreground"
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          )}
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
