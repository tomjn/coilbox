import { useSyncExternalStore } from "react";
import type { Debriefing } from "../bindings";

/**
 * What a finished Zero-K match did to the person who played it (issue #2003).
 *
 * The server pushes `BattleDebriefing` when a match ends and coilbox dropped it.
 * It is the only post-match rating feedback any lobby protocol coilbox speaks
 * carries at all, so there is nothing here to share with the other two and
 * nothing written to be shared.
 *
 * # Held here rather than in the lobby state
 *
 * A match that has ended is news rather than a fact about the lobby. Nothing in
 * the Rust state is a finished match, a fresh snapshot has nothing to say about
 * one, and the delta carries the whole of it. So the record lives in this module
 * for as long as it is worth reading, the same way a battle that moved does in
 * `battleMoved.ts`.
 *
 * It is dropped when the reader dismisses it and when they walk into another
 * battle, because a debriefing about the last match has nothing to do with the
 * next one.
 */
let last: Debriefing | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** Hold a debriefing the server just sent. */
export function recordDebriefing(debriefing: Debriefing): void {
  last = debriefing;
  announce();
}

/** Drop the one being held, when it has been read or has stopped applying. */
export function forgetDebriefing(): void {
  if (last === null) return;
  last = null;
  announce();
}

/** The debriefing worth showing, for a component that redraws when one lands. */
export function useDebriefing(): Debriefing | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => last,
    () => last,
  );
}

/**
 * Zero-K's own names for its eight ranks, from `Ranks.RankNames` in
 * `ZkData/Ef/WHR/Ranks.cs` upstream.
 *
 * Transcribed rather than invented, because a rank is a percentile standing
 * among active players and these are the words the game, the website and the
 * server all use for the bands. Index is the rank the server sends, 0 to 7.
 */
const RANK_NAMES = [
  "Nebulous",
  "Brown Dwarf",
  "Red Dwarf",
  "Subgiant",
  "Giant",
  "Supergiant",
  "Neutron Star",
  "Singularity",
] as const;

/** A game that counted toward no rating, as the server words it. */
const UNRATED = "Unrated";

/** Whether this match moved a rating at all. */
function rated(debriefing: Debriefing): boolean {
  return debriefing.ratingCategory !== UNRATED;
}

/** Won or lost, in two words. Pure. */
export function debriefingHeadline(debriefing: Debriefing): string {
  return debriefing.won ? "You won" : "You lost";
}

/**
 * What the match did to the rating, named. Null for a game that counted toward
 * none. Pure.
 *
 * The category leads because Zero-K keeps a casual rating and a matchmaking
 * rating at once, and a number without one of those words in front of it is a
 * number the reader cannot place. Upstream's `RatingCategory` is the source of
 * the word, and one this has never heard of is passed through rather than
 * dropped: its own name beats no name.
 */
export function debriefingRating(debriefing: Debriefing): string | null {
  if (!rated(debriefing)) return null;
  const category =
    debriefing.ratingCategory === "MatchMaking"
      ? "Matchmaking"
      : debriefing.ratingCategory;
  const change = debriefing.eloChange;
  const moved =
    change > 0
      ? `up ${change}`
      : change < 0
        ? `down ${Math.abs(change)}`
        : "unchanged";
  return `${category} rating ${debriefing.newElo}, ${moved}`;
}

/**
 * The rank the match left them on, and whether it moved. Null for an unrated
 * game. Pure.
 *
 * Unrated is the case this exists to refuse. `NewRank` arrives as 0 on a game
 * that decided nothing, and 0 is Nebulous, so drawing it would tell a
 * Singularity they had fallen to the bottom.
 */
export function debriefingRank(debriefing: Debriefing): string | null {
  if (!rated(debriefing)) return null;
  const name = RANK_NAMES[debriefing.newRank];
  if (!name) return null;
  if (debriefing.rankUp) return `Promoted to ${name}`;
  if (debriefing.rankDown) return `Dropped to ${name}`;
  return name;
}

/**
 * The experience the match earned, kept apart from the rating because it is
 * time played rather than skill. Null when it earned none. Pure.
 */
export function debriefingXp(debriefing: Debriefing): string | null {
  if (debriefing.xpChange === 0) return null;
  return `${debriefing.xpChange} experience, ${debriefing.newXp} in total`;
}

/**
 * The same result in the two lines a notification has room for. Pure.
 *
 * The panel is in the battle room, which is where the server keeps a Zero-K
 * player across a match. This is for the one who is not there: a room that
 * closed at the end of the game leaves nowhere to draw the panel, and the
 * result would go unread with nothing on screen to say it had arrived.
 */
export function debriefingNotice(debriefing: Debriefing): {
  title: string;
  body: string;
} {
  return {
    title: debriefingHeadline(debriefing),
    body: debriefingRating(debriefing) ?? "This game counted toward no rating.",
  };
}
