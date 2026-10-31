import { plural, t } from "@lingui/core/macro";
import type { ConfigOption } from "@/content/bindings";
import { isTweakSlotKey } from "@/workshop/deliveryRoutes";
import type { SkirmishDraft } from "./drafts";
import { effectiveTeams } from "./participants";
import type { PresetPart, PresetSelection } from "./presetParts";

/**
 * Which parts of a preset do not fit the game or map they are being applied to.
 *
 * Pure, so the Singleplayer sheet, the battle room's sheet and the message after
 * applying can all ask the same question. `undeclaredOptions` is exported for
 * the callers that only need the option check.
 */

/** How many names a warning spells out before it says "and N more". A display
 *  choice for a one line warning, not a limit on what is checked. */
const NAMED_IN_WARNING = 3;

/**
 * The facts the check needs, which the sheet loads from unitsync.
 *
 * Both the current and the preset's side are carried, because which one applies
 * depends on whether the game and the map are being taken, and that is decided
 * by the ticks inside the panel. Anything not known yet is left out, and a fact
 * left out never produces a warning: an empty schema means the game has not been
 * read, not that it declares nothing.
 */
export interface PresetFitFacts {
  /** The game the setup or room is on now. */
  currentGameName: string;
  /** The map the setup or room is on now. */
  currentMapName: string;
  /** The start position mode the setup or room is in now. */
  currentStartPosType: number;
  modOptions: { current?: ConfigOption[]; preset?: ConfigOption[] };
  mapOptions: { current?: ConfigOption[]; preset?: ConfigOption[] };
  /** How many start positions each map defines. */
  startPositions: { current?: number; preset?: number };
}

/**
 * The keys among `keys` that `schema` does not declare, compared without regard
 * to case because SPADS lowercases a setting before it sets it.
 *
 * Empty when the schema has no options, since that means "not read yet" and
 * flagging every key against it would warn about a game that is fine.
 */
export function undeclaredOptions(
  keys: Iterable<string>,
  schema: ConfigOption[] | undefined,
): string[] {
  const declared = new Set(
    (schema ?? [])
      .filter((o) => o.type !== "section")
      .map((o) => o.key.toLowerCase()),
  );
  if (declared.size === 0) return [];
  return [...keys].filter((key) => !declared.has(key.toLowerCase()));
}

function named(names: string[]): string {
  const shown = names.slice(0, NAMED_IN_WARNING).join(", ");
  const more = names.length - NAMED_IN_WARNING;
  return more > 0 ? t`${shown} and ${more} more` : shown;
}

/**
 * One short warning per part that the preset does not fit, for the parts the
 * selection takes. A part that fits has no entry.
 */
export function presetFitWarnings(
  preset: SkirmishDraft,
  selection: PresetSelection,
  facts: PresetFitFacts,
): Partial<Record<PresetPart, string>> {
  const take = (part: PresetPart) => selection.parts.includes(part);
  const out: Partial<Record<PresetPart, string>> = {};

  const gameName = take("game") ? preset.gameName : facts.currentGameName;
  const mapName = take("map") ? preset.mapName : facts.currentMapName;
  const gameIsPresets = take("game") && gameName !== facts.currentGameName;
  const mapIsPresets = take("map") && mapName !== facts.currentMapName;

  const modSchema = gameIsPresets
    ? facts.modOptions.preset
    : facts.modOptions.current;
  const presetKeys = Object.keys(preset.modOptionValues);

  if (take("modOptions")) {
    const missing = undeclaredOptions(
      presetKeys.filter((key) => !isTweakSlotKey(key)),
      modSchema,
    );
    if (missing.length > 0) {
      const names = named(missing);
      out.modOptions = t`${gameName} does not declare ${names}.`;
    }
  }

  if (take("tweakSlots")) {
    const missing = undeclaredOptions(
      presetKeys.filter((key) => isTweakSlotKey(key)),
      modSchema,
    );
    if (missing.length > 0) {
      const names = named(missing);
      out.tweakSlots = t`${gameName} does not declare ${names}.`;
    }
  }

  if (take("mapOptions")) {
    const missing = undeclaredOptions(
      Object.keys(preset.mapOptionValues ?? {}),
      mapIsPresets ? facts.mapOptions.preset : facts.mapOptions.current,
    );
    if (missing.length > 0) {
      const names = named(missing);
      out.mapOptions = t`${mapName} does not declare ${names}.`;
    }
  }

  // Start positions only bind in fixed mode, where team N spawns at position N.
  // In choose in-game the boxes decide, so the count says nothing.
  const startPosType = take("startPositions")
    ? preset.startPosType
    : facts.currentStartPosType;
  const positions = mapIsPresets
    ? facts.startPositions.preset
    : facts.startPositions.current;
  if (take("teams") && startPosType === 0 && positions !== undefined) {
    const teams = effectiveTeams(preset.participants).leaderIdByTeam.length;
    if (teams > positions) {
      const teamCount = plural(teams, { one: "# team", other: "# teams" });
      const positionCount = plural(positions, {
        one: "# start position",
        other: "# start positions",
      });
      out.teams = t`${teamCount}, but ${mapName} has ${positionCount}.`;
    }
  }

  return out;
}
