import type { ChatMsg, LobbyState } from "../bindings";

/** The bot account every staff-action announcement in `#moderator` arrives
 * from. uberserver's `broadcast_Moderator()` (`protocol/Protocol.py`) always
 * routes through `in_SAY(self._root.chanserv, 'moderator', message)`, so an
 * announcement is indistinguishable from ordinary chat except by sender. */
const CHANSERV = "ChanServ";

export const MODERATOR_CHANNEL = "moderator";

/**
 * ChanServ's own lines out of `#moderator`'s mirror state, for a live feed
 * of staff actions (issue #2779). Never a message a moderator typed
 * themselves, the issue keeps ordinary staff chat in Chat, only this bot's
 * announcements come to the Server admin page.
 *
 * Reads one connection's own state, since coilbox can hold several lobby
 * connections at once and `#moderator` on one must never leak into the feed
 * for another (each has its own `LobbyState`, so a caller reading through
 * `useConnection(serverKey)` already scopes this correctly).
 */
export function moderatorAnnouncements(state: LobbyState | null): ChatMsg[] {
  if (!state) return [];
  const messages = state.channels?.[MODERATOR_CHANNEL]?.messages ?? [];
  return messages.filter((m) => m.from === CHANSERV);
}

/**
 * Every shape `broadcast_Moderator()` sends, copied verbatim from
 * `protocol/Protocol.py` in uberserver (line numbers as of this issue):
 *
 * - `"%s banned <%s> for %s days (%s)"` (3599, `in_BAN`)
 * - `"%s banned-specific <%s> for %s days (%s)"` (3605, `in_BANSPECIFIC`)
 * - `"%s unbanned <%s>"` (3611, `in_UNBAN`)
 * - `"%s blacklisted '%s' (%s)"` (3617, `in_BLACKLIST`)
 * - `"%s un-blacklisted '%s'"` (3623, `in_UNBLACKLIST`)
 * - `'New bot: <%s> created by <%s> from <%s>'` (1546, `in_CREATEBOTACCOUNT`)
 * - `'New bot: <%s> created by <%s>'` (3358, `in_SETBOTMODE` turning bot on)
 * - `'User <%s> had botflag removed by <%s>'` (3360, `in_SETBOTMODE` off)
 * - `'Reload initiated by <%s>'` (3726, `in_RELOAD`)
 * - `'Cleanup initiated by <%s>'` (3741, scheduled cleanup run by an admin)
 *
 * Note `in_KICK` never calls `broadcast_Moderator` at all, so a plain kick
 * never appears here, only a ban (which kicks as a side effect).
 *
 * Everything else ChanServ says into `#moderator` has no staff member acting
 * on a target: `'New: %s %s %s'` (1105, a fresh registration), `'Agr: ...'`
 * (1496, agreement accepted), a flood-breach report (`Client.py:273`), and
 * `'Cleanup initiated by server error'` (3744, no `<>`, so it never matches
 * the pattern above). Those are returned as `unparsed` so they still show as
 * a row instead of vanishing.
 */
export type ParsedAnnouncement =
  | {
      kind: "ban";
      actor: string;
      target: string;
      duration: string;
      reason: string;
    }
  | {
      kind: "banSpecific";
      actor: string;
      target: string;
      duration: string;
      reason: string;
    }
  | { kind: "unban"; actor: string; target: string }
  | { kind: "blacklist"; actor: string; domain: string; reason: string }
  | { kind: "unblacklist"; actor: string; domain: string }
  | { kind: "newBot"; actor: string; target: string; from: string | null }
  | { kind: "botflagRemoved"; actor: string; target: string }
  | { kind: "reload"; actor: string }
  | { kind: "cleanup"; actor: string }
  | { kind: "unparsed"; text: string };

export function parseAnnouncement(text: string): ParsedAnnouncement {
  let m: RegExpExecArray | null;

  m = /^(\S+) banned-specific <([^>]+)> for (\S+) days \((.*)\)$/.exec(text);
  if (m) {
    return {
      kind: "banSpecific",
      actor: m[1],
      target: m[2],
      duration: m[3],
      reason: m[4],
    };
  }

  m = /^(\S+) banned <([^>]+)> for (\S+) days \((.*)\)$/.exec(text);
  if (m) {
    return {
      kind: "ban",
      actor: m[1],
      target: m[2],
      duration: m[3],
      reason: m[4],
    };
  }

  m = /^(\S+) unbanned <([^>]+)>$/.exec(text);
  if (m) return { kind: "unban", actor: m[1], target: m[2] };

  m = /^(\S+) blacklisted '([^']+)' \((.*)\)$/.exec(text);
  if (m) return { kind: "blacklist", actor: m[1], domain: m[2], reason: m[3] };

  m = /^(\S+) un-blacklisted '([^']+)'$/.exec(text);
  if (m) return { kind: "unblacklist", actor: m[1], domain: m[2] };

  m = /^New bot: <([^>]+)> created by <([^>]+)> from <([^>]+)>$/.exec(text);
  if (m) {
    return { kind: "newBot", target: m[1], actor: m[2], from: m[3] };
  }

  m = /^New bot: <([^>]+)> created by <([^>]+)>$/.exec(text);
  if (m) return { kind: "newBot", target: m[1], actor: m[2], from: null };

  m = /^User <([^>]+)> had botflag removed by <([^>]+)>$/.exec(text);
  if (m) return { kind: "botflagRemoved", target: m[1], actor: m[2] };

  m = /^Reload initiated by <([^>]+)>$/.exec(text);
  if (m) return { kind: "reload", actor: m[1] };

  m = /^Cleanup initiated by <([^>]+)>$/.exec(text);
  if (m) return { kind: "cleanup", actor: m[1] };

  return { kind: "unparsed", text };
}
