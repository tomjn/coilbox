import { occupancy } from "../battles/battleFilters";
import type { Battle } from "../bindings";
import type { FriendStatus } from "../friendsAcrossServers";

/** What a friend's row offers for the battle they are in. */
export interface FriendBattleAction {
  /** Join an open battle, or watch one that is running. */
  kind: "join" | "watch";
  label: string;
  disabled: boolean;
  /** Why the button is disabled, or null when it is not. */
  reason: string | null;
  /** True when the battle has a password, so pressing the button asks for it. */
  asksPassword: boolean;
}

/**
 * The button a friend's row shows for the battle they are in, or null for none.
 *
 * Mirrors what the battle list offers (`battleRowAction` and `BattleRow`): an
 * open battle is joined, a running one is walked into (and watched from the
 * room, since joining starts no engine) and is never refused for a full roster,
 * and a passworded one asks for its password. The battle list lets a locked
 * battle be tried and shows the server's refusal. A friend's row says Locked up
 * front instead, because the player did not choose this battle from a list.
 *
 * `running` is whether the battle has started, which `isBattleRunning` works
 * out. `session` is the state of the friend's own connection.
 */
export function friendBattleAction(input: {
  status: FriendStatus;
  battle: Pick<
    Battle,
    | "id"
    | "passworded"
    | "locked"
    | "host"
    | "members"
    | "playerCount"
    | "maxPlayers"
  > | null;
  running: boolean;
  session: { ready: boolean; busy: boolean; joinedId: number | null };
}): FriendBattleAction | null {
  const { status, battle, running, session } = input;
  if (status === "unknown" || status === "offline" || !battle) return null;
  // Nothing to do about a friend in the battle you are already in.
  if (session.joinedId === battle.id) return null;

  const kind = running ? "watch" : "join";
  const verb = running ? "Watch" : "Join";
  const asksPassword = battle.passworded;
  const refuse = (label: string, reason: string): FriendBattleAction => ({
    kind,
    label,
    disabled: true,
    reason,
    asksPassword,
  });

  if (battle.locked) return refuse("Locked", "This battle is locked");
  if (!running && occupancy(battle) >= battle.maxPlayers) {
    return refuse("Full", "This battle is full");
  }
  if (!session.ready) return refuse(verb, "Not connected yet");
  if (session.busy) return refuse(verb, "Another action is in progress");
  if (session.joinedId != null) {
    return refuse(verb, "Leave your current battle first");
  }
  return { kind, label: verb, disabled: false, reason: null, asksPassword };
}
