import { Button, cn, Input } from "@picoframe/frame";
import { ArrowUp, Bot } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ChatMsg } from "../bindings";
import { CountryFlag } from "../UserBadges";
import { FormattedText } from "./FormattedText";
import { PRESENCE_META, type Presence } from "./presence";
import { completeNick, type TabCycle } from "./tabComplete";

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

/** `/me` action / emote messages render as a distinct `* user text` line. */
const isAction = (k: ChatMsg["kind"]) => k === "saidEx";

/**
 * Whether `b` should be grouped under `a`: same sender, close in time, neither a
 * notice nor an action. SPADS dumps command lists / stats tables as a burst of
 * separate messages, so grouping collapses the per-message name + timestamp into
 * one.
 */
function grouped(a: ChatMsg, b: ChatMsg): boolean {
  if (isNotice(a.kind) || isNotice(b.kind)) return false;
  if (isAction(a.kind) || isAction(b.kind)) return false;
  if (a.from !== b.from) return false;
  return Math.abs(b.at - a.at) <= GROUP_WINDOW_MS;
}

export interface ChatPaneProps {
  title: string;
  subtitle?: string;
  /** Show a bot glyph before the title (e.g. a DM with an autohost). */
  titleIsBot?: boolean;
  /** Presence dot + label for a single-subject conversation (DMs); omit
   * otherwise. Richer than online/offline: away/in-battle/in-game too. */
  titlePresence?: Presence;
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
  /** A sender's ISO alpha-2 country code (from ADDUSER), rendered as a flag next
   * to their name. Returns undefined for bots / unknown / placeholder senders. */
  countryFor?: (from: string) => string | undefined;
  /** Whether a message matches the user's highlight words / own-username (issue
   * #193). Matched bubbles get an accent ring. Defaults to never when omitted. */
  isHighlighted?: (m: ChatMsg) => boolean;
  /** `full` fills the viewport column; `embedded` fits a smaller host box. */
  variant?: "full" | "embedded";
  emptyState?: ReactNode;
  disabled?: boolean;
  /** Nick candidates for Tab-completion (channel/battle members, DM peer).
   * Omit to disable completion (Tab keeps its default focus behaviour). */
  completions?: string[];
}

/**
 * The reusable chat surface: a top bar, an auto-scrolling message list, and a
 * bottom composer. Presentational only - it imports no store, so the hub and the
 * future battle GUI render the identical component for visual consistency.
 */
export function ChatPane({
  title,
  subtitle,
  titleIsBot = false,
  titlePresence,
  messages,
  currentUser,
  onSend,
  headerActions,
  senderColor,
  isBot,
  countryFor,
  isHighlighted,
  variant = "full",
  emptyState,
  disabled = false,
  completions,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Tab-completion: cycle state persists across Tabs; the input element and a
  // pending caret offset let us restore the selection after the controlled
  // re-render (picoframe's Input doesn't forward a ref, so we grab the element
  // from the keydown event).
  const cycleRef = useRef<TabCycle | null>(null);
  const inputElRef = useRef<HTMLInputElement | null>(null);
  const pendingCursorRef = useRef<number | null>(null);

  // Runs every render to apply a queued caret move from Tab-completion (the
  // controlled Input resets the caret to the end on each change), then clears it.
  useEffect(() => {
    if (pendingCursorRef.current != null && inputElRef.current) {
      const c = pendingCursorRef.current;
      inputElRef.current.setSelectionRange(c, c);
      pendingCursorRef.current = null;
    }
  });

  function onTab(el: HTMLInputElement): boolean {
    if (!completions || completions.length === 0) return false;
    const cursor = el.selectionStart ?? draft.length;
    const result = completeNick(draft, cursor, completions, cycleRef.current);
    if (!result) return false;
    inputElRef.current = el;
    cycleRef.current = result.cycle;
    pendingCursorRef.current = result.cursor;
    setDraft(result.value);
    return true;
  }

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
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            {titlePresence && (
              <span
                role="img"
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  PRESENCE_META[titlePresence].dotClass,
                )}
                aria-label={PRESENCE_META[titlePresence].label}
                title={PRESENCE_META[titlePresence].label}
              />
            )}
            {titleIsBot && <Bot className="size-4 shrink-0" aria-label="Bot" />}
            <span className="truncate">{title}</span>
          </h2>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : titlePresence ? (
            <p className="truncate text-xs text-muted-foreground">
              {PRESENCE_META[titlePresence].label}
            </p>
          ) : null}
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
                const country = countryFor?.(m.from);
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
                          className="inline-flex items-center gap-1 align-middle font-medium"
                          style={color ? { color } : undefined}
                        >
                          {country && <CountryFlag country={country} />}
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
              if (isAction(m.kind)) {
                // IRC-style emote: `* alice waves`, full-width and italic, sender
                // tinted. Reads the same whoever sent it (no own/other bubble).
                // Bots keep their glyph + monospace here too (SPADS autohosts also
                // emit `/me` lines), so the special treatment isn't bypassed.
                const color = senderColor?.(m.from);
                const bot = isBot?.(m.from) ?? false;
                const country = countryFor?.(m.from);
                return (
                  <div
                    key={key}
                    className="mt-2 px-1 text-sm italic text-muted-foreground first:mt-0 [overflow-wrap:anywhere]"
                  >
                    {"* "}
                    <span
                      className="inline-flex items-center gap-1 align-middle font-medium not-italic"
                      style={color ? { color } : undefined}
                    >
                      {bot && (
                        <Bot className="size-4 shrink-0" aria-label="Bot" />
                      )}
                      {country && <CountryFlag country={country} />}
                      {m.from}
                    </span>{" "}
                    <span className={cn(bot && "font-mono")}>
                      <FormattedText text={m.text} />
                    </span>
                  </div>
                );
              }
              const own = currentUser != null && m.from === currentUser;
              const color = senderColor?.(m.from);
              const bot = isBot?.(m.from) ?? false;
              const country = countryFor?.(m.from);
              const highlighted = isHighlighted?.(m) ?? false;
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
                      {country && <CountryFlag country={country} />}
                      {m.from}
                    </span>
                  )}
                  <div
                    className={cn(
                      own
                        ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                        : "max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-1.5 text-sm",
                      // Mention: accent ring so a flagged message stands out in the log.
                      highlighted && "ring-2 ring-amber-400/60",
                    )}
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
                        "whitespace-pre-wrap [overflow-wrap:anywhere]",
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
              return;
            }
            if (
              e.key === "Tab" &&
              !e.shiftKey &&
              !e.ctrlKey &&
              !e.metaKey &&
              !e.altKey
            ) {
              // Only trap Tab when we actually complete something; otherwise let
              // it move focus normally.
              if (onTab(e.currentTarget)) e.preventDefault();
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
