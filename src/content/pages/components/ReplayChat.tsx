import { Button } from "@picoframe/frame";
import { Loader2, MessageSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import type { ChatDest, ChatLine } from "../../bindings";
import { FRAMES_PER_SECOND, PREGAME_FRAME } from "../../chatClock";
import { timelineDomain, toEventMarks, toMarks } from "../../replayTimeline";
import { useReplayChat } from "../../useReplayChat";
import { ReplayTimeline } from "./ReplayTimeline";
import { ErrorBanner } from "./states";

/** The player number the server speaks as. */
const SERVER = 255;

/** A line's match time, or a label for one sent before the game started. */
export function chatTime(frame: number): string {
  return frame <= PREGAME_FRAME
    ? "Pre-game"
    : formatDuration(Math.floor(frame / FRAMES_PER_SECOND));
}

function senderName(
  player: number,
  playerName: string | undefined,
  system: boolean,
): string {
  if (system) return "*";
  if (playerName) return playerName;
  return player === SERVER ? "Server" : `Player ${player}`;
}

/** "to everyone" is the default and left off. Anything narrower is labelled. */
function destLabel(
  dest: ChatDest | undefined,
  names: Map<number, string>,
): string | null {
  if (!dest || dest.kind === "everyone") return null;
  if (dest.kind === "allies") return "to allies";
  if (dest.kind === "spectators") return "to spectators";
  return `to ${names.get(dest.player) ?? `Player ${dest.player}`}`;
}

/** The chat lines, one row each with match time, sender and destination. */
export function ChatLines({
  messages,
  highlight = null,
}: {
  messages: ChatLine[];
  /** The line to scroll to and mark, from the timeline. */
  highlight?: number | null;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (highlight === null) return;
    list.current
      ?.querySelector(`[data-line="${highlight}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [highlight]);
  const names = new Map<number, string>();
  for (const m of messages) {
    if (m.playerName) names.set(m.player, m.playerName);
  }
  return (
    <ul
      ref={list}
      className="flex max-h-96 flex-col gap-1 overflow-y-auto rounded-lg border border-border/50 bg-card p-3 text-sm"
    >
      {messages.map((m, i) => {
        const dest = destLabel(m.dest, names);
        const key = `${i}-${m.frame}-${m.text}`;
        return (
          <li
            key={key}
            data-line={i}
            className={`break-words ${i === highlight ? "rounded bg-accent" : ""}`}
          >
            <span className="mr-1.5 tabular-nums text-xs text-muted-foreground">
              {chatTime(m.frame)}
            </span>
            <span
              className={`mr-1.5 font-semibold ${m.system ? "text-muted-foreground" : ""}`}
            >
              {senderName(m.player, m.playerName, m.system)}
            </span>
            {dest && (
              <span className="mr-1.5 text-xs text-muted-foreground">
                {dest}
              </span>
            )}
            <span className={m.system ? "text-muted-foreground" : ""}>
              {m.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** One line as plain text, for the timeline's readout. */
function describeLine(line: ChatLine, names: Map<number, string>): string {
  const dest = destLabel(line.dest, names);
  const who = senderName(line.player, line.playerName, line.system);
  return `${chatTime(line.frame)} ${who}${dest ? ` ${dest}` : ""} ${line.text}`;
}

/**
 * The replay's in-demo chat: a timeline along the match, and the log under it.
 * The lines are read once when the replay is shown, for both. The log's list
 * opens on a button, or at a line when its mark on the timeline is selected.
 */
export function ReplayChat({
  replayPath,
  durationSec = 0,
}: {
  replayPath: string;
  durationSec?: number;
}) {
  const { loading, failed, messages, incomplete, events } =
    useReplayChat(replayPath);
  // The replay the log was opened for, so another replay starts closed.
  const [opened, setOpened] = useState<{
    path: string;
    line: number | null;
  } | null>(null);
  const open = opened?.path === replayPath ? opened : null;

  const marks = useMemo(() => toMarks(messages ?? []), [messages]);
  const names = useMemo(() => {
    const out = new Map<number, string>();
    for (const m of messages ?? []) {
      if (m.playerName) out.set(m.player, m.playerName);
    }
    return out;
  }, [messages]);
  const eventMarks = useMemo(() => toEventMarks(events), [events]);
  const totalSec = timelineDomain(
    [...marks, ...eventMarks],
    durationSec,
    incomplete,
  );

  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Timeline</h2>
        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading chat…
          </p>
        )}
        {failed && (
          <ErrorBanner message="The chat could not be read from this replay." />
        )}
        {messages !== null &&
          (messages.length === 0 && eventMarks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No chat was recorded in this replay.
            </p>
          ) : (
            <ReplayTimeline
              marks={marks}
              events={eventMarks}
              totalSec={totalSec}
              describe={(line) => describeLine(line, names)}
              onOpenLine={(line) => setOpened({ path: replayPath, line })}
            />
          ))}
        {incomplete && (
          <p className="text-xs text-muted-foreground">
            This replay could not be read to the end, so the timeline stops at
            the last line read and may be incomplete.
          </p>
        )}
      </section>

      {(messages === null || messages.length > 0) && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Chat log</h2>
          {messages === null || !open ? (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpened({ path: replayPath, line: null })}
                disabled={messages === null}
                className="gap-1.5"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MessageSquare className="size-4" />
                )}
                {loading ? "Reading chat…" : "Show chat log"}
              </Button>
            </div>
          ) : (
            <>
              <ChatLines messages={messages} highlight={open.line} />
              {incomplete && (
                <p className="text-xs text-muted-foreground">
                  This replay could not be read to the end, so the chat log may
                  be incomplete.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
