import { occupancy } from "../battles/battleFilters";
import type { Battle } from "../bindings";

/** Why a follow ended without the player ending it. */
export type FollowStop = "disconnected" | "unfriended" | "leftByHand";

/** Why the friend's battle cannot be entered. */
export type FollowBlock = "locked" | "full" | "passworded";

/** What following a friend calls for next. */
export type FollowAction =
  | { kind: "none" }
  | { kind: "join"; id: number }
  | { kind: "leave" }
  | { kind: "blocked"; id: number; reason: FollowBlock }
  | { kind: "stop"; reason: FollowStop };

/** What the last step saw and did, so the next one can tell a change from a
 * repeat. */
export interface FollowMemo {
  /** The battle the friend was in. */
  target: number | null;
  /** The battle the player was in, on the friend's server. */
  mine: number | null;
  /** The join or refusal last acted on, so it is acted on once. */
  attempt: string | null;
  /** The battle a leave has been sent for and has not landed yet. */
  leaving: number | null;
}

/** The memo for a follow that has just started. */
export const FRESH_FOLLOW: FollowMemo = {
  target: null,
  mine: null,
  attempt: null,
  leaving: null,
};

export interface FollowNow {
  /** The friend's server is connected. */
  connected: boolean;
  /** Its state is loaded, so its friend list and battles can be trusted. */
  ready: boolean;
  /** The person is still a friend there. */
  friend: boolean;
  /** The player is in a running game, and must not be moved. */
  playing: boolean;
  /** Another lobby action is under way. */
  busy: boolean;
  target: number | null;
  mine: number | null;
  /** The friend's battle, when the server has told us about it. */
  battle: Pick<
    Battle,
    "passworded" | "locked" | "host" | "members" | "playerCount" | "maxPlayers"
  > | null;
  /** That battle has started, so joining it is spectating. */
  running: boolean;
}

/** Why the battle cannot be walked into, or null when it can. A running battle
 * is never full, as in the battle list: a late joiner spectates. */
function blockOf(
  battle: NonNullable<FollowNow["battle"]>,
  running: boolean,
): FollowBlock | null {
  if (battle.locked) return "locked";
  if (!running && occupancy(battle) >= battle.maxPlayers) return "full";
  return battle.passworded ? "passworded" : null;
}

/**
 * One step of following a friend (issue #3696): given what was seen last time
 * and what is true now, what to do, and the memo for next time.
 *
 * The player goes where the friend goes. They join the friend's battle, leave
 * it when the friend does, and leave a battle of their own to join the friend.
 * A battle of their own is left alone while the friend is in none, or in one
 * that cannot be entered.
 */
export function followStep(
  memo: FollowMemo,
  now: FollowNow,
): { memo: FollowMemo; action: FollowAction } {
  const { target, mine } = now;
  const seen: FollowMemo = {
    target,
    mine,
    // A join is tried again once the friend has moved on or we are with them.
    attempt: target == null || mine === target ? null : memo.attempt,
    leaving: mine == null ? null : memo.leaving,
  };
  const act = (action: FollowAction, over: Partial<FollowMemo> = {}) => ({
    memo: { ...seen, ...over },
    action,
  });
  const once = (action: FollowAction & { id: number }, key: string) =>
    seen.attempt === key
      ? act({ kind: "none" })
      : act(action, { attempt: key });

  if (!now.connected) return act({ kind: "stop", reason: "disconnected" });
  // Nothing is known yet, so nothing is remembered either.
  if (!now.ready) return { memo, action: { kind: "none" } };
  if (!now.friend) return act({ kind: "stop", reason: "unfriended" });

  // We were in the friend's battle, they are still in it and we are not. The
  // player left, and following would put them straight back.
  if (
    memo.mine != null &&
    memo.mine === memo.target &&
    target === memo.target &&
    mine == null
  ) {
    return act({ kind: "stop", reason: "leftByHand" });
  }

  if (now.playing || mine === target) return act({ kind: "none" });

  // The friend left the battle we were in with them, wherever they went next.
  if (mine != null && mine === memo.target) {
    if (seen.leaving === mine) return act({ kind: "none" });
    return act({ kind: "leave" }, { leaving: mine });
  }
  // With the friend in no battle, a battle of the player's own is their business.
  if (target == null) return act({ kind: "none" });

  // Tachyon lists a lobby before it says anything about it.
  if (!now.battle) return act({ kind: "none" });
  const reason = blockOf(now.battle, now.running);
  if (reason) {
    return once(
      { kind: "blocked", id: target, reason },
      `blocked:${target}:${reason}`,
    );
  }
  if (now.busy) return act({ kind: "none" });
  if (mine != null) {
    if (seen.leaving === mine) return act({ kind: "none" });
    return act({ kind: "leave" }, { leaving: mine });
  }
  return once({ kind: "join", id: target }, `join:${target}`);
}
