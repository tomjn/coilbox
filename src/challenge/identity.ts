import {
  type ConquestChallengeSettings,
  challengeSettingsFromGalaxy,
} from "../conquest/challenge";
import type { GalaxyDoc } from "../conquest/model";
import { readThreatLevel } from "../conquest/threat";
import type { RogueliteRun, RunSettings } from "../runlite/model";

/**
 * What makes two challenges the same challenge, as one string.
 *
 * Built from the generation settings in a fixed order, never from the encoded
 * code, because one challenge encodes to different bytes each time its names or
 * title change. Left out on purpose:
 *
 * - titles, system names, faction names and colours, which are labels
 * - `nodeMaps`, which depend on what the player has installed. A system that
 *   stood in for a missing map is handled by the caller, which does not count
 *   the run
 * - the game's pinned archive name, which is a version override. The game is
 *   its shortname
 *
 * The mode is the first element, so a conquest and a warpath never collide.
 */

/** The identity of a conquest challenge's settings. */
export function conquestIdentity(s: ConquestChallengeSettings): string {
  return JSON.stringify([
    "conquest",
    s.game.shortname,
    s.seed,
    s.nodeCount,
    s.factionCount,
    s.layout,
    s.radiusLy ?? null,
    s.skin,
    s.startingSystems ?? null,
    s.fogOfWar === true,
    // Only above 0, so every identity from before levels existed is unchanged
    // and a record keeps its challenge.
    ...(readThreatLevel(s.threatLevel) > 0
      ? [readThreatLevel(s.threatLevel)]
      : []),
    // Only when set, after the level, which is a number where this is a string,
    // so the two cannot be read as one another.
    ...(s.startPosition === "centre" ? ["centre"] : []),
  ]);
}

/**
 * The identity of a conquest galaxy, or null when it has no generation knobs
 * (an authored or bundled galaxy, which no code can be made from).
 */
export function galaxyIdentity(galaxy: GalaxyDoc): string | null {
  const settings = challengeSettingsFromGalaxy(galaxy);
  return settings ? conquestIdentity(settings) : null;
}

/** The identity of a warpath challenge's settings. */
export function warpathIdentity(s: RunSettings): string {
  return JSON.stringify([
    "warpath",
    s.game.shortname,
    s.seed,
    s.length,
    s.difficulty,
    s.ascension,
    s.factionId,
    s.side ?? null,
    s.skin,
    // Only a run across a land map adds to the list, so the identity of every
    // other run is what it was before maps existed.
    ...(s.map
      ? [
          s.map.source === "generated"
            ? [
                "generated",
                s.map.style,
                s.map.seed,
                s.map.nodeCount,
                s.map.layout ?? null,
              ]
            : ["handmade", s.map.id],
        ]
      : []),
  ]);
}

/** The identity of a warpath run. A run keeps its settings, so this is its code's. */
export function runIdentity(run: RogueliteRun): string {
  return warpathIdentity(run.settings);
}
