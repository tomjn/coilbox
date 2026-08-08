import type { DemoInfo } from "./bindings";

/**
 * What to call a side, from its ally-team index: "Team 1" for ally team 0.
 *
 * One-based because that's how a match is talked about. `[allyteam0]` is an
 * index in a file, not something anybody says out loud.
 *
 * The only definition of that rule. Every surface on replay detail that names a
 * side reads through here: the roster, the minimap start boxes, the two result
 * lines, and the match chart's own side lines, which call it through
 * `sideLabel` in `matchStats.ts`. #1209 was two surfaces numbering the same side
 * two different ways, and two copies of the numbering is the shape that lets
 * that back in with tests passing on each side (#1211), so
 * `replaySideLabel.test.ts` fails if a second one appears anywhere in `src`.
 */
export function teamLabel(ally: number): string {
  return `Team ${ally + 1}`;
}

/**
 * Human-readable result line from the winning ally teams, in {@link teamLabel}
 * numbering.
 */
export function teamResultLabel(info: DemoInfo): string {
  // False either because the recording never reached a game over, or because
  // its trailer is in a format coilbox doesn't read and there was no demotool
  // fallback to ask, so this doesn't name a specific reason.
  if (!info.winnersKnown) return "Unknown";
  if (info.winningAllyTeams.length === 0) return "Nobody won";
  const ids = info.winningAllyTeams.map((a) => teamLabel(a)).join(", ");
  return `${ids} won`;
}
