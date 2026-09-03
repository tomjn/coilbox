import type { Debriefing, DebriefingPlayer } from "./bindings";

/**
 * Reading a Zero-K debriefing out in words (issue #2003).
 *
 * Pure, so the wording can be tested without rendering anything. The drawer that
 * uses it is `DebriefingDrawer`.
 *
 * The one thing worth knowing before reading any of this: a game that counted
 * toward no rating still sends a debriefing, and Rust has already turned the
 * server's placeholders into nulls. So a null rating change means the game was
 * not rated, never that it was rated and moved nothing.
 */

/**
 * Zero-K's names for its eight ranks, in order, from `ZkData/Ef/WHR/Ranks.cs`.
 *
 * These are the game's own words and are not translated or invented. Rank 0 has
 * a name like the rest of them, which is why this reads out for every rank
 * rather than hiding the bottom one the way the chevron insignia does.
 */
export const RANK_NAMES = [
  "Nebulous",
  "Brown Dwarf",
  "Red Dwarf",
  "Subgiant",
  "Giant",
  "Supergiant",
  "Neutron Star",
  "Singularity",
] as const;

/** What Zero-K calls a rank, or null for a number it has no rank for. */
export function rankName(rank: number): string | null {
  return RANK_NAMES[rank] ?? null;
}

/**
 * What to call the rating a game counted toward.
 *
 * The server sends its own enum member name, so `MatchMaking` arrives with a
 * capital M in the middle. Only the two spellings coilbox would otherwise show
 * oddly are corrected. Anything else is passed through, because a category added
 * upstream is better shown in the server's words than dropped.
 */
export function categoryLabel(category: string | null): string {
  if (!category) return "Unrated";
  if (category.toLowerCase() === "matchmaking") return "Matchmaking";
  if (category.toLowerCase() === "planetwars") return "Planet Wars";
  return category;
}

/**
 * A rating change with its sign on the front, or null where the game counted
 * toward no rating.
 *
 * A rated game that moved somebody by nothing reads as "0", which is true and is
 * a different statement from showing nothing at all.
 */
export function formatRatingChange(change: number | null): string | null {
  if (change == null) return null;
  return change > 0 ? `+${change}` : `${change}`;
}

/**
 * The headline for whoever is reading: what the game did to their rating, or
 * why it did nothing.
 *
 * Their rating change leads, because that is the thing the server sends that
 * they cannot work out for themselves. Winning they already know.
 */
export function headline(
  report: Debriefing,
  me: DebriefingPlayer | undefined,
): string {
  if (!me) return report.message ?? "The game has finished";
  const change = formatRatingChange(me.ratingChange);
  const result = me.won ? "Won" : "Lost";
  if (change == null) {
    return `${result}, and it counted toward no rating`;
  }
  return `${result}, ${change} ${categoryLabel(report.ratingCategory).toLowerCase()}`;
}

/**
 * Whether this game moved somebody between ranks, in words, or null when it did
 * not.
 *
 * The rank they are at now is what the server sends, so a promotion names where
 * they arrived and a demotion names where they landed.
 */
export function rankMove(player: DebriefingPlayer): string | null {
  const name = rankName(player.rank);
  if (player.rankedUp) return name ? `Promoted to ${name}` : "Promoted";
  if (player.rankedDown) return name ? `Dropped to ${name}` : "Dropped a rank";
  return null;
}

/** One side of the game, with the players on it. */
export interface DebriefingTeam {
  ally: number;
  won: boolean;
  players: DebriefingPlayer[];
}

/**
 * The players grouped by the side they were on, in the order Rust sorted them.
 *
 * A side counts as having won when anybody on it did. The server marks every
 * member of the winning team, so a mixed side would be a server that disagrees
 * with itself rather than something worth rendering two ways.
 */
export function teams(players: DebriefingPlayer[]): DebriefingTeam[] {
  const byAlly = new Map<number, DebriefingTeam>();
  for (const player of players) {
    const team = byAlly.get(player.ally);
    if (team) {
      team.players.push(player);
      team.won = team.won || player.won;
    } else {
      byAlly.set(player.ally, {
        ally: player.ally,
        won: player.won,
        players: [player],
      });
    }
  }
  return [...byAlly.values()];
}
