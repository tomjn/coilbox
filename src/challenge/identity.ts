import {
  type ConquestChallengeSettings,
  challengeSettingsFromGalaxy,
} from "../conquest/challenge";
import {
  type ConquestImportSettings,
  type HandmadeConquestChallengeSettings,
  handmadeChallengeSettings,
  isHandmadeChallenge,
} from "../conquest/handmade/challenge";
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
 * The identity of a conquest challenge on a hand-made map. The map's id and
 * fingerprint stand where a generated challenge has its generator settings, so
 * results on different maps, or on different versions of one map, are never
 * compared. The battle maps of the locations the author left blank follow, in
 * id order, because the map does not settle them and two conquests on other
 * battlefields are not the same challenge. The map's title is a label and is
 * left out.
 */
export function handmadeConquestIdentity(
  s: HandmadeConquestChallengeSettings,
): string {
  return JSON.stringify([
    "conquest",
    s.game.shortname,
    "handmade",
    s.map.id,
    s.map.fingerprint ?? null,
    s.fogOfWar === true,
    readThreatLevel(s.threatLevel),
    Object.entries(s.nodeMaps ?? {}).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  ]);
}

/** The identity of a decoded conquest code of either sort. */
export function conquestImportIdentity(s: ConquestImportSettings): string {
  return isHandmadeChallenge(s)
    ? handmadeConquestIdentity(s)
    : conquestIdentity(s);
}

/**
 * The identity of a conquest map, or null when no code can be made from it: an
 * authored or bundled galaxy, which has no generation knobs and is no
 * hand-made map.
 */
export function galaxyIdentity(galaxy: GalaxyDoc): string | null {
  const handmade = handmadeChallengeSettings(galaxy);
  if (handmade) return handmadeConquestIdentity(handmade);
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
                // Only when the run carries one, so a run made before planets
                // keeps the identity it had.
                ...(s.map.planet ? [s.map.planet] : []),
              ]
            : [
                "handmade",
                s.map.id,
                // Only when the run carries one, so a run made before
                // fingerprints keeps the identity it had.
                ...(s.map.fingerprint ? [s.map.fingerprint] : []),
              ],
        ]
      : []),
  ]);
}

/** The identity of a warpath run. A run keeps its settings, so this is its code's. */
export function runIdentity(run: RogueliteRun): string {
  return warpathIdentity(run.settings);
}
