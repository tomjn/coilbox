/**
 * Who else in the room cannot play the match the host is about to start.
 *
 * `contentBlock.ts` answers the same question about the person reading it, and
 * their own launch is refused with the reason. This is the other half: the host
 * pressing Start on somebody else's behalf. On a real server SPADS refuses that,
 * which is why it never came up before. In a room coilbox hosts itself there is
 * nothing between the button and the engine, so a joiner who is still
 * downloading is simply never in the match (issue #1605).
 *
 * The host is warned rather than blocked. A start that one person can veto by
 * lacking a map is its own trap: there is no server to kick them from, they may
 * be a spectator in all but name, and a LAN party waiting on one download is a
 * LAN party not playing. So the fact is named, and the decision stays the
 * host's.
 *
 * Pure, so the words and the rule can be tested without a room.
 */

import type { MemberRow } from "./config";

/**
 * The people in the room who say they cannot play, oldest ordering of the
 * roster preserved.
 *
 * Only sync 2 counts. Sync 0 is a client that has not said yet, and warning a
 * host off a start because somebody's scan has not finished would be the same
 * false verdict `launchBlock` refuses to give.
 *
 * Spectators are left out because their content does not gate anything, bots
 * because they run on the host's own machine, and the host themselves because
 * their own missing content already disables Start outright with a fuller
 * reason than this can give.
 */
export function unsyncedPlayers(rows: MemberRow[]): string[] {
  return rows
    .filter(
      (r) => r.kind === "human" && !r.spectator && !r.self && r.sync === 2,
    )
    .map((r) => r.name);
}

/**
 * What the host is told before they start without somebody, or null when
 * nobody is in that position.
 *
 * The sync bit is one bit: it says a player cannot play, not which of the map
 * and the game they are missing. So the sentence says both rather than guessing
 * at one, and says what starting now does, because that is the decision being
 * asked for.
 */
export function startAnywayWarning(names: string[]): string | null {
  if (names.length === 0) return null;
  const who = nameList(names);
  const have = names.length === 1 ? "does not have" : "do not have";
  return `${who} ${have} this battle's map or game. Start now and the match runs without them.`;
}

/** "Bob", "Bob and Carol", "Bob, Carol and Dave". */
function nameList(names: string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
