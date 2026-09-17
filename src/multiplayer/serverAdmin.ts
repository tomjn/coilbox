import type { LobbyProtocol, LobbyServer } from "../lobby-servers/config";
import type { AdminOutcome, LobbyState } from "./bindings";
import type { Connections } from "./connections";
import { protocolForKey } from "./protocol";

/** The compflag Teiserver names that uberserver never does (issue #2772). Both
 * speak `tasserver` as their `LobbyProtocol`, so this is what actually tells
 * them apart. Confirmed live on 30 August 2026: Beyond All Reason's
 * Teiserver sent `sp teiserver matchmaking token-auth`, and three uberservers
 * sent `u sp b`, one adding `jsonchat`. */
const TEISERVER_COMPAT_FLAG = "teiserver";

/**
 * Whether a connection speaks to uberserver rather than Teiserver or Zero-K.
 * Pure. The one place this is decided, so a later Teiserver or Zero-K admin
 * page has one place to change. A TASServer connection whose compflags have
 * not arrived yet reads as uberserver: nothing has proven it Teiserver, and
 * `serverAdminKeys` also requires the access bit, which is equally unknown
 * until the same snapshot arrives.
 */
export function isUberserver(
  protocol: LobbyProtocol,
  state: LobbyState | null,
): boolean {
  return (
    protocol === "tasserver" &&
    !(state?.compflags.includes(TEISERVER_COMPAT_FLAG) ?? false)
  );
}

/**
 * Every live lobby login (not a room) that qualifies for the Server admin
 * page: an uberserver connection whose own account has the server's
 * moderator/admin `access` status bit set. The focused connection first when
 * it is among them, the same "focused first" ordering `liveConnectionKeys`
 * uses. Pure.
 */
export function serverAdminKeys(
  connections: Connections,
  servers: LobbyServer[],
  focusKey: string | null,
): string[] {
  const keys = Object.keys(connections).filter((key) => {
    const c = connections[key];
    if (!c.live || c.direct) return false;
    const state = c.mirror.state;
    if (!isUberserver(protocolForKey(key, servers), state)) return false;
    const me = state?.myUsername;
    return !!me && (state?.users[me]?.status.access ?? false);
  });
  if (focusKey == null || !keys.includes(focusKey)) return keys;
  return [focusKey, ...keys.filter((key) => key !== focusKey)];
}

/**
 * Whether the connection `serverKey` names is an uberserver admin rather
 * than only a moderator (issue #2776). Pure. The gate later admin-only
 * sections (issues #2785-#2788) use: `null`, and a connection with no entry,
 * both read as "not an admin", the same as a moderator does.
 */
export function isServerAdmin(
  connections: Connections,
  serverKey: string | null,
): boolean {
  return serverKey != null && connections[serverKey]?.adminLevel === "admin";
}

/**
 * The level a `GETUSERINFO <own username>` answer settles
 * `ConnectionState.adminLevel` on, or `null` when the answer says nothing
 * about it: a refusal, no answer, or a reply that is not a normal account's
 * (bridged, missing, static, none of which apply to a real moderator's own
 * lookup, but are handled rather than assumed away). Pure.
 */
export function adminLevelFromOutcome(
  outcome: AdminOutcome,
): "mod" | "admin" | null {
  if (outcome.outcome !== "answered") return null;
  const { reply } = outcome;
  if (reply.shape !== "userInfo" || reply.info.kind !== "account") {
    return null;
  }
  return reply.info.access === "admin" ? "admin" : "mod";
}
