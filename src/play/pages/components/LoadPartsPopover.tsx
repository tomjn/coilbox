import { Button } from "@picoframe/frame";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PresetPartsPicker } from "../../PresetPartsPicker";
import {
  ALL_PARTS,
  type PresetPart,
  type PresetSelection,
  partSummary,
} from "../../presetParts";
import type { SkirmishPreset } from "../../presets";

/**
 * Loading only some of a preset into the Singleplayer setup.
 *
 * The row's own Load button still takes everything, because that is the common
 * case and making it a two-step confirm would tax the thing that already works.
 * This sits beside it for the case the sharing brought in: somebody's map and
 * boxes without their teams.
 */
export function LoadPartsPopover({
  preset,
  currentGameName,
  disabled,
  onLoad,
}: {
  preset: SkirmishPreset;
  /** The game the setup is on now, for deciding whether the game-keyed parts
   *  can be taken without the game. */
  currentGameName: string;
  disabled?: boolean;
  onLoad: (preset: SkirmishPreset, selection: PresetSelection) => void;
}) {
  const [open, setOpen] = useState(false);
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

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSelection(ALL_PARTS);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={`Load parts of preset ${preset.name}`}
        >
          <SlidersHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-3">
        <p className="text-xs text-muted-foreground">
          Take only the parts you want. Everything you leave unticked stays as
          you have it.
        </p>
        <PresetPartsPicker
          preset={preset}
          selection={effective}
          onChange={setSelection}
          disabledReasons={disabledReasons}
          warnings={warnings}
        />
        <Button
          size="sm"
          className="w-full"
          disabled={count === 0}
          onClick={() => {
            onLoad(preset, effective);
            setOpen(false);
          }}
        >
          {count === 0
            ? "Nothing selected"
            : `Load ${count} part${count === 1 ? "" : "s"}`}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
