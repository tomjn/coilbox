import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import type { ReactNode } from "react";
import { useState } from "react";
import type { SkirmishDraft } from "./drafts";
import { PresetPartsPicker } from "./PresetPartsPicker";
import { type PresetFitFacts, presetFitWarnings } from "./presetFit";
import {
  ALL_PARTS,
  PRESET_PARTS,
  type PresetPart,
  type PresetSelection,
  partSummary,
} from "./presetParts";

/**
 * Choosing which parts of one preset to take, as a panel a drawer switches to.
 *
 * Shared by both surfaces that apply presets, because they are the same job:
 * the Singleplayer sheet loads the parts into the setup, and a battle room
 * applies them to the room. They differ only in the verb, in which parts they
 * can offer at all, and in what else you can do to a preset while looking at
 * it, so those are props rather than two components.
 *
 * Mount with a `key` of the preset id, so picking a different preset starts
 * from a fresh selection rather than inheriting the last one's ticks.
 */
export function PresetPartsView({
  preset,
  currentGameName,
  verb,
  omit = [],
  extraDisabledReasons = {},
  blockedLabel,
  disabled,
  onConfirm,
  progress,
  actions,
  fit,
}: {
  preset: SkirmishDraft;
  /** The game being applied to now: the setup's game, or the room's. Decides
   *  whether the game-keyed parts can be taken at all. */
  currentGameName: string;
  /** What the primary button does, e.g. "Load" or "Apply". */
  verb: string;
  /** Parts this surface cannot offer. A battle room omits `game`, because it
   *  can only ever run the game it is already on. */
  omit?: readonly PresetPart[];
  /** Further reasons a part cannot be taken here, beyond the cross-game rule. */
  extraDisabledReasons?: Partial<Record<PresetPart, string>>;
  /** When set, the primary button is disabled and says this instead: something
   *  this surface is still waiting on. */
  blockedLabel?: string | null;
  disabled?: boolean;
  onConfirm: (selection: PresetSelection) => void;
  /** How a slow apply is going, for a surface where confirming starts a run
   *  rather than finishing one. */
  progress?: ReactNode;
  /** Whatever else this surface offers for the whole preset, under the primary
   *  button. Singleplayer puts hosting, sharing and deleting here. */
  actions?: ReactNode;
  /** What the game and map declare, for warning about parts that do not fit
   *  them. Absent, only the start box warning is given. */
  fit?: PresetFitFacts;
}) {
  const { t } = useLingui();
  const offered = PRESET_PARTS.filter((part) => !omit.includes(part));
  const [selection, setSelection] = useState<PresetSelection>({
    ...ALL_PARTS,
    parts: offered,
  });

  // Mod options, tweak slots and restrictions are all keyed by the game that
  // declared them, so taking them into a different game produces keys and unit
  // names that game never had. Blocked rather than warned, because unlike a box
  // layout drawn for another map there is no reading of it that works.
  const crossGame =
    preset.gameName !== currentGameName && !selection.parts.includes("game");
  // Where the game is not on offer there is nothing to tell the reader to do,
  // so the reason says what is true instead of asking for the impossible.
  const presetGame = preset.gameName;
  const reason = omit.includes("game")
    ? t`Belongs to ${presetGame}, and this room is running ${currentGameName}.`
    : t`Belongs to ${presetGame}. Take the game as well, or leave this out.`;
  const disabledReasons: Partial<Record<PresetPart, string>> = {
    ...(crossGame
      ? { modOptions: reason, tweakSlots: reason, restrictions: reason }
      : {}),
    ...extraDisabledReasons,
  };

  /**
   * Parts nothing the reader can do here would unblock.
   *
   * A surface's own block is one. The cross-game block is another, but only
   * where the game is not on offer: in Singleplayer ticking the game clears it,
   * so those parts are still reachable and still count, while a battle room
   * cannot change game and never will clear it.
   *
   * This decides what "all" means. Counting a part that cannot be ticked would
   * leave "Select all" offering nothing and stop the button ever saying "all".
   */
  const unreachable = new Set<PresetPart>(
    Object.keys(extraDisabledReasons) as PresetPart[],
  );
  if (omit.includes("game") && preset.gameName !== currentGameName)
    for (const part of ["modOptions", "tweakSlots", "restrictions"] as const)
      unreachable.add(part);

  /** The parts this preset carries that this surface could actually take. */
  const carried = offered.filter(
    (part) => partSummary(preset, part) !== null && !unreachable.has(part),
  );

  // What the picker shows ticked, which is what confirming must use. A part the
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

  const presetMap = preset.mapName;
  const warnings: Partial<Record<PresetPart, string>> = {
    ...(fit ? presetFitWarnings(preset, effective, fit) : {}),
    ...(effective.parts.includes("startPositions") &&
    !effective.parts.includes("map")
      ? {
          startPositions: t`These boxes were drawn for ${presetMap}, not the map you are on.`,
        }
      : {}),
  };

  const count = effective.parts.length;
  const everything = count === carried.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-3">
        <p className="text-xs text-muted-foreground">
          <Trans>
            Take only the parts you want. Everything you leave unticked stays as
            you have it.
          </Trans>
        </p>
        {!everything && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs"
            onClick={() => setSelection({ ...selection, parts: offered })}
          >
            <Trans>Select all</Trans>
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <PresetPartsPicker
          preset={preset}
          selection={effective}
          onChange={setSelection}
          omit={omit}
          disabledReasons={disabledReasons}
          warnings={warnings}
        />
      </div>

      <div className="space-y-2 border-t border-border/60 px-5 py-3">
        {progress}
        <Button
          className="w-full"
          disabled={disabled || count === 0 || !!blockedLabel}
          onClick={() => onConfirm(effective)}
        >
          {blockedLabel
            ? blockedLabel
            : count === 0
              ? t`Nothing selected`
              : everything
                ? plural(count, {
                    one: `${verb} all # part`,
                    other: `${verb} all # parts`,
                  })
                : plural(count, {
                    one: `${verb} # part`,
                    other: `${verb} # parts`,
                  })}
        </Button>
        {actions}
      </div>
    </div>
  );
}
