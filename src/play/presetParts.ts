import { isTweakSlotKey } from "@/workshop/deliveryRoutes";
import type { SkirmishDraft } from "./drafts";

/**
 * Taking only the parts you want out of a preset.
 *
 * A preset is a whole setup, and applying one applies all of it. That is right
 * when reloading your own saved battle and wrong when somebody shares a preset
 * and you wanted one thing out of it: their map and start boxes, say, without
 * losing the teams you already sorted.
 *
 * The seven parts below partition `SkirmishDraft` exactly. Every field belongs
 * to one part and no field belongs to two, which is what lets `ALL_PARTS`
 * reproduce a wholesale load rather than approximate it. `applySelection` is
 * pure, so both surfaces that apply presets can be tested without rendering:
 * the Singleplayer page hands the result to its own setters, and the battle
 * room reads the parts to decide which of its sends to make.
 */
export type PresetPart =
  | "game"
  | "map"
  | "startPositions"
  | "modOptions"
  | "tweakSlots"
  | "teams"
  | "restrictions";

/** Every part, in the order the picker lists them. */
export const PRESET_PARTS: readonly PresetPart[] = [
  "game",
  "map",
  "startPositions",
  "modOptions",
  "tweakSlots",
  "teams",
  "restrictions",
];

/** Short label for each part, shared by both pickers. */
export const PART_LABELS: Record<PresetPart, string> = {
  game: "Game",
  map: "Map",
  startPositions: "Start positions",
  modOptions: "Mod options",
  tweakSlots: "Unit tweaks",
  teams: "Teams and bots",
  restrictions: "Unit restrictions",
};

/**
 * How one of the two key-value parts folds into what is already set.
 *
 * Only `modOptions` and `tweakSlots` hold maps of keys to values, so only they
 * can merge. The other five parts hold a single value each, where taking the
 * part is replacement by definition and offering the choice would be a control
 * that does nothing.
 */
export type MergeMode = "overlay" | "replace";

export interface PresetSelection {
  parts: readonly PresetPart[];
  /** How `modOptions` folds in, when taken. */
  modOptions: MergeMode;
  /** How `tweakSlots` folds in, when taken. */
  tweakSlots: MergeMode;
}

/**
 * Take everything, which is what an ordinary Load does.
 *
 * The merge mode is `replace` rather than `overlay` because replace is what a
 * wholesale load has always done: a key the current draft sets and the preset
 * does not is dropped. Defaulting to overlay would quietly keep it and break
 * the one property the rest of this rests on.
 */
export const ALL_PARTS: PresetSelection = {
  parts: PRESET_PARTS,
  modOptions: "replace",
  tweakSlots: "replace",
};

/** Split a preset's option values into the tweak slots and everything else. */
function splitOptions(values: Record<string, string>): {
  plain: Record<string, string>;
  tweak: Record<string, string>;
} {
  const plain: Record<string, string> = {};
  const tweak: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (isTweakSlotKey(key)) tweak[key] = value;
    else plain[key] = value;
  }
  return { plain, tweak };
}

/** One option group's result: untouched, replaced wholesale, or overlaid. */
function mergeGroup(
  currentGroup: Record<string, string>,
  presetGroup: Record<string, string>,
  taken: boolean,
  mode: MergeMode,
): Record<string, string> {
  if (!taken) return currentGroup;
  if (mode === "replace") return presetGroup;
  return { ...currentGroup, ...presetGroup };
}

/**
 * The draft you get by taking `selection` of `preset` on top of `current`.
 *
 * Pure, and total over the parts: with `ALL_PARTS` it returns `preset`, and
 * with no parts at all it returns `current`.
 */
export function applySelection(
  current: SkirmishDraft,
  preset: SkirmishDraft,
  selection: PresetSelection,
): SkirmishDraft {
  const take = (part: PresetPart) => selection.parts.includes(part);
  const from = take("startPositions") ? preset : current;
  const currentOptions = splitOptions(current.modOptionValues);
  const presetOptions = splitOptions(preset.modOptionValues);

  return {
    gameName: take("game") ? preset.gameName : current.gameName,
    mapName: take("map") ? preset.mapName : current.mapName,
    startPosType: from.startPosType,
    startRects: from.startRects,
    participants: take("teams") ? preset.participants : current.participants,
    restrictions: take("restrictions")
      ? preset.restrictions
      : current.restrictions,
    modOptionValues: {
      ...mergeGroup(
        currentOptions.plain,
        presetOptions.plain,
        take("modOptions"),
        selection.modOptions,
      ),
      ...mergeGroup(
        currentOptions.tweak,
        presetOptions.tweak,
        take("tweakSlots"),
        selection.tweakSlots,
      ),
    },
  };
}

/** How many options a draft carries in each group. */
export function optionCounts(draft: SkirmishDraft): {
  plain: number;
  tweak: number;
} {
  const { plain, tweak } = splitOptions(draft.modOptionValues);
  return { plain: Object.keys(plain).length, tweak: Object.keys(tweak).length };
}

const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A line describing what this preset holds for one part, or null when it holds
 * nothing for it. The picker shows the null rows disabled rather than hiding
 * them, so the list does not reshuffle as you move between presets.
 */
export function partSummary(
  draft: SkirmishDraft,
  part: PresetPart,
): string | null {
  const counts = optionCounts(draft);
  switch (part) {
    case "game":
      return draft.gameName || null;
    case "map":
      return draft.mapName || null;
    case "startPositions": {
      const boxes = Object.keys(draft.startRects ?? {}).length;
      if (draft.startPosType !== 2)
        return draft.startPosType === 0
          ? "Fixed map positions"
          : "Random positions";
      return `Choose in-game, ${plural(boxes, "box")}`;
    }
    case "modOptions":
      return counts.plain > 0 ? plural(counts.plain, "option") : null;
    case "tweakSlots":
      return counts.tweak > 0 ? plural(counts.tweak, "tweak slot") : null;
    case "teams": {
      if (draft.participants.length === 0) return null;
      const bots = draft.participants.filter((p) => p.kind === "ai").length;
      return `${plural(draft.participants.length, "player")}, ${plural(bots, "bot")}`;
    }
    case "restrictions": {
      const r = draft.restrictions;
      if (!r) return null;
      const bits: string[] = [];
      if (r.disabledUnits?.length)
        bits.push(plural(r.disabledUnits.length, "unit") + " disabled");
      if (r.advantage !== undefined)
        bits.push(`${Math.round(r.advantage * 100)}% advantage`);
      if (r.incomeMultiplier !== undefined)
        bits.push(`${r.incomeMultiplier}x income`);
      return bits.length > 0 ? bits.join(", ") : null;
    }
  }
}
