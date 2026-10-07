import type { LobbyState } from "./bindings";
import { type Presence, userPresence } from "./chat/presence";

/**
 * A friend's presence on one server. `unknown` means the server is not
 * connected, so nothing can be said about them. It is not the same as
 * `offline`, which is a live roster that lacks them.
 */
export type FriendStatus = Presence | "unknown";

/** One friend on one server. The same name on two servers is two entries. */
export interface FriendEntry {
  serverKey: string;
  name: string;
  status: FriendStatus;
  /** The battle the friend sits in, or null. */
  battle: { id: number; title: string } | null;
  /** True when the server's own friend list has them, not only a local star. */
  serverFriend: boolean;
}

/**
 * The battle a user sits in, as host or member, or null.
 *
 * Where no battle names them, the lobby their own record points at counts. That
 * is Tachyon, whose lobby list has no member names but whose user records can
 * carry the uuid of the lobby the person is in.
 */
export function battleOf(
  state: LobbyState,
  name: string,
): { id: number; title: string } | null {
  const battles = Object.values(state.battles);
  for (const battle of battles) {
    if (battle.host === name || name in battle.members) {
      return { id: battle.id, title: battle.title };
    }
  }
  const lobby = state.users[name]?.currentLobby;
  if (!lobby) return null;
  const battle = battles.find((b) => b.tachyonId === lobby);
  return battle ? { id: battle.id, title: battle.title } : null;
}

/** Whether `name` is a friend on one server: on that server's own friend list,
 * or starred locally for it. */
export function isFriendOn(
  favourites: Record<string, string[]>,
  serverKey: string,
  state: Pick<LobbyState, "friends"> | null,
  name: string,
): boolean {
  return (
    (favourites[serverKey] ?? []).includes(name) ||
    (state?.friends ?? []).includes(name)
  );
}

/** Sort group: anyone present, then offline, then unknown. */
function rank(status: FriendStatus): number {
  if (status === "unknown") return 2;
  return status === "offline" ? 1 : 0;
}

/**
 * Merge every server's friends into one sorted list.
 *
 * `favourites` is the per-server local list (see `friends.ts`). `states` holds
 * the lobby state of each connected server, keyed the same way. A server with
 * favourites and no entry in `states` is not connected, so its friends are
 * `unknown`. Names are not shared between servers, so the same name on two
 * servers stays two entries.
 *
 * Order: present friends first, then offline, then unknown. Ties sort by name
 * without regard to case, then by server key.
 */
export function mergeFriends(
  favourites: Record<string, string[]>,
  states: Record<string, LobbyState | null>,
): FriendEntry[] {
  const keys = new Set([...Object.keys(favourites), ...Object.keys(states)]);
  const entries: FriendEntry[] = [];
  for (const serverKey of keys) {
    const state = states[serverKey] ?? null;
    const serverFriends = new Set(state?.friends ?? []);
    const names = new Set([...(favourites[serverKey] ?? []), ...serverFriends]);
    for (const name of names) {
      entries.push({
        serverKey,
        name,
        status: state ? userPresence(state, name) : "unknown",
        battle: state ? battleOf(state, name) : null,
        serverFriend: serverFriends.has(name),
      });
    }
  }
  return entries.sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
      a.serverKey.localeCompare(b.serverKey),
  );
}
