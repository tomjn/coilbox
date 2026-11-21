import { t } from "@lingui/core/macro";
import { useLingui as useLocale } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2, MessageSquare } from "lucide-react";
import { useState } from "react";
import { formatDuration } from "@/lib/format";
import type { ChatDest, ChatLine } from "../../bindings";
import { FRAMES_PER_SECOND, PREGAME_FRAME } from "../../chatClock";
import { useReplayChat } from "../../useReplayChat";
import { SectionHelp } from "./SectionHelp";
import { ErrorBanner } from "./states";

/** The player number the server speaks as. */
const SERVER = 255;

/** A line's match time, or a label for one sent before the game started. */
export function chatTime(frame: number): string {
  return frame <= PREGAME_FRAME
    ? t`Pre-game`
    : formatDuration(Math.floor(frame / FRAMES_PER_SECOND));
}

function senderName(
  player: number,
  playerName: string | undefined,
  system: boolean,
): string {
  if (system) return "*";
  if (playerName) return playerName;
  if (player === SERVER) return t`Server`;
  return t`Player ${player}`;
}

/** "to everyone" is the default and left off. Anything narrower is labelled. */
function destLabel(
  dest: ChatDest | undefined,
  names: Map<number, string>,
): string | null {
  if (!dest || dest.kind === "everyone") return null;
  if (dest.kind === "allies") return t`to allies`;
  if (dest.kind === "spectators") return t`to spectators`;
  const target = names.get(dest.player) ?? t`Player ${dest.player}`;
  return t`to ${target}`;
}

/** The chat lines, one row each with match time, sender and destination. */
export function ChatLines({ messages }: { messages: ChatLine[] }) {
  useLocale();
  const names = new Map<number, string>();
  for (const m of messages) {
    if (m.playerName) names.set(m.player, m.playerName);
  }
  return (
    <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto rounded-lg border border-border/50 bg-card p-3 text-sm">
      {messages.map((m, i) => {
        const dest = destLabel(m.dest, names);
        const key = `${i}-${m.frame}-${m.text}`;
        return (
          <li key={key} className="break-words">
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

/**
 * The replay's in-demo chat log. The lines are read once when the replay is
 * shown. The list opens on a button. The chat along the match is a lane of the
 * timeline dock, which reads the same lines.
 */
export function ReplayChat({ replayPath }: { replayPath: string }) {
  useLocale();
  const { loading, failed, messages, incomplete } = useReplayChat(replayPath);
  // The replay the log was opened for, so another replay starts closed.
  const [openedPath, setOpenedPath] = useState<string | null>(null);
  const open = openedPath === replayPath;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-medium">
          <Trans>Chat log</Trans>
        </h2>
        <SectionHelp section={t`the chat log`} source="stream" />
      </div>
      {failed && (
        <ErrorBanner
          message={t`The chat could not be read from this replay.`}
        />
      )}
      {messages?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>No chat was recorded in this replay.</Trans>
        </p>
      ) : failed ? null : messages === null || !open ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpenedPath(replayPath)}
            disabled={messages === null}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageSquare className="size-4" />
            )}
            {loading ? t`Reading chat…` : t`Show chat log`}
          </Button>
        </div>
      ) : (
        <>
          <ChatLines messages={messages} />
          {incomplete && (
            <p className="text-xs text-muted-foreground">
              <Trans>
                This replay could not be read to the end, so the chat log may be
                incomplete.
              </Trans>
            </p>
          )}
        </>
      )}
    </section>
  );
}
