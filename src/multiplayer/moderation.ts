import type { ChannelState } from "./bindings";

/**
 * ChanServ channel-op and server-moderator commands, built as raw wire lines to
 * send via `mpSend`. `mpSend` (unlike `mpSayPrivate`) records nothing locally, so
 * our commands don't pollute the ChanServ DM — only ChanServ's replies show, as
 * feedback. Channel names are the bare form (no `#`); ChanServ's PM interface
 * rejects a leading `#`.
 *
 * ChanServ command reference (uberserver `ChanServ.py`): commands are colon-
 * prefixed and, via private message, take the channel as the first argument —
 * `SAYPRIVATE ChanServ :op <chan> <nick>`. Moderator verbs (`KICK`, `BAN`,
 * `GETIP`, …) are first-class protocol commands gated by the server on the
 * client's access level.
 */

const CHANSERV = "SAYPRIVATE ChanServ";

/** Query a channel's founder/operators; the reply is parsed in the protocol crate. */
export function chanServInfo(channel: string): string {
  return `${CHANSERV} :info ${channel}`;
}

/** Grant (`op`) or revoke (`deop`) channel-operator status. */
export function chanServSetOp(
  channel: string,
  nick: string,
  grant: boolean,
): string {
  return `${CHANSERV} :${grant ? "op" : "deop"} ${channel} ${nick}`;
}

/** Kick a user from the channel (no duration). */
export function chanServKick(channel: string, nick: string): string {
  return `${CHANSERV} :kick ${channel} ${nick}`;
}

/** Timed channel mute. `duration` is a ChanServ span like `10m`, `2h`, `3d`. */
export function chanServMute(
  channel: string,
  nick: string,
  duration: string,
  reason: string,
): string {
  return `${CHANSERV} :mute ${channel} ${nick} ${duration} ${reason}`.trimEnd();
}

export function chanServUnmute(channel: string, nick: string): string {
  return `${CHANSERV} :unmute ${channel} ${nick}`;
}

/** Timed channel ban. `duration` is a ChanServ span like `1d`, `perm`. */
export function chanServBan(
  channel: string,
  nick: string,
  duration: string,
  reason: string,
): string {
  return `${CHANSERV} :ban ${channel} ${nick} ${duration} ${reason}`.trimEnd();
}

export function chanServUnban(channel: string, nick: string): string {
  return `${CHANSERV} :unban ${channel} ${nick}`;
}

/** Set the channel topic. */
export function chanServTopic(channel: string, text: string): string {
  return `${CHANSERV} :topic ${channel} ${text}`;
}

/* -------------------------------------------------------------------------- *
 * Server-moderator verbs (require the client's access level; gate on the
 * `access` status bit). These target a user across the whole server, not a
 * single channel.
 * -------------------------------------------------------------------------- */

/** Look up a user's account id (smurf detection). */
export function modGetUserId(nick: string): string {
  return `GETUSERID ${nick}`;
}

/** Look up a user's IP. */
export function modGetIp(nick: string): string {
  return `GETIP ${nick}`;
}

/** Ring (alert) a user. */
export function modRing(nick: string): string {
  return `RING ${nick}`;
}

/** Kick a user off the server. */
export function modKick(nick: string, reason: string): string {
  return reason ? `KICK ${nick} ${reason}` : `KICK ${nick}`;
}

/** Ban a user from the server. `duration` is a server span (e.g. `7d`). */
export function modBan(nick: string, duration: string, reason: string): string {
  return `BAN ${nick} ${duration} ${reason}`.trimEnd();
}

export function modUnban(nick: string): string {
  return `UNBAN ${nick}`;
}

/**
 * Whether the current user may run channel-op actions here: a server moderator
 * (access bit) always may; otherwise only the channel's registered founder or an
 * operator (learned from ChanServ `:info`). Returns false with no channel/user,
 * so callers can render controls purely off this predicate.
 */
export function canChannelModerate(
  channel: ChannelState | undefined,
  me: string | null,
  serverMod: boolean,
): boolean {
  if (serverMod) return true;
  if (!me || !channel) return false;
  return channel.founder === me || channel.operators.includes(me);
}
