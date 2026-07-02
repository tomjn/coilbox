import { Button, Input } from "@picoframe/frame";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ChatMsg } from "../bindings";

/** Format a unix-millis timestamp as a short local time (blank when absent). */
function formatTime(at: number): string {
  if (!at) return "";
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface ChatPaneProps {
  title: string;
  subtitle?: string;
  messages: ChatMsg[];
  /** The logged-in username, used to right-align our own messages. */
  currentUser?: string | null;
  onSend: (text: string) => void | Promise<void>;
  /** Top-bar action buttons (e.g. a members toggle). */
  headerActions?: ReactNode;
  /** `full` fills the viewport column; `embedded` fits a smaller host box. */
  variant?: "full" | "embedded";
  emptyState?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * The reusable chat surface: a top bar, an auto-scrolling message list, and a
 * bottom composer. Presentational only - it imports no store, so the hub and the
 * future battle GUI render the identical component for visual consistency.
 */
export function ChatPane({
  title,
  subtitle,
  messages,
  currentUser,
  onSend,
  headerActions,
  variant = "full",
  emptyState,
  placeholder = "Message…",
  disabled = false,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the log grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages.length is the trigger that should re-run the scroll, not read in the body
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    await onSend(text);
  }

  return (
    <section
      className={
        variant === "full"
          ? "flex min-w-0 flex-1 flex-col"
          : "flex min-h-0 flex-col rounded-md border border-border"
      }
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle && (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {headerActions && (
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-4 py-3">
        {messages.length === 0
          ? (emptyState ?? (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            ))
          : messages.map((m, i) => {
              const own = currentUser != null && m.from === currentUser;
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only log, index is stable identity.
                  key={`${m.from}-${m.at}-${i}`}
                  className={
                    own
                      ? "flex flex-col items-end"
                      : "flex flex-col items-start"
                  }
                >
                  <div
                    className={
                      own
                        ? "max-w-[75%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                        : "max-w-[75%] rounded-2xl rounded-bl-sm bg-muted px-3 py-1.5 text-sm"
                    }
                  >
                    {!own && (
                      <span className="mr-2 text-xs font-medium text-muted-foreground">
                        {m.from}
                      </span>
                    )}
                    <span className="whitespace-pre-wrap break-words">
                      {m.text}
                    </span>
                  </div>
                  <span className="px-1 pt-0.5 text-[10px] text-muted-foreground">
                    {formatTime(m.at)}
                  </span>
                </div>
              );
            })}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 border-t border-border px-4 py-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="Message"
        />
        <Button onClick={submit} disabled={disabled || draft.trim() === ""}>
          Send
        </Button>
      </div>
    </section>
  );
}
