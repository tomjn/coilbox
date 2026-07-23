import { decodeChallenge, encodeChallenge } from "../challenge/code";
import type { GalaxyLayout, GenerateOptions } from "./generate";
import type { GalaxyDoc, GameRef } from "./model";

/**
 * Shareable challenge settings for a generated conquest galaxy — everything
 * {@link generateGalaxy} needs *other* than installed content (maps, AIs,
 * naming pools), which re-resolve from the recipient's own install. This is
 * deliberately the same knob set already persisted on `GalaxyDoc.generated`
 * (see `../conquest/model.ts`), so a challenge is exactly "the reroll knobs,
 * shared".
 */
export interface ConquestChallengeSettings {
  seed: number;
  game: GameRef;
  title: string;
  nodeCount: number;
  factionCount: number;
  layout: GalaxyLayout | "random";
  skin: "galaxy" | "theatre";
  startingSystems?: number;
  fogOfWar?: boolean;
}

const LAYOUTS: readonly (GalaxyLayout | "random")[] = [
  "scatter",
  "spiral",
  "clusters",
  "ring",
  "random",
];

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Build a challenge's settings from a saved galaxy doc. Only procedurally
 * generated galaxies are shareable this way (an authored/bundled galaxy has no
 * seed to replay) — `null` for anything else.
 */
export function challengeSettingsFromGalaxy(
  galaxy: GalaxyDoc,
): ConquestChallengeSettings | null {
  const g = galaxy.generated;
  if (!g || g.nodeCount === undefined || g.factionCount === undefined) {
    return null;
  }
  return {
    seed: g.seed,
    game: galaxy.game,
    title: galaxy.title,
    nodeCount: g.nodeCount,
    factionCount: g.factionCount,
    layout: g.layout ?? "scatter",
    skin: g.skin ?? "galaxy",
    startingSystems: g.startingSystems,
    fogOfWar: g.fogOfWar,
  };
}

function parseConquestChallengeSettings(
  value: unknown,
): ConquestChallengeSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const game = v.game as Record<string, unknown> | null | undefined;
  if (
    typeof v.seed !== "number" ||
    !Number.isFinite(v.seed) ||
    typeof v.title !== "string" ||
    v.title === "" ||
    typeof game !== "object" ||
    game === null ||
    typeof game.shortname !== "string" ||
    game.shortname === "" ||
    typeof v.nodeCount !== "number" ||
    !Number.isFinite(v.nodeCount) ||
    typeof v.factionCount !== "number" ||
    !Number.isFinite(v.factionCount)
  ) {
    return null;
  }
  return {
    seed: v.seed,
    game: {
      shortname: game.shortname,
      pinnedName:
        typeof game.pinnedName === "string" && game.pinnedName !== ""
          ? game.pinnedName
          : undefined,
    },
    title: v.title,
    nodeCount: clamp(Math.round(v.nodeCount), 8, 80),
    factionCount: clamp(Math.round(v.factionCount), 1, 3),
    layout: LAYOUTS.includes(v.layout as GalaxyLayout | "random")
      ? (v.layout as GalaxyLayout | "random")
      : "scatter",
    skin: v.skin === "theatre" ? "theatre" : "galaxy",
    startingSystems:
      typeof v.startingSystems === "number" &&
      Number.isFinite(v.startingSystems)
        ? clamp(Math.round(v.startingSystems), 1, 4)
        : undefined,
    fogOfWar: v.fogOfWar === true ? true : undefined,
  };
}

/** Encode a generated galaxy as a pasteable challenge code, or `null` if the
 * galaxy isn't procedurally generated (nothing to share a seed for). */
export function encodeConquestChallenge(galaxy: GalaxyDoc): string | null {
  const settings = challengeSettingsFromGalaxy(galaxy);
  return settings ? encodeChallenge("conquest", settings) : null;
}

/** Decode a pasted challenge code into settings, or a typed error. */
export function decodeConquestChallenge(code: string) {
  return decodeChallenge(code, "conquest", parseConquestChallengeSettings);
}

/**
 * Resolve a decoded challenge's settings into full {@link GenerateOptions},
 * given the recipient's own installed content (maps/AIs/names/aiConfig — the
 * same shape `ConquestListPage`'s generator form already assembles).
 *
 * SEAM FOR #387 (resolve missing content on import): this is where a
 * content-resolution step belongs — checking the challenge's `game.shortname`
 * is installed with maps/AIs before generating, and prompting to download
 * what's missing. Today the caller is expected to have already gated on
 * `resolveGameByShortname` finding an installed match (mirrors the "Generate a
 * galaxy" wizard's own install gate); this function itself stays a pure
 * settings -> options mapping so #387 can insert its check immediately before
 * calling it, without touching the encode/decode/validate logic above.
 */
export function optionsFromChallenge(
  settings: ConquestChallengeSettings,
  env: Pick<GenerateOptions, "maps" | "ais" | "names" | "aiConfig">,
  id: string,
): GenerateOptions {
  return {
    seed: settings.seed,
    game: settings.game,
    maps: env.maps,
    ais: env.ais,
    names: env.names,
    aiConfig: env.aiConfig,
    nodeCount: settings.nodeCount,
    factionCount: settings.factionCount,
    layout: settings.layout,
    skin: settings.skin,
    startingSystems: settings.startingSystems,
    fogOfWar: settings.fogOfWar,
    id,
    title: settings.title,
  };
}
