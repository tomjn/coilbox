import { useCallback, useRef } from "react";
import { inBattleKey } from "../battle/battleRoomKey";
import { leaveBattle } from "../battle/leaveBattle";
import type { Connections } from "../connections";
import { serverNameFor, useMultiplayer, useProtocolServers } from "../store";

/**
 * The one-battle rule (issue #2844), kept in this file so it is easy to change.
 *
 * Only one game can run on the machine (`PlayProvider` refuses a second
 * launch), so a player is in one battle at a time across every server. Joining
 * or hosting a battle on one server while in a battle on another asks first,
 * then leaves the first battle. This is a product decision awaiting the repo
 * owner's confirmation.
 *
 * Joining another battle on the same server is not this rule's business. The
 * battle list already refuses that until the player leaves.
 */

export type BattleEntry = "join" | "host" | "create";

/**
 * The connection whose battle the player would leave by entering one on
 * `targetKey`, or null when there is none. Pure.
 */
export function otherBattleKey(
  connections: Connections,
  focusKey: string | null,
  targetKey: string | null,
): string | null {
  if (targetKey == null) return null;
  const { [targetKey]: _target, ...others } = connections;
  return inBattleKey(others, focusKey);
}

/** What the player is told before they leave a battle on `serverName`. Pure. */
export function leavesBattleNotice(
  serverName: string,
  entry: BattleEntry,
): string {
  const doing =
    entry === "join"
      ? "Joining this one"
      : entry === "host"
        ? "Hosting a battle here"
        : "Creating a lobby here";
  return `You are in a battle on ${serverName}. ${doing} leaves it.`;
}

/** The label of the button that confirms leaving. Pure. */
export function leaveAndLabel(entry: BattleEntry): string {
  return entry === "join"
    ? "Leave and join"
    : entry === "host"
      ? "Leave and host"
      : "Leave and create";
}

/**
 * The rule for entering a battle on `targetKey`: the notice to show, or null
 * when entering leaves nothing, and the step to run once the player has
 * agreed, before the join or host is sent.
 */
export function useOneBattleRule(targetKey: string | null): {
  notice: (entry: BattleEntry) => string | null;
  leaveOther: () => Promise<void>;
} {
  const { connections, activeKey } = useMultiplayer();
  const servers = useProtocolServers();
  const other = otherBattleKey(connections, activeKey, targetKey);
  const name = other ? serverNameFor(other, servers) : null;
  const notice = useCallback(
    (entry: BattleEntry) => (name ? leavesBattleNotice(name, entry) : null),
    [name],
  );
  const leaveOther = useCallback(async () => {
    if (other) await leaveBattle(other);
  }, [other]);
  return { notice, leaveOther };
}

/**
 * Whether a room form's press must be refused because the battle it would
 * leave is not the one the form named (issue #2850). Pure.
 *
 * `shown` is the battle the player was in when the form opened, and `now` the
 * one they are in at the press. A drawer keeps the notice it was opened with,
 * so a battle joined after that has not been agreed to. A battle that ended
 * meanwhile leaves nothing to leave, so that press goes ahead.
 */
export function roomLeaveIsStale(
  shown: string | null,
  now: string | null,
): boolean {
  return now != null && now !== shown;
}

/**
 * The one-battle rule for entering a room (issue #2850). A room opens beside
 * lobby logins, and its key is not known until it is dialled, so the battle to
 * leave is whichever one the player is in. A room form that is not blocked has
 * no room open behind it, so that battle is always on a lobby server.
 *
 * `leaveOther` belongs to the render the form was opened in, which is what
 * lets it tell the battle the form named from one joined since.
 */
export function useRoomBattleRule(): {
  notice: (entry: BattleEntry) => string | null;
  leaveOther: (entry: BattleEntry) => Promise<void>;
} {
  const { connections, activeKey } = useMultiplayer();
  const servers = useProtocolServers();
  const shown = inBattleKey(connections, activeKey);
  const latest = useRef(shown);
  latest.current = shown;
  const noticeFor = (key: string, entry: BattleEntry) =>
    leavesBattleNotice(serverNameFor(key, servers), entry);
  return {
    notice: (entry) => (shown ? noticeFor(shown, entry) : null),
    leaveOther: async (entry) => {
      const now = latest.current;
      if (now == null) return;
      if (roomLeaveIsStale(shown, now)) {
        throw new Error(
          `${noticeFor(now, entry)} Close this form and open it again to go ahead.`,
        );
      }
      await leaveBattle(now);
    },
  };
}
