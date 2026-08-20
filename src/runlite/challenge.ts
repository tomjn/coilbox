import {
  decodeChallenge,
  encodeChallenge,
  encodeChallengeFile,
} from "../challenge/code";
import {
  type NodeMaps,
  nodeMapsFrom,
  parseNodeMaps,
} from "../challenge/nodeMaps";
import type { GenBuildGraph, GenerateRunOpts, GenRunMap } from "./generate";
import { applyChallengeMaps, generateRun } from "./generate";
import type { RogueliteRun, RunSettings } from "./model";
import { parseRunSettings } from "./model";

/**
 * Shareable challenge settings for a warpath run: {@link RunSettings}, the same
 * shape already stored on every `RogueliteRun`, plus the map each encounter
 * uses. Everything else {@link generateRun} needs (maps, the build graph, the
 * default enemy AI) comes from the recipient's own installed content, same as
 * conquest's challenge.
 */
export interface WarpathChallengeSettings extends RunSettings {
  /**
   * The map each encounter uses, by node id (issue #1393). Not stored on the
   * run's settings, because the run already holds it on each node. Derived when
   * a challenge is written, so a recipient fights the same battles rather than
   * the ones their own map collection happens to produce.
   */
  nodeMaps?: NodeMaps;
}

/** The settings to publish for a run: its knobs, plus the maps its encounters
 * resolved to. */
function challengeSettingsFromRun(run: RogueliteRun): WarpathChallengeSettings {
  const nodeMaps = nodeMapsFrom(run.nodes);
  return nodeMaps ? { ...run.settings, nodeMaps } : run.settings;
}

/** Encode a run's settings as a pasteable challenge code. */
export function encodeWarpathChallenge(run: RogueliteRun): string {
  return encodeChallenge("warpath", challengeSettingsFromRun(run));
}

/** Encode a run's settings as a challenge file's JSON text (issue #476). */
export function encodeWarpathChallengeFile(run: RogueliteRun): string {
  return encodeChallengeFile("warpath", challengeSettingsFromRun(run));
}

/** Validate a challenge payload's `settings`: the run's own knobs, plus the
 * named maps a run never stores in its settings. */
export function parseWarpathChallengeSettings(
  value: unknown,
): WarpathChallengeSettings | null {
  const settings = parseRunSettings(value);
  if (!settings) return null;
  const nodeMaps = parseNodeMaps(
    (value as Record<string, unknown> | null)?.nodeMaps,
  );
  return nodeMaps ? { ...settings, nodeMaps } : settings;
}

/** Decode a pasted challenge code into settings, or a typed error. */
export function decodeWarpathChallenge(code: string) {
  return decodeChallenge(code, "warpath", parseWarpathChallengeSettings);
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

/**
 * Build the run a challenge describes: generate from the seed, then put each
 * encounter on the map the challenge names (issue #1393). Conquest's
 * `galaxyFromChallenge` is the same pairing for the same reason, and the two
 * steps belong together for the same reason too.
 */
export function runFromChallenge(
  settings: WarpathChallengeSettings,
  env: {
    maps: GenRunMap[];
    build?: GenBuildGraph;
    enemyAiKey?: string;
    loadoutBranch?: number;
  },
): RogueliteRun {
  const run = generateRun(optionsFromChallenge(settings, env));
  return applyChallengeMaps(run, settings.nodeMaps, env.maps);
}

/** How many of a run's encounters stand in for a map this install cannot offer.
 * The count worth telling somebody about after an import. */
export function substitutedMapCount(run: RogueliteRun): number {
  return run.nodes.filter((n) => n.battle?.mapSubstitutedFrom).length;
}
