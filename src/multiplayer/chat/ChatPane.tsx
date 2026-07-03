import { Button, cn, Input } from "@picoframe/frame";
import { ArrowUp, Bot } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ChatMsg } from "../bindings";
import { FormattedText } from "./FormattedText";

/** Format a unix-millis timestamp as a short local time (blank when absent). */
function formatTime(at: number): string {
  if (!at) return "";
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Messages within this window from one sender are visually grouped. */
const GROUP_WINDOW_MS = 5 * 60_000;

/** join/leave/system render as centered notices and never group. */
const isNotice = (k: ChatMsg["kind"]) =>
  k === "join" || k === "leave" || k === "system";

/**
 * Whether `b` should be grouped under `a`: same sender, close in time, neither a
 * notice. SPADS dumps command lists / stats tables as a burst of separate
 * messages, so grouping collapses the per-message name + timestamp into one.
 */
function grouped(a: ChatMsg, b: ChatMsg): boolean {
  if (isNotice(a.kind) || isNotice(b.kind)) return false;
  if (a.from !== b.from) return false;
  return Math.abs(b.at - a.at) <= GROUP_WINDOW_MS;
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
  /** Optional per-sender accent colour (`#rrggbb`), e.g. a battle player's team
   * colour. Returns undefined when the sender has no colour (channels/DMs). */
  senderColor?: (from: string) => string | undefined;
  /** Whether a sender is a bot account (SPADS autohosts included), marked with a
   * bot glyph before the name. Returns false for humans / unknown senders. */
  isBot?: (from: string) => boolean;
  /** `full` fills the viewport column; `embedded` fits a smaller host box. */
  variant?: "full" | "embedded";
  emptyState?: ReactNode;
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
  senderColor,
  isBot,
  variant = "full",
  emptyState,
  disabled = false,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
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
    setSendError(null);
    try {
      await onSend(text);
    } catch (e) {
      setDraft(text); // restore so the user doesn't lose their message
      setSendError(String(e));
    }
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

      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3">
        {messages.length === 0
          ? (emptyState ?? (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            ))
          : messages.map((m, i) => {
              const key = `${m.from}-${m.at}-${i}`;
              if (isNotice(m.kind)) {
                const color = senderColor?.(m.from);
                return (
                  <div
                    key={key}
                    className="mt-2 py-0.5 text-center text-xs text-muted-foreground first:mt-0"
                  >
                    {m.kind === "system" ? (
                      m.text
                    ) : (
                      <>
                        <span
                          className="font-medium"
                          style={color ? { color } : undefined}
                        >
                          {m.from}
                        </span>
                        {m.kind === "join"
                          ? " joined"
                          : ` left${m.text ? `: ${m.text}` : ""}`}
                      </>
                    )}
                  </div>
                );
              }
              const own = currentUser != null && m.from === currentUser;
              const color = senderColor?.(m.from);
              const bot = isBot?.(m.from) ?? false;
              // Group a run of messages from one sender: name on the first only,
              // timestamp on the last only, tight spacing between.
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const prevSame = prev != null && grouped(prev, m);
              const nextSame = next != null && grouped(m, next);
              return (
                <div
                  key={key}
                  className={cn(
                    "flex flex-col first:mt-0",
                    own ? "items-end" : "items-start",
                    prevSame ? "mt-0.5" : "mt-2",
                  )}
                >
                  {!own && !prevSame && (
                    <span
                      className={cn(
                        "mb-0.5 flex items-center gap-1 px-1 text-xs",
                        bot
                          ? "font-semibold text-foreground"
                          : "font-medium text-muted-foreground",
                      )}
                      style={color ? { color } : undefined}
                    >
                      {bot && (
                        <Bot className="size-4 shrink-0" aria-label="Bot" />
                      )}
                      {m.from}
                    </span>
                  )}
                  <div
                    className={
                      own
                        ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                        : "max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-1.5 text-sm"
                    }
                    // Wash the non-own bubble with the sender's team colour (low
                    // alpha keeps the foreground text readable in both themes).
                    style={
                      !own && color
                        ? { backgroundColor: `${color}26` }
                        : undefined
                    }
                  >
                    <span
                      className={cn(
                        "whitespace-pre-wrap break-words",
                        // Bot output (SPADS command lists / stats tables) relies
                        // on monospace alignment; human chat reads better
                        // proportional.
                        bot && "font-mono",
                      )}
                    >
                      <FormattedText text={m.text} />
                    </span>
                  </div>
                  {!nextSame && (
                    <span className="px-1 pt-0.5 text-[10px] text-muted-foreground">
                      {formatTime(m.at)}
                    </span>
                  )}
                </div>
              );
            })}
        <div ref={endRef} />
      </div>

      {sendError && (
        <p className="px-4 pb-1 text-xs text-destructive">
          Failed to send: {sendError}
        </p>
      )}

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
          placeholder="Type your message..."
          disabled={disabled}
          aria-label="Message"
          className="placeholder:italic"
        />
        <Button
          onClick={submit}
          disabled={disabled || draft.trim() === ""}
          size="icon"
          aria-label="Send"
          title="Send"
        >
          <ArrowUp className="size-4" />
        </Button>
      </div>
    </section>
  );
}
