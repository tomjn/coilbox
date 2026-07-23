import { decodeChallenge, encodeChallenge } from "../challenge/code";
import type { GenBuildGraph, GenerateRunOpts, GenRunMap } from "./generate";
import type { RogueliteRun, RunSettings } from "./model";
import { parseRunSettings } from "./model";

/**
 * Shareable challenge settings for a warpath run — exactly {@link RunSettings},
 * the same shape already stored on every `RogueliteRun`. Everything else
 * {@link generateRun} needs (maps, the build graph, the default enemy AI) comes
 * from the recipient's own installed content, same as conquest's challenge.
 */
export type WarpathChallengeSettings = RunSettings;

/** Encode a run's settings as a pasteable challenge code. */
export function encodeWarpathChallenge(run: RogueliteRun): string {
  return encodeChallenge("warpath", run.settings);
}

/** Decode a pasted challenge code into settings, or a typed error. */
export function decodeWarpathChallenge(code: string) {
  return decodeChallenge(code, "warpath", parseRunSettings);
}

/**
 * Resolve a decoded challenge's settings into full {@link GenerateRunOpts},
 * given the recipient's own installed content (maps/build graph/enemy AI — the
 * same shape `RunSetupForm` already assembles).
 *
 * SEAM FOR #387 (resolve missing content on import): as with conquest's
 * `optionsFromChallenge`, this is where a content-resolution step belongs —
 * checking `settings.game.shortname` is installed before generating. This
 * function stays a pure settings -> options mapping so that check can be
 * inserted immediately before calling it.
 */
export function optionsFromChallenge(
  settings: WarpathChallengeSettings,
  env: {
    maps: GenRunMap[];
    build?: GenBuildGraph;
    enemyAiKey?: string;
    loadoutBranch?: number;
  },
): GenerateRunOpts {
  return {
    seed: settings.seed,
    length: settings.length,
    difficulty: settings.difficulty,
    ascension: settings.ascension,
    game: settings.game,
    factionId: settings.factionId,
    side: settings.side,
    skin: settings.skin,
    maps: env.maps,
    build: env.build,
    enemyAiKey: env.enemyAiKey,
    loadoutBranch: env.loadoutBranch,
  };
}
