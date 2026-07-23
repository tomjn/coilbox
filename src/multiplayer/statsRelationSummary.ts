import type { PlayerRelation } from "@/content/stats";

/**
 * A one-line summary of a relation for the multiplayer user popover (#375), or
 * null with nothing to say (no shared replays, or the relation isn't known
 * yet). Kept in its own module, separate from `statsRelation.ts`'s hook, so
 * this pure formatter is unit-testable without pulling in the content plugin's
 * React state.
 */
export function relationSummary(
  relation: PlayerRelation | null,
): string | null {
  if (!relation || relation.gamesShared === 0) return null;
  const parts: string[] = [
    `${relation.gamesShared} game${relation.gamesShared === 1 ? "" : "s"} with this player`,
  ];
  if (relation.gamesTogether > 0) {
    parts.push(
      `${relation.winsTogether}W/${relation.gamesTogether - relation.winsTogether}L as teammates`,
    );
  }
  if (relation.gamesAgainst > 0) {
    parts.push(
      `${relation.winsAgainst}W/${relation.gamesAgainst - relation.winsAgainst}L as opponents`,
    );
  }
  return parts.join(" · ");
}
