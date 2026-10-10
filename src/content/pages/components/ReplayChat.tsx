import { Button } from "@picoframe/frame";
import { Loader2, MessageSquare } from "lucide-react";
import { useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import { type ChatDest, type ChatLine, contentDemoChat } from "../../bindings";
import { ErrorBanner } from "./states";

/** Simulation frames per second of match time. */
const FRAMES_PER_SECOND = 30;
/** A line's frame before the match started. */
const PREGAME_FRAME = -1;
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
export function ChatLines({ messages }: { messages: ChatLine[] }) {
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

/** The replay's in-demo chat log, loaded on demand. */
export function ReplayChat({ replayPath }: { replayPath: string }) {
  // The replay a read belongs to, so another replay shows nothing of it.
  const [read, setRead] = useState<{
    path: string;
    status: "loading" | "failed" | "done";
    messages: ChatLine[] | null;
    incomplete: boolean;
  } | null>(null);
  const latestPath = useRef(replayPath);
  latestPath.current = replayPath;

  const current = read?.path === replayPath ? read : null;
  const messages = current?.messages ?? null;
  const incomplete = current?.incomplete ?? false;
  const loading = current?.status === "loading";
  const failed = current?.status === "failed";

  const load = async () => {
    const path = replayPath;
    setRead({ path, status: "loading", messages: null, incomplete: false });
    try {
      const res = await contentDemoChat({ replayPath: path });
      if (latestPath.current !== path) return;
      setRead({
        path,
        status: "done",
        messages: res.messages,
        incomplete: res.incomplete,
      });
    } catch {
      if (latestPath.current !== path) return;
      setRead({ path, status: "failed", messages: null, incomplete: false });
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Chat log</h2>
      {messages === null ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageSquare className="size-4" />
            )}
            {loading ? "Reading chat…" : "Show chat log"}
          </Button>
          {failed && (
            <ErrorBanner message="The chat could not be read from this replay." />
          )}
        </div>
      ) : (
        <>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No chat was recorded in this replay.
            </p>
          ) : (
            <ChatLines messages={messages} />
          )}
          {incomplete && (
            <p className="text-xs text-muted-foreground">
              This replay could not be read to the end, so the chat log may be
              incomplete.
            </p>
          )}
        </>
      )}
    </section>
  );
}
