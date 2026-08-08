import type { DemoInfo } from "./bindings";

/**
 * What to call a side, from its ally-team index: "Team 1" for ally team 0.
 *
 * One-based because that's how a match is talked about. `[allyteam0]` is an
 * index in a file, not something anybody says out loud, matching the naming
 * `sideLabel` in `matchStats.ts` already uses for the match chart (#1138).
 *
 * Duplicated here rather than imported from there because `matchStats.ts` is
 * owned by the lane building the chart's value table (#1140) and off limits
 * for the length of that work (#1209). Every other surface on replay detail
 * that names a side, the roster, the minimap start boxes, the result line,
 * reads through this instead of inventing its own numbering, so the page
 * can't drift back out of step with the chart the way the roster did.
 */
export function teamLabel(ally: number): string {
  return `Team ${ally + 1}`;
}

/**
 * Human-readable result line from the winning ally teams, in {@link teamLabel}
 * numbering. Mirrors `resultLabel` in `matchStats.ts`, which still uses the
 * zero-based `Ally N` form. See the note on {@link teamLabel} for why this
 * isn't reading that one instead.
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
