import {
  type LobbyProtocol,
  type LobbyServer,
  serverProtocol,
} from "../lobby-servers/config";
import type { LobbyState } from "./bindings";

/**
 * The protocol spoken by the connection named by `serverKey`, matched on the
 * `host:port` half of the key (`username@host:port`, see `serverKeyFor`). Pure.
 *
 * The store holds the key rather than the `LobbyServer` a connect was given, and a
 * connection re-adopted after a webview reload never had one at all, so the
 * protocol is read back from the key instead of being remembered at connect time.
 * With no connection, or a key naming a server that is no longer configured, this
 * reads as `tasserver`, which is what every surface assumed before Tachyon.
 */
export function protocolForKey(
  serverKey: string | null,
  servers: LobbyServer[],
): LobbyProtocol {
  if (serverKey == null) return "tasserver";
  const server = servers.find((s) =>
    serverKey.endsWith(`@${s.host}:${s.port}`),
  );
  return server ? serverProtocol(server) : "tasserver";
}

/**
 * Whether a connection pulls the server's ignore list, friend list and pending
 * friend requests once it is ready.
 *
 * Each is a TASServer command with no Tachyon equivalent, bar the friend list:
 * Tachyon has `friend/list`, but `user/self` has already handed the friends and
 * the pending requests over by the time a connection is ready, so asking is a
 * round trip for what we hold. A Tachyon connection skips them here rather than
 * queueing them for the connection task to drop, which is what put "not sent"
 * lines in the console on every connect.
 *
 * A Zero-K connection skips them for the opposite reason: it is sent both lists
 * unasked, on connect and again after every change.
 */
export function syncsOnReady(protocol: LobbyProtocol): boolean {
  return protocol === "tasserver";
}

/**
 * Whether this connection rejoins the channels the account is configured to
 * auto-join.
 *
 * Tachyon has no named channels at all, so there is nothing to join and the
 * settings panel for it is hidden to match. Zero-K does have them: it force-joins
 * its own defaults, and anything the person added themselves is a fresh join
 * every session, so without this their channels are silent after a reconnect.
 */
export function autoJoinsChannels(protocol: LobbyProtocol): boolean {
  return protocol !== "tachyon";
}

/**
 * Whether the server decides a player's colour, faction, team number and
 * handicap rather than the client asking for them.
 *
 * True on Tachyon, which assigns colours when the match starts and picks a
 * member's team within their ally team itself. True on Zero-K for the same
 * reason: `UpdateUserBattleStatus` carries the ally team, the spectator flag and
 * the sync flag, and there is nothing on the wire for the rest.
 *
 * The ally team is the one seat field every protocol lets a player choose, so it
 * is not covered by this.
 */
export function seatIsServerAssigned(protocol: LobbyProtocol): boolean {
  return protocol !== "tasserver";
}

/**
 * Whether the message that updates a bot carries the ally team it sits on.
 *
 * False on Tachyon alone, whose bot update carries the AI, the name and the
 * bot's options and nothing about where it sits. Zero-K's `UpdateBotStatus`
 * carries `AllyNumber`, so a bot's ally is settable there even though its team
 * number is not: the protocol has no team number for anyone, player or bot.
 */
export function carriesBotAlly(protocol: LobbyProtocol): boolean {
  return protocol !== "tachyon";
}

/**
 * Whether founding a room on this connection also means running the match on
 * this machine.
 *
 * True only on TASServer, where `OPENBATTLE` advertises this machine's port and
 * the founder's client scripts the game, drives the roster and forces seats.
 * A Zero-K founder owns the room and none of the match: the server runs every
 * game itself and tells each player where to connect, so a founder there is a
 * player with the room's commands to hand, not a host.
 */
export function founderRunsTheGame(protocol: LobbyProtocol): boolean {
  return protocol === "tasserver";
}

/**
 * Whether this connection has a client-wide away/ingame status to publish.
 *
 * Separate from `syncsOnReady` because Zero-K parts company with it here: the
 * server pushes the channels and the lists, but it is still the client that says
 * whether somebody is away or in a game, as `ChangeUserStatus`. Tachyon carries
 * readiness per lobby instead and has nothing client-wide to send.
 */
export function publishesStatus(protocol: LobbyProtocol): boolean {
  return protocol !== "tachyon";
}

/**
 * Why coilbox cannot set start positions on this connection, or null where it
 * can. Pure.
 *
 * Zero-K carries battle options as `SetModOptions` and `SetMapOptions`, two
 * dictionaries with nothing in either for a start position type, and its
 * protocol has no start rectangle message at all. So the mode select wrote to
 * nothing and the box editor would have put a TASServer line on a socket that
 * does not speak one. See `mp_set_script_tags` on the Rust side, which is where
 * a tag map is split into the two commands and the rest is dropped.
 *
 * A reason rather than a flag, because hiding the control silently would leave a
 * founder looking for a setting every other lobby has (issue #1979).
 */
export function startPositionsUnavailable(
  protocol: LobbyProtocol,
): string | null {
  if (protocol !== "zerok") return null;
  return "Zero-K's lobby protocol carries no start positions, so coilbox cannot set them for this room.";
}

/**
 * Why coilbox cannot set unit restrictions on this connection, or null where it
 * can. Pure.
 *
 * The same gap as {@link startPositionsUnavailable} and for the same reason:
 * restrictions travel as `game/restrict/*` script tags, and Zero-K's two option
 * commands have nowhere to put them.
 */
export function unitRestrictionsUnavailable(
  protocol: LobbyProtocol,
): string | null {
  if (protocol !== "zerok") return null;
  return "Zero-K's lobby protocol carries no unit restrictions, so coilbox cannot set them for this room.";
}

/**
 * The compatibility flag a server names when it has a relay to host battles
 * through (ScarylePoo/uberserver#26, mirrors `command::RELAY_COMPAT_FLAG`).
 */
export const RELAY_COMPAT_FLAG = "r";

/**
 * Whether this connection's server has a relay, so hosting a battle through one
 * can be offered. Pure.
 *
 * Somebody behind a router they cannot forward a port on hosts through the
 * server's relay, and not every server has one. The server says so in its
 * compatibility flags, which it hands over before login, so this is settled by
 * the time there is a state at all.
 *
 * False on a server that has never heard of a relay, which is every server
 * today, and false on Tachyon and Zero-K, which have no compatibility flags.
 */
export function relayHostingAvailable(state: LobbyState | null): boolean {
  return state?.compflags.includes(RELAY_COMPAT_FLAG) ?? false;
}

/** How many characters one Tachyon message may carry, from the schema for
 * `messaging/send`. A longer one comes back as `message_too_long`. */
export const TACHYON_MESSAGE_LIMIT = 512;

/**
 * The longest message this connection will carry, or null where the protocol
 * sets no limit we know of. Pure.
 *
 * TASServer has no published cap, so a limit there would be one we invented.
 */
export function messageLimit(protocol: LobbyProtocol): number | null {
  return protocol === "tachyon" ? TACHYON_MESSAGE_LIMIT : null;
}
