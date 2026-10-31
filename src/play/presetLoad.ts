import {
  type ContentRequirement,
  computeMissingRequirements,
  exactGameRequirement,
  exactMapRequirement,
  sameGameFamily,
} from "@/content/resolveContent";
import { isTweakSlotKey } from "@/workshop/deliveryRoutes";
import type { PresetPart, PresetSelection } from "./presetParts";

/**
 * What loading a saved preset needs installed, and the ways to load it when it
 * is not (issue #1302).
 *
 * Pure, so the page and its tests ask the same questions.
 */

/** The parts that only mean something under the preset's own game. */
const GAME_KEYED: readonly PresetPart[] = [
  "game",
  "modOptions",
  "tweakSlots",
  "restrictions",
];

/** The game and map the ticked parts need. A map nobody takes is not asked for,
 *  and neither is a game the setup stays on. */
export function presetLoadRequirements(
  preset: { gameName: string; mapName: string },
  selection: PresetSelection,
): ContentRequirement[] {
  const take = (part: PresetPart) => selection.parts.includes(part);
  return [
    ...(take("game") ? [exactGameRequirement(preset.gameName)] : []),
    ...(take("map") ? [exactMapRequirement(preset.mapName)] : []),
  ];
}

/** Which of those requirements the given install does not satisfy. */
export function missingForLoad(
  preset: { gameName: string; mapName: string },
  selection: PresetSelection,
  installed: { games: readonly string[]; maps: readonly string[] },
): ContentRequirement[] {
  return computeMissingRequirements(presetLoadRequirements(preset, selection), {
    games: installed.games.map((name) => ({ name })),
    maps: [...installed.maps],
    engineVersions: [],
  });
}

/** The installed games that are other versions of `gameName`. */
export function otherInstalledVersions(
  gameName: string,
  installedGames: readonly string[],
): string[] {
  return installedGames.filter(
    (name) => name !== gameName && sameGameFamily(name, gameName),
  );
}

/** The selection minus the game and everything keyed by it, for a preset whose
 *  game is not here. */
export function withoutGame(selection: PresetSelection): PresetSelection {
  return {
    ...selection,
    parts: selection.parts.filter((part) => !GAME_KEYED.includes(part)),
  };
}

/** The preset's option keys that `selection` takes, so they can be checked
 *  against the game they are about to be loaded onto. */
export function takenOptionKeys(
  modOptionValues: Record<string, string>,
  selection: PresetSelection,
): string[] {
  return Object.keys(modOptionValues).filter((key) =>
    selection.parts.includes(isTweakSlotKey(key) ? "tweakSlots" : "modOptions"),
  );
}
