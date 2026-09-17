import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ChatMsg } from "../bindings";
import { conversationHref } from "../chat/conversation";
import { useConnection } from "../store";
import {
  MODERATOR_CHANNEL,
  moderatorAnnouncements,
  type ParsedAnnouncement,
  parseAnnouncement,
} from "./moderatorFeed";
import { ToolHeader } from "./ToolHeader";

function fmtTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A player name in an announcement row, linking to the player lookup
 * section (issue #2777) the same way `ChatPage`'s member menu does: the
 * name pre-fills `?player=` there rather than running the lookup itself. */
function PlayerLink({ name, serverKey }: { name: string; serverKey: string }) {
  return (
    <Link
      to={`/admin?server=${encodeURIComponent(serverKey)}&player=${encodeURIComponent(name)}`}
      className="font-medium underline decoration-dotted underline-offset-2 hover:text-foreground"
    >
      {name}
    </Link>
  );
}

/**
 * A parsed announcement as a sentence, keeping ChanServ's own wording so a
 * moderator can still cross-reference it against the server's own log, but
 * with every staff or account username swapped for a link to the player
 * lookup. `banSpecific` and `unban` take a target that might be an IP or an
 * email rather than a username (uberserver accepts any of the three), so
 * only the acting staff member links there, not the target.
 */
function AnnouncementText({
  parsed,
  serverKey,
}: {
  parsed: ParsedAnnouncement;
  serverKey: string;
}): ReactNode {
  const player = (name: string) => (
    <PlayerLink name={name} serverKey={serverKey} />
  );

  switch (parsed.kind) {
    case "ban":
      return (
        <>
          {player(parsed.actor)} banned {player(parsed.target)} for{" "}
          {parsed.duration} days ({parsed.reason})
        </>
      );
    case "banSpecific":
      return (
        <>
          {player(parsed.actor)} banned-specific {parsed.target} for{" "}
          {parsed.duration} days ({parsed.reason})
        </>
      );
    case "unban":
      return (
        <>
          {player(parsed.actor)} unbanned {parsed.target}
        </>
      );
    case "blacklist":
      return (
        <>
          {player(parsed.actor)} blacklisted '{parsed.domain}' ({parsed.reason})
        </>
      );
    case "unblacklist":
      return (
        <>
          {player(parsed.actor)} un-blacklisted '{parsed.domain}'
        </>
      );
    case "newBot":
      return parsed.from ? (
        <>
          New bot: {player(parsed.target)} created by {player(parsed.actor)}{" "}
          from {player(parsed.from)}
        </>
      ) : (
        <>
          New bot: {player(parsed.target)} created by {player(parsed.actor)}
        </>
      );
    case "botflagRemoved":
      return (
        <>
          User {player(parsed.target)} had botflag removed by{" "}
          {player(parsed.actor)}
        </>
      );
    case "reload":
      return <>Reload initiated by {player(parsed.actor)}</>;
    case "cleanup":
      return <>Cleanup initiated by {player(parsed.actor)}</>;
    case "unparsed":
      return <>{parsed.text}</>;
  }
}

function AnnouncementRow({
  message,
  serverKey,
}: {
  message: ChatMsg;
  serverKey: string;
}) {
  const parsed = parseAnnouncement(message.text);
  return (
    <li className="flex flex-col gap-0.5 border-b border-border py-2 text-sm last:border-none">
      <span className="text-xs text-muted-foreground">
        {fmtTime(message.at)}
      </span>
      <span>
        <AnnouncementText parsed={parsed} serverKey={serverKey} />
      </span>
    </li>
  );
}

/**
 * The staff activity feed on the Server admin page (issue #2779): ChanServ's
 * own announcements out of `#moderator`, read straight from the connection's
 * chat state rather than any admin command, so there is nothing to send and
 * nothing that can be refused.
 *
 * Read-only by design. Moderators who want to talk to each other, or run a
 * command by typing it into `#moderator` (`ChanServ.py`'s
 * `restricted['mod']` check), still do that from Chat. This section only
 * links there.
 *
 * The empty state is honest about how far back this can go, from checking
 * uberserver's own source (`~/dev/uberserver`):
 * - `#moderator` does not store history by default. `store_history` defaults
 *   to `False` for every channel (`SQLUsers.py`), and nothing turns it on for
 *   `#moderator` when the server creates it (`DataHandler.py`'s
 *   `chanserv.Handle(":register moderator ChanServ")`). A moderator can turn
 *   it on later with ChanServ's own `:history on` in the channel.
 * - When a channel does store history, ChanServ's announcements are stored
 *   exactly like any other message. `broadcast_Moderator()` sends through
 *   `in_SAY`, and `in_SAY` persists whenever `channel.store_history` is true
 *   (`protocol/Protocol.py`), with no special case for the bot's sender.
 * - The server never replays history on `JOIN`. A client has to ask for it
 *   with `GETCHANNELMESSAGES` (`in_GETCHANNELMESSAGES`, `protocol/Protocol.py`).
 *   coilbox does ask, once, right after joining any non-battle channel
 *   (`conn.rs`), including the automatic `#moderator` join at login. So on a
 *   server that has turned history on, up to 14 days of it lands right away
 *   (`SQLUsers.py`'s cleanup job deletes `ChannelHistory` rows older than
 *   that). On the (default) server that has not, nothing does, and this
 *   feed only ever shows what arrives while coilbox stays connected.
 *
 * Opening this section does not mark `#moderator` as read in Chat. Reading
 * the feed here is not the same act as reading the channel there, and
 * marking it seen behind Chat's back would silence a mention or an unread
 * badge for a conversation nobody actually opened.
 */
export function ModeratorFeedSection({ serverKey }: { serverKey: string }) {
  const connection = useConnection(serverKey);
  const state = connection?.mirror.state ?? null;
  const announcements = moderatorAnnouncements(state);
  const channelHref = conversationHref(
    { kind: "channel", name: MODERATOR_CHANNEL },
    serverKey,
  );

  return (
    <section className="flex flex-col gap-4">
      <ToolHeader
        title="Staff activity"
        description="ChanServ's announcements of what moderators and admins did, from #moderator."
        actions={
          <Link
            to={channelHref}
            className="text-sm text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            Open #moderator in Chat
          </Link>
        }
      />
      {announcements.length === 0 ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          No staff actions yet this session. #moderator does not keep history on
          this server by default, so this feed only shows announcements that
          arrive while coilbox stays connected, not anything from before now.
        </p>
      ) : (
        <ul className="flex flex-col">
          {announcements.map((message) => (
            <AnnouncementRow
              key={`${message.at}-${message.text}`}
              message={message}
              serverKey={serverKey}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
