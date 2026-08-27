import {
  type LobbyProtocol,
  type LobbyServer,
  serverProtocol,
} from "../lobby-servers/config";

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
