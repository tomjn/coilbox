import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { SkirmishDraft } from "./drafts";
import {
  PART_LABELS,
  PRESET_PARTS,
  type PresetPart,
  type PresetSelection,
  partSummary,
} from "./presetParts";

/**
 * Ticking which parts of a preset to take.
 *
 * Shared by both surfaces that apply presets, which need different rows: the
 * battle room omits `game` because it only ever offers presets for the game it
 * is already running, and it disables `restrictions` for anybody who is not the
 * founder. Rather than know about either surface, this takes the omissions and
 * the reasons as props.
 *
 * A part the preset carries nothing for is shown disabled rather than hidden,
 * so the list does not reshuffle as you move between presets.
 */
export function PresetPartsPicker({
  preset,
  selection,
  onChange,
  omit = [],
  disabledReasons = {},
  warnings = {},
}: {
  /** The preset being applied, read for the per-row summaries. */
  preset: SkirmishDraft;
  selection: PresetSelection;
  onChange: (next: PresetSelection) => void;
  /** Parts this surface never offers. */
  omit?: readonly PresetPart[];
  /** Why a part cannot be taken here. Shown in place of the summary. */
  disabledReasons?: Partial<Record<PresetPart, string>>;
  /** A caution shown under a part that is being taken. */
  warnings?: Partial<Record<PresetPart, string>>;
}) {
  const idPrefix = useId();

  const toggle = (part: PresetPart, on: boolean) =>
    onChange({
      ...selection,
      // Rebuilt from PRESET_PARTS so a part ticked back on returns to its place
      // in the list rather than the end of it.
      parts: PRESET_PARTS.filter((p) =>
        p === part ? on : selection.parts.includes(p),
      ),
    });

  return (
    <ul className="space-y-2">
      {PRESET_PARTS.filter((part) => !omit.includes(part)).map((part) => {
        const summary = partSummary(preset, part);
        const reason =
          disabledReasons[part] ??
          (summary === null ? "Not in this preset" : undefined);
        const disabled = reason !== undefined;
        const checked = !disabled && selection.parts.includes(part);
        const mergeable = part === "modOptions" || part === "tweakSlots";
        const id = `${idPrefix}-${part}`;

        return (
          <li key={part}>
            <div className="flex items-start gap-2.5 text-sm">
              <Checkbox
                id={id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(v) => toggle(part, v === true)}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <label htmlFor={id} className="font-medium leading-none">
                  {PART_LABELS[part]}
                </label>
                <span className="text-xs leading-snug text-muted-foreground">
                  {reason ?? summary}
                </span>
                {checked && warnings[part] && (
                  <span className="text-xs leading-snug text-amber-600 dark:text-amber-500">
                    {warnings[part]}
                  </span>
                )}
              </span>
            </div>

            {mergeable && checked && (
              <div className="ml-7 mt-1.5 flex items-start gap-2.5">
                <Checkbox
                  id={`${id}-keep`}
                  checked={selection[part] === "overlay"}
                  onCheckedChange={(v) =>
                    onChange({
                      ...selection,
                      [part]: v === true ? "overlay" : "replace",
                    })
                  }
                  className="mt-0.5"
                />
                <label
                  htmlFor={`${id}-keep`}
                  className="text-xs leading-snug text-muted-foreground"
                >
                  {part === "modOptions"
                    ? "Keep options this preset does not set"
                    : "Keep tweak slots this preset does not set"}
                </label>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
