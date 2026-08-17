import { Button, cn } from "@picoframe/frame";
import {
  ArrowUp,
  Bold,
  Bot,
  Code,
  Italic,
  List,
  Strikethrough,
  TextQuote,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Textarea } from "@/components/ui/textarea";
import type { ChatMsg } from "../bindings";
import { composeDraft } from "./compose";
import { EmojiPicker } from "./EmojiPicker";
import { type EmojiEntry, loadEmoji, shortcodeIndex } from "./emoji";
import {
  applyEmoji,
  closedShortcode,
  emojiMatches,
  emojiQuery,
} from "./emojiMenu";
import { FormattedText } from "./FormattedText";
import { type Format, formatSelection, listContinuation } from "./formatting";
import { applyMention, mentionMatches, mentionQuery } from "./mentionMenu";
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

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Label a unix-millis timestamp as a calendar day, spelled out in full so a
 * line from a channel's backlog can't be mistaken for one from today. */
function formatDay(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Whether a day divider belongs above `m`. True for the first dated message, so
 * a conversation always opens with the day it starts on. Messages with no
 * timestamp (`at === 0`) can't place themselves on a day, so they never divide. */
function dayChanged(prev: ChatMsg | undefined, m: ChatMsg): boolean {
  if (!m.at) return false;
  if (prev == null || !prev.at) return true;
  return !sameDay(new Date(prev.at), new Date(m.at));
}

/** The composer's formatting buttons, in toolbar order. Only the formats
 * `parseMessage` tokenizes: a button for markup we don't render would be a
 * button that appears to do nothing. */
const FORMAT_BUTTONS: { format: Format; label: string; Icon: typeof Bold }[] = [
  { format: "bold", label: "Bold", Icon: Bold },
  { format: "italic", label: "Italic", Icon: Italic },
  { format: "strike", label: "Strikethrough", Icon: Strikethrough },
  { format: "code", label: "Code", Icon: Code },
  { format: "quote", label: "Quote", Icon: TextQuote },
  { format: "bullet", label: "Bullet list", Icon: List },
];

/** A row of the composer's autocomplete menu. The two triggers share the menu
 * because they can't both be open: the caret is in one token at a time. */
type MenuOption =
  | { kind: "mention"; key: string; name: string }
  | { kind: "emoji"; key: string; entry: EmojiEntry };

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
  // A run that straddles midnight is about to be split by a day divider, so it
  // can't group across one - the window alone would let 23:59 and 00:01 group.
  if (dayChanged(a, b)) return false;
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
  /** The longest one message may be on this connection, where the protocol
   * caps it (Tachyon does, at 512). Omit where it does not. */
  maxChars?: number | null;
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
  isHighlighted,
  variant = "full",
  emptyState,
  disabled = false,
  completions,
  maxChars = null,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  // Tab-completion: cycle state persists across Tabs; the input element and a
  // pending selection let us restore the caret after the controlled re-render.
  // A range rather than an offset because the formatting buttons re-select the
  // text they wrapped, so it can be typed over or wrapped again.
  const cycleRef = useRef<TabCycle | null>(null);
  const inputElRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelectionRef = useRef<[number, number] | null>(null);
  // Autocomplete menu: the caret drives which token (if any) is being typed -
  // an `@` mention (#279) or a `:` emoji shortcode (#283). `dismissedAt`
  // remembers the token Escape closed so it stays closed until the user starts a
  // different one.
  const [caret, setCaret] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const listId = useId();
  // The emoji dataset is ~600k of JSON, so it loads on demand rather than with
  // the app. A colon in the draft is the earliest hint we get: waiting for the
  // menu's own threshold would leave a fully typed `:tada:` racing the load.
  const [emojis, setEmojis] = useState<EmojiEntry[]>([]);
  const wantsEmoji = draft.includes(":");
  useEffect(() => {
    if (!wantsEmoji) return;
    let live = true;
    loadEmoji().then((loaded) => {
      if (live) setEmojis(loaded);
    });
    return () => {
      live = false;
    };
  }, [wantsEmoji]);
  const shortcodes = useMemo(() => shortcodeIndex(emojis), [emojis]);

  // Mentions win a tie: `completions` is a real list of people in the room,
  // where an emoji is only ever a suggestion.
  const mention =
    completions && completions.length > 0 ? mentionQuery(draft, caret) : null;
  const emojiToken = mention ? null : emojiQuery(draft, caret);
  const token = mention ?? emojiToken;
  const live = token != null && token.start !== dismissedAt;
  let options: MenuOption[] = [];
  if (live && mention) {
    options = mentionMatches(mention.query, completions ?? []).map((name) => ({
      kind: "mention",
      key: name,
      name,
    }));
  } else if (live && emojiToken) {
    options = emojiMatches(emojiToken.query, emojis).map((entry) => ({
      kind: "emoji",
      key: entry.unicode,
      entry,
    }));
  }
  const menuOpen = options.length > 0;
  const active = menuOpen ? Math.min(menuIndex, options.length - 1) : 0;

  // Restart the selection at the top whenever the token being typed changes, so
  // the first match is always the default Enter/Tab target. Leaving the token
  // also clears an Escape dismissal, so a later `@` at the same offset (the old
  // one deleted and retyped) opens the menu again.
  const queryKey = token ? `${token.start}:${token.query}` : null;
  useEffect(() => {
    setMenuIndex(0);
    if (queryKey == null) setDismissedAt(null);
  }, [queryKey]);

  // Runs every render to apply a queued caret move from Tab-completion or a
  // toolbar insert (the controlled input resets the caret to the end on each
  // change), then clears it.
  useEffect(() => {
    if (pendingSelectionRef.current != null && inputElRef.current) {
      const [start, end] = pendingSelectionRef.current;
      inputElRef.current.setSelectionRange(start, end);
      pendingSelectionRef.current = null;
    }
  });

  // Grow the composer with its content up to the max height the class sets,
  // then let it scroll. Measured rather than left to `field-sizing: content`,
  // which the three webviews we ship on don't support alike. Reset to `auto`
  // first so the box also shrinks back (e.g. once a send clears the draft).
  // biome-ignore lint/correctness/useExhaustiveDependencies: remeasured when the draft changes, which is what changes the height
  useEffect(() => {
    const el = inputElRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  function onTab(el: HTMLTextAreaElement): boolean {
    if (!completions || completions.length === 0) return false;
    const cursor = el.selectionStart ?? draft.length;
    const result = completeNick(draft, cursor, completions, cycleRef.current);
    if (!result) return false;
    cycleRef.current = result.cycle;
    pendingSelectionRef.current = [result.cursor, result.cursor];
    setDraft(result.value);
    return true;
  }

  /** Insert `option` over the token being typed, which closes the menu. */
  function insertOption(option: MenuOption) {
    if (!token) return;
    const result =
      option.kind === "mention"
        ? applyMention(draft, token.start, caret, option.name)
        : applyEmoji(draft, token.start, caret, option.entry.unicode);
    cycleRef.current = null;
    pendingSelectionRef.current = [result.cursor, result.cursor];
    setDraft(result.value);
    setCaret(result.cursor);
    inputElRef.current?.focus();
  }

  /** Take a change from the textarea, substituting a `:shortcode:` the user has
   * just closed. Typing one out in full is the other half of the menu: someone
   * who knows `:tada:` shouldn't have to look at a list to get 🎉. An unknown
   * shortcode is left exactly as typed. */
  function onDraftChange(value: string, cursor: number) {
    const closed = closedShortcode(value, cursor);
    const unicode = closed && shortcodes.get(closed.name);
    if (closed && unicode) {
      const result = applyEmoji(value, closed.start, cursor, unicode);
      cycleRef.current = null;
      pendingSelectionRef.current = [result.cursor, result.cursor];
      setDraft(result.value);
      setCaret(result.cursor);
      return;
    }
    setDraft(value);
    setCaret(cursor);
  }

  /** Insert a picked emoji over the composer's selection. The picker takes focus
   * while it's open, so the caret is wherever the draft was left. */
  function insertEmoji(unicode: string) {
    const el = inputElRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? start;
    const result = applyEmoji(draft, start, end, unicode);
    cycleRef.current = null;
    pendingSelectionRef.current = [result.cursor, result.cursor];
    setDraft(result.value);
    setCaret(result.cursor);
    el?.focus();
  }

  /** Break the line and open the next one with `marker`, replacing whatever was
   * selected the way a plain newline would. */
  function continueList(el: HTMLTextAreaElement, marker: string) {
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? start;
    const inserted = `\n${marker}`;
    const caret = start + inserted.length;
    cycleRef.current = null;
    pendingSelectionRef.current = [caret, caret];
    setDraft(draft.slice(0, start) + inserted + draft.slice(end));
    setCaret(caret);
  }

  /** Format the composer's selection, keeping the formatted text selected so it
   * can be typed over or formatted again. */
  function applyFormat(format: Format) {
    const el = inputElRef.current;
    if (!el || disabled) return;
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? start;
    const result = formatSelection(draft, start, end, format);
    cycleRef.current = null;
    pendingSelectionRef.current = [result.start, result.end];
    setDraft(result.value);
    setCaret(result.end);
    el.focus();
  }

  async function submit() {
    if (disabled) return;
    const composed = composeDraft(draft, maxChars);
    if (composed.kind === "error") {
      setSendError(composed.reason);
      return;
    }
    const lines = composed.lines;
    if (lines.length === 0) return;
    setDraft("");
    setSendError(null);
    // One command per line, awaited in turn: concurrent sends can reach the
    // socket out of order and scramble the message. On a failure only the lines
    // that never went out are restored - putting the whole draft back would
    // duplicate the published ones on the next Enter.
    for (const [i, line] of lines.entries()) {
      try {
        await onSend(line);
      } catch (e) {
        setDraft(lines.slice(i).join("\n"));
        setSendError(String(e));
        return;
      }
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
            {titleIsBot && <Bot className="size-4 shrink-0" aria-label="Bot" />}
            <span className="truncate">{title}</span>
          </h2>
          {(subtitle || titlePresence) && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
              <span className="truncate">
                {subtitle ??
                  (titlePresence ? PRESENCE_META[titlePresence].label : null)}
              </span>
            </p>
          )}
        </div>
        {headerActions && (
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
          </div>
        )}
      </header>

      {/* Auto-scrolling log: pins to the newest message only while the reader is
          already at the bottom, and surfaces a scroll-to-latest button otherwise
          (via @shadcn/react's headless message-scroller). */}
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="px-4 py-3">
            <MessageScrollerContent>
              {messages.length === 0
                ? (emptyState ?? (
                    <p className="text-sm text-muted-foreground">
                      No messages yet.
                    </p>
                  ))
                : messages.map((m, i) => {
                    const key = `${m.from}-${m.at}-${i}`;
                    const own = currentUser != null && m.from === currentUser;
                    // Group a run of messages from one sender: name on the first
                    // only, timestamp on the last only, tight spacing between.
                    const prev = messages[i - 1];
                    const next = messages[i + 1];
                    const prevSame = prev != null && grouped(prev, m);
                    const nextSame = next != null && grouped(m, next);
                    // Spacing rides on the MessageScrollerItem (the flex child) so
                    // it survives the wrapper - the old `first:mt-0` broke once
                    // each message became the only child of its own item.
                    const spacing =
                      i === 0 ? "mt-0" : prevSame ? "mt-0.5" : "mt-2";

                    let body: ReactNode;
                    if (isNotice(m.kind)) {
                      const color = senderColor?.(m.from);
                      body = (
                        <div className="py-0.5 text-center text-xs text-muted-foreground">
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
                    } else if (isAction(m.kind)) {
                      // IRC-style emote: `* alice waves`, full-width and italic,
                      // sender tinted. Reads the same whoever sent it (no
                      // own/other bubble). Bots keep their glyph + monospace here
                      // too (SPADS autohosts also emit `/me` lines).
                      const color = senderColor?.(m.from);
                      const bot = isBot?.(m.from) ?? false;
                      body = (
                        <div className="px-1 text-sm italic text-muted-foreground [overflow-wrap:anywhere]">
                          {"* "}
                          <span
                            className="inline-flex items-center gap-1 align-middle font-medium not-italic"
                            style={color ? { color } : undefined}
                          >
                            {bot && (
                              <Bot
                                className="size-4 shrink-0"
                                aria-label="Bot"
                              />
                            )}
                            {m.from}
                          </span>{" "}
                          <span className={cn(bot && "font-mono")}>
                            <FormattedText text={m.text} />
                          </span>
                        </div>
                      );
                    } else {
                      const color = senderColor?.(m.from);
                      const bot = isBot?.(m.from) ?? false;
                      const highlighted = isHighlighted?.(m) ?? false;
                      body = (
                        <div
                          className={cn(
                            "flex flex-col",
                            own ? "items-end" : "items-start",
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
                                <Bot
                                  className="size-4 shrink-0"
                                  aria-label="Bot"
                                />
                              )}
                              {m.from}
                            </span>
                          )}
                          <div
                            className={cn(
                              own
                                ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                                : "max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-1.5 text-sm",
                              // Mention: accent ring so a flagged message stands
                              // out in the log.
                              highlighted && "ring-2 ring-amber-400/60",
                            )}
                            // Wash the non-own bubble with the sender's team colour
                            // (low alpha keeps the foreground text readable in both
                            // themes).
                            style={
                              !own && color
                                ? { backgroundColor: `${color}26` }
                                : undefined
                            }
                          >
                            <span
                              className={cn(
                                "whitespace-pre-wrap [overflow-wrap:anywhere]",
                                // Bot output (SPADS command lists / stats tables)
                                // relies on monospace alignment; human chat reads
                                // better proportional.
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
                    }

                    return (
                      <MessageScrollerItem
                        key={key}
                        messageId={key}
                        className={spacing}
                      >
                        {dayChanged(prev, m) && (
                          <div className="flex items-center gap-3 py-2">
                            <span className="h-px flex-1 bg-border" />
                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {formatDay(m.at)}
                            </span>
                            <span className="h-px flex-1 bg-border" />
                          </div>
                        )}
                        {body}
                      </MessageScrollerItem>
                    );
                  })}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <div className="px-4 py-3">
        {sendError && (
          <p className="pb-1 text-xs text-destructive">
            Failed to send: {sendError}
          </p>
        )}
        {/* The draft sits on its own row above the toolbar, so the buttons stay
            put on the last line as the composer grows rather than floating in
            the middle of the block. */}
        <div className="relative rounded-2xl border border-input bg-background px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring">
          {menuOpen && (
            <div
              id={listId}
              role="listbox"
              aria-label={mention ? "Mention a user" : "Insert an emoji"}
              className="absolute bottom-full left-0 z-10 mb-2 max-h-48 w-64 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
            >
              {options.map((option, i) => (
                <div
                  key={option.key}
                  id={`${listId}-${i}`}
                  role="option"
                  // The composer keeps focus (it owns the keyboard); -1 keeps
                  // options out of the tab order but still programmatically
                  // focusable, per the ARIA combobox pattern.
                  tabIndex={-1}
                  aria-selected={i === active}
                  // Insert on mousedown: clicking must not blur the composer
                  // first, or the caret (and so the token) is gone by click.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertOption(option);
                  }}
                  onMouseEnter={() => setMenuIndex(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                    i === active && "bg-accent text-accent-foreground",
                  )}
                >
                  {option.kind === "mention" ? (
                    <span className="truncate">{option.name}</span>
                  ) : (
                    <>
                      <span className="text-base leading-none">
                        {option.entry.unicode}
                      </span>
                      <span className="truncate text-muted-foreground">
                        :{option.entry.shortcodes[0]}:
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <Textarea
            ref={inputElRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              onDraftChange(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length,
              );
            }}
            onSelect={(e) => {
              setCaret(e.currentTarget.selectionStart ?? draft.length);
            }}
            role="combobox"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? listId : undefined}
            aria-activedescendant={menuOpen ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            onKeyDown={(e) => {
              if (menuOpen) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMenuIndex((active + 1) % options.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMenuIndex((active - 1 + options.length) % options.length);
                  return;
                }
                // Shift+Enter belongs to the composer even with the menu open:
                // the menu owns bare Enter, a new line is the other rule.
                if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                  e.preventDefault();
                  insertOption(options[active]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDismissedAt(token?.start ?? null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
                return;
              }
              // Shift+Enter on a bullet line opens the next one with the same
              // marker. A list takes two lines to be a list, so without this the
              // second one is the user's job every time.
              if (e.key === "Enter" && e.shiftKey) {
                const el = e.currentTarget;
                const start = el.selectionStart ?? draft.length;
                const marker = listContinuation(draft, start);
                if (marker) {
                  e.preventDefault();
                  continueList(el, marker);
                }
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
            // Height is driven by the auto-grow effect; the cap here is what it
            // grows to before the box scrolls instead. `resize-none` because a
            // drag handle would fight that effect.
            //
            // The box around this is the input, as far as the reader is
            // concerned - it draws the border, the focus ring and the
            // background, and the toolbar sits inside it. So the textarea has to
            // disappear into it. `dark:bg-transparent` rather than
            // `bg-transparent` alone because Textarea's own `dark:bg-input/30`
            // is variant-prefixed: an unprefixed utility never overrides it, and
            // tailwind-merge keeps both as non-conflicting.
            className="max-h-32 min-h-0 resize-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0 dark:bg-transparent placeholder:italic"
          />
          <div className="flex items-center gap-0.5">
            <EmojiPicker onPick={insertEmoji} disabled={disabled} />
            {FORMAT_BUTTONS.map(({ format, label, Icon }) => (
              <Button
                key={format}
                // The composer owns the keyboard and the selection the wrap
                // applies to; a real click would blur it away first.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat(format)}
                disabled={disabled}
                variant="ghost"
                size="icon"
                aria-label={label}
                title={label}
                className="size-7 shrink-0 rounded-md text-muted-foreground"
              >
                <Icon className="size-4" />
              </Button>
            ))}
            <div className="flex-1" />
            <Button
              onClick={submit}
              disabled={disabled || draft.trim() === ""}
              size="icon"
              aria-label="Send"
              title="Send"
              className="size-8 shrink-0 rounded-full"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
