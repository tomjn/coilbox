import type { Battle } from "../bindings";
import { isBattleRunning } from "./battleFilters";
import { friendsInBattles } from "./friendsInBattles";

/** One connection's battles and the friends to look for in them. */
export interface FriendBattleSource {
  serverKey: string;
  battles: Battle[];
  users: Record<string, { status: { ingame: boolean } }> | undefined;
  /** This connection's friends. Friends are per server, so the same name on
   * another connection is somebody else. */
  friends: ReadonlySet<string>;
}

/** What a player can do with a battle, in the order the list shows them. */
export type FriendBattleGroup = "open" | "passworded" | "locked" | "running";

export interface FriendBattle {
  serverKey: string;
  battle: Battle;
  /** The friends in it, as `friendsInBattles` names them. */
  names: string;
  group: FriendBattleGroup;
}

const ORDER: FriendBattleGroup[] = ["open", "passworded", "locked", "running"];

/** Running wins, as it does in the per-connection list. A locked battle lets
 * nobody in whatever its password, so locked wins over passworded. */
function groupOf(
  battle: Battle,
  users: FriendBattleSource["users"],
): FriendBattleGroup {
  if (isBattleRunning(battle, users)) return "running";
  if (battle.locked) return "locked";
  return battle.passworded ? "passworded" : "open";
}

/**
 * Every battle with a friend in it, across connections. Open first, then
 * passworded, locked and running. Inside a group the battle with the most
 * friends comes first, then by title.
 */
export function friendBattles(sources: FriendBattleSource[]): FriendBattle[] {
  const found: (FriendBattle & { count: number })[] = [];
  for (const { serverKey, battles, users, friends } of sources) {
    const here = friendsInBattles(battles, friends);
    for (const battle of battles) {
      const names = here.get(battle.id);
      if (!names) continue;
      found.push({
        serverKey,
        battle,
        names,
        group: groupOf(battle, users),
        count: names.split(", ").length,
      });
    }
  }
  return found
    .sort(
      (a, b) =>
        ORDER.indexOf(a.group) - ORDER.indexOf(b.group) ||
        b.count - a.count ||
        a.battle.title.localeCompare(b.battle.title) ||
        a.serverKey.localeCompare(b.serverKey),
    )
    .map(({ count: _count, ...entry }) => entry);
}
