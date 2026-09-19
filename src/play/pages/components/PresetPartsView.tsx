import { Button } from "@picoframe/frame";
import { Link as LinkIcon, Share2, Swords } from "lucide-react";
import { useState } from "react";
import { PresetPartsPicker } from "../../PresetPartsPicker";
import {
  ALL_PARTS,
  PRESET_PARTS,
  type PresetPart,
  type PresetSelection,
  partSummary,
} from "../../presetParts";
import type { SkirmishPreset } from "../../presets";

/**
 * Choosing which parts of one preset to load, as a panel the presets drawer
 * switches to rather than a popover over it.
 *
 * A popover was the first shape, and it was wrong twice over: an icon nobody
 * could read sat fifth in a row of icons, and seven rows carrying a summary, a
 * merge checkbox and sometimes a warning do not fit 320px. The drawer already
 * has 480px and a place for a back button, so the parts go there and the row
 * click opens them.
 *
 * Mounted with a `key` of the preset id, so picking a different preset starts
 * from a fresh selection rather than inheriting the last one's ticks.
 */
export function PresetPartsView({
  preset,
  currentGameName,
  disabled,
  onLoad,
  onExport,
  onCopyLink,
  onHostAsBattle,
}: {
  preset: SkirmishPreset;
  /** The game the setup is on now, for deciding whether the game-keyed parts
   *  can be taken without the game. */
  currentGameName: string;
  disabled?: boolean;
  onLoad: (preset: SkirmishPreset, selection: PresetSelection) => void;
  onExport: (preset: SkirmishPreset) => void;
  onCopyLink: (preset: SkirmishPreset) => void;
  /** Absent where hosting is impossible, which is what hides the action on a
   *  Tachyon connection. */
  onHostAsBattle?: (preset: SkirmishPreset) => void;
}) {
  const [selection, setSelection] = useState<PresetSelection>(ALL_PARTS);

  // Mod options, tweak slots and restrictions are all keyed by the game that
  // declared them, so taking them into a different game produces keys and unit
  // names that game never had. Blocked rather than warned, because unlike a box
  // layout drawn for another map there is no reading of it that works.
  const crossGame =
    preset.gameName !== currentGameName && !selection.parts.includes("game");
  const reason = `Belongs to ${preset.gameName}. Take the game as well, or leave this out.`;
  const disabledReasons: Partial<Record<PresetPart, string>> = crossGame
    ? { modOptions: reason, tweakSlots: reason, restrictions: reason }
    : {};

  /** The parts this preset actually carries, whatever is ticked right now.
   *  Taking everything resolves the cross-game block by taking the game too,
   *  so the block is deliberately not counted here. */
  const carried = PRESET_PARTS.filter(
    (part) => partSummary(preset, part) !== null,
  );

  // What the picker shows ticked, which is what loading must use. A part the
  // preset carries nothing for, or one blocked above, is not ticked and must
  // not be applied even though it is still in `selection`.
  const effective: PresetSelection = {
    ...selection,
    parts: selection.parts.filter(
      (part) =>
        disabledReasons[part] === undefined &&
        partSummary(preset, part) !== null,
    ),
  };

  const warnings: Partial<Record<PresetPart, string>> =
    effective.parts.includes("startPositions") &&
    !effective.parts.includes("map")
      ? {
          startPositions: `These boxes were drawn for ${preset.mapName}, not the map you are on.`,
        }
      : {};

  const count = effective.parts.length;
  const everything = count === carried.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-3">
        <p className="text-xs text-muted-foreground">
          Take only the parts you want. Everything you leave unticked stays as
          you have it.
        </p>
        {!everything && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs"
            onClick={() => setSelection({ ...selection, parts: PRESET_PARTS })}
          >
            Select all
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <PresetPartsPicker
          preset={preset}
          selection={effective}
          onChange={setSelection}
          disabledReasons={disabledReasons}
          warnings={warnings}
        />
      </div>

      <div className="space-y-2 border-t border-border/60 px-5 py-3">
        <Button
          className="w-full"
          disabled={disabled || count === 0}
          onClick={() => onLoad(preset, effective)}
        >
          {count === 0
            ? "Nothing selected"
            : everything
              ? `Load all ${count} parts`
              : `Load ${count} part${count === 1 ? "" : "s"}`}
        </Button>
        {/* The whole-preset actions, which moved off the list row: they act on
         * this one preset and the row had five icons and no room to say so. */}
        <div className="flex items-center gap-2">
          {onHostAsBattle && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={disabled}
              onClick={() => onHostAsBattle(preset)}
            >
              <Swords className="size-4" /> Host as battle
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={disabled}
            onClick={() => onExport(preset)}
          >
            <Share2 className="size-4" /> Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={disabled}
            onClick={() => onCopyLink(preset)}
          >
            <LinkIcon className="size-4" /> Copy link
          </Button>
        </div>
      </div>
    </div>
  );
}
