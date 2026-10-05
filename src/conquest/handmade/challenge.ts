import {
  decodeChallenge,
  encodeChallenge,
  encodeChallengeFile,
} from "../../challenge/code";
import {
  type ChallengeMapCheck,
  challengeMapListFailure,
  checkChallengeMap,
} from "../../challenge/mapCheck";
import {
  type HandmadeMapRef,
  handmadeMapRefFor,
  parseHandmadeMapRef,
} from "../../challenge/mapRef";
import { type NodeMaps, parseNodeMaps } from "../../challenge/nodeMaps";
import {
  type ConquestChallengeSettings,
  parseConquestChallengeSettings,
} from "../challenge";
import type { GalaxyDoc, GameRef } from "../model";
import { readThreatLevel } from "../threat";
import { loadHandmadeMap } from "./library";

/**
 * A challenge for a conquest on a hand-made map (issue #3512). It names the
 * map where a generated challenge carries generator settings, and adds the
 * choices a hand-made map still leaves.
 *
 * It rides in the same `challenge` payload with `mode: "conquest"`. It leaves
 * out `seed`, `nodeCount` and `factionCount` on purpose: a coilbox from before
 * this refuses a conquest code without them, where it would otherwise build a
 * generated map and call it this challenge.
 */
export interface HandmadeConquestChallengeSettings {
  game: GameRef;
  /** The map's title, for anything that lists the challenge. */
  title: string;
  /** The map, and which version of it. */
  map: HandmadeMapRef;
  fogOfWar?: boolean;
  /** Threat level 1..3 (see `../threat`). Absent reads as 0. */
  threatLevel?: number;
  /**
   * The battle map of each location the author left for coilbox to pick, by
   * location id. The map does not settle these, so they are part of the
   * challenge.
   */
  nodeMaps?: NodeMaps;
}

/** What a pasted conquest code can decode to. */
export type ConquestImportSettings =
  | ConquestChallengeSettings
  | HandmadeConquestChallengeSettings;

/** True for a challenge on a hand-made map. */
export function isHandmadeChallenge(
  settings: ConquestImportSettings,
): settings is HandmadeConquestChallengeSettings {
  return "map" in settings;
}

/**
 * The challenge a conquest on a hand-made map is, from the document it is
 * played on (see `handmadeConquestDoc`). Null for any other document.
 *
 * A location standing in for a battle map this install lacks publishes the
 * map the challenge named, as `nodeMapsFrom` does for a generated map.
 */
export function handmadeChallengeSettings(
  galaxy: GalaxyDoc,
): HandmadeConquestChallengeSettings | null {
  const h = galaxy.handmade;
  if (!h?.fingerprint) return null;
  const nodeMaps: NodeMaps = {};
  for (const node of galaxy.nodes) {
    if (!h.battles?.[node.id]) continue;
    nodeMaps[node.id] = node.battle.mapSubstitutedFrom ?? h.battles[node.id];
  }
  const threatLevel = readThreatLevel(h.threatLevel);
  return {
    game: galaxy.game,
    title: galaxy.title,
    map: handmadeMapRefFor(galaxy),
    fogOfWar: galaxy.rules?.fogOfWar ? true : undefined,
    threatLevel: threatLevel > 0 ? threatLevel : undefined,
    nodeMaps: Object.keys(nodeMaps).length > 0 ? nodeMaps : undefined,
  };
}

/** Validate a challenge payload's `settings` as a hand-made map challenge. */
export function parseHandmadeChallengeSettings(
  value: unknown,
): HandmadeConquestChallengeSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const map = parseHandmadeMapRef(v.map);
  const game = v.game as Record<string, unknown> | null | undefined;
  if (
    !map ||
    typeof game !== "object" ||
    game === null ||
    typeof game.shortname !== "string" ||
    game.shortname === ""
  ) {
    return null;
  }
  const threatLevel = readThreatLevel(v.threatLevel);
  return {
    game: {
      shortname: game.shortname,
      pinnedName:
        typeof game.pinnedName === "string" && game.pinnedName !== ""
          ? game.pinnedName
          : undefined,
    },
    title:
      typeof v.title === "string" && v.title !== ""
        ? v.title
        : (map.title ?? map.id),
    map,
    fogOfWar: v.fogOfWar === true ? true : undefined,
    threatLevel: threatLevel > 0 ? threatLevel : undefined,
    nodeMaps: parseNodeMaps(v.nodeMaps),
  };
}

/** Encode a conquest on a hand-made map as a pasteable code, or null when the
 * document is not one. */
export function encodeHandmadeChallenge(galaxy: GalaxyDoc): string | null {
  const settings = handmadeChallengeSettings(galaxy);
  return settings ? encodeChallenge("conquest", settings) : null;
}

/** The same as a challenge file's JSON text. */
export function encodeHandmadeChallengeFile(galaxy: GalaxyDoc): string | null {
  const settings = handmadeChallengeSettings(galaxy);
  return settings ? encodeChallengeFile("conquest", settings) : null;
}

/**
 * Decode a pasted conquest code of either sort. A payload that names a
 * hand-made map is read as one whatever else it holds, so it can never be
 * built as a generated map.
 */
export function decodeConquestImport(code: string) {
  return decodeChallenge(
    code,
    "conquest",
    (value): ConquestImportSettings | null =>
      parseHandmadeChallengeSettings(value) ??
      parseConquestChallengeSettings(value),
  );
}

/**
 * Read the installed map a challenge names and check it is the version the
 * challenge was made on. `gameName` is the challenge's game as the player
 * knows it. Never throws: every failure is a sentence for the player.
 */
export async function loadChallengeMap(
  ref: HandmadeMapRef,
  gameName: string,
): Promise<ChallengeMapCheck> {
  try {
    return checkChallengeMap(ref, gameName, await loadHandmadeMap(ref.id));
  } catch (e) {
    return { ok: false, message: challengeMapListFailure(ref, e) };
  }
}
