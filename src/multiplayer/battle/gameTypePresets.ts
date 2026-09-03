/**
 * Pure layout logic for the battle room's game-type presets and one-click
 * Balance action (issue #344). Both compute an ally + numeric teamId for a
 * subset of the roster. The caller applies each entry over the wire
 * (founder-direct) or as one SPADS manual-balance command (autohost host):
 * `!force * (player1,player2)(player3,player4)` sets every named player's id
 * (numeric team) and team (ally) in a single message
 * (~/dev/SPADS/var/help.dat, [force] section). SPADS assigns id sequentially
 * across the whole roster and ally as the paren group index (spads.pl
 * `hForce`), which `layoutFromGroups` mirrors so the founder-direct and
 * autohost paths produce the same seating.
 */

export type GameTypePreset = "team" | "ffa" | "coop" | "duel" | "tourney";

export interface LayoutEntry {
  name: string;
  ally: number;
  teamId: number;
}

/**
 * Group ordered player names into ally teams for one preset. Duel and Tourney
 * only seat the first two names (1v1, coilbox has no bracket/tournament
 * model, so Tourney reuses Duel's layout). Anyone beyond that, like anyone
 * this preset's groups omit entirely, is left untouched by the caller.
 */
function presetGroups(preset: GameTypePreset, names: string[]): string[][] {
  switch (preset) {
    case "coop":
      return names.length > 0 ? [names] : [];
    case "ffa":
      return names.map((n) => [n]);
    case "duel":
    case "tourney":
      return names.slice(0, 2).map((n) => [n]);
    case "team": {
      const a: string[] = [];
      const b: string[] = [];
      names.forEach((n, i) => {
        (i % 2 === 0 ? a : b).push(n);
      });
      return [a, b].filter((g) => g.length > 0);
    }
  }
}

/**
 * Flatten ally groups into layout entries: ally is the group's index, teamId
 * is sequential across every group in order.
 */
function layoutFromGroups(groups: string[][]): LayoutEntry[] {
  const entries: LayoutEntry[] = [];
  let teamId = 0;
  groups.forEach((group, ally) => {
    for (const name of group) {
      entries.push({ name, ally, teamId });
      teamId++;
    }
  });
  return entries;
}

/**
 * Layout for a game-type preset, applied to the given ordered, active
 * (non-spectator human) player names.
 */
export function gameTypeLayout(
  preset: GameTypePreset,
  names: string[],
): LayoutEntry[] {
  return layoutFromGroups(presetGroups(preset, names));
}

/**
 * Layout for the self-hosted Balance action: round-robin the given names
 * across `allyCount` ally teams (at least 2, never more than the player
 * count) and fix every teamId sequentially. Not skill-weighted. SPADS's own
 * `!balance` runs the host's configured balanceMode, and coilbox has neither
 * that algorithm nor reliable skill data to match it for a founder-direct
 * room, so this only evens out the seating and fixes ids.
 */
export function balanceLayout(
  names: string[],
  allyCount: number,
): LayoutEntry[] {
  if (names.length === 0) return [];
  const count = Math.min(Math.max(2, allyCount), names.length);
  const groups: string[][] = Array.from({ length: count }, () => []);
  names.forEach((n, i) => {
    groups[i % count].push(n);
  });
  return layoutFromGroups(groups.filter((g) => g.length > 0));
}

/** How many distinct ally teams the given ally numbers currently use. */
export function currentAllyCount(allies: number[]): number {
  return new Set(allies).size;
}

/**
 * The SPADS `!force * (...)` manual-balance command for a layout: one paren
 * group per ally in ascending ally order, players comma-separated within it.
 * Null for an empty layout (nothing to send).
 */
export function layoutToForceCommand(layout: LayoutEntry[]): string | null {
  if (layout.length === 0) return null;
  const byAlly = new Map<number, string[]>();
  for (const entry of layout) {
    const group = byAlly.get(entry.ally) ?? [];
    group.push(entry.name);
    byAlly.set(entry.ally, group);
  }
  const allies = [...byAlly.keys()].sort((a, b) => a - b);
  const groups = allies
    .map((a) => `(${(byAlly.get(a) ?? []).join(",")})`)
    .join("");
  return `!force * ${groups}`;
}
