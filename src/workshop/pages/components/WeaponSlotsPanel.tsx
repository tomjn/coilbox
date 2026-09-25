/**
 * The unit page's weapons tab: one weapon slot at a time, its mount and its
 * definition in two labelled groups (issue #2639).
 *
 * Which fields belong to which table, and where each edit is written, is
 * `weaponSlots.ts`'s. This only draws the slot picker and hands the chosen
 * slot's groups to the same field list the rest of the page uses, so a weapon
 * field is edited, reset, marked unknown and refused for the in-place route
 * exactly the way a unit field is (issue #3050).
 */
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CustomParamsResult } from "@/content/bindings";
import type { AssetBrowsing } from "../../assetFields";
import type { UnitOverrides } from "../../overrides";
import type { FieldRow } from "../../unitSections";
import {
  slotEditCount,
  type WeaponSlot,
  type WeaponSlotView,
} from "../../weaponSlots";
import { UnitFieldGroups } from "./UnitFieldGroups";
import type { InPlaceField } from "./UnitFieldRow";

/** What a slot is called on its button: the weapon's display name, or the
 *  name the slot holds when its definition gives none. */
function slotTitle(slot: WeaponSlot): string {
  if (slot.definition.kind === "missing") return slot.name;
  const def = slot.definition.def;
  const key = Object.keys(def).find((k) => k.toLowerCase() === "name");
  const shown = key === undefined ? undefined : def[key];
  return typeof shown === "string" && shown.trim() ? shown.trim() : slot.name;
}

export function WeaponSlotsPanel({
  slots,
  selected,
  view,
  overrides,
  unitKey,
  consumers,
  assets,
  inheritedLabel,
  inPlace,
  onSelect,
  onChange,
  onReset,
}: {
  slots: WeaponSlot[];
  /** The slot on screen, which is always one of `slots` when there are any. */
  selected: WeaponSlot | undefined;
  /** The selected slot's fields, grouped. */
  view: WeaponSlotView | null;
  overrides: UnitOverrides;
  unitKey: string;
  consumers: CustomParamsResult | null;
  assets?: AssetBrowsing;
  inheritedLabel?: string;
  inPlace?: (row: FieldRow) => InPlaceField | undefined;
  onSelect: (step: string) => void;
  onChange: (row: FieldRow, value: unknown) => void;
  onReset: (row: FieldRow) => void;
}) {
  if (slots.length === 0)
    return (
      <p className="text-sm text-muted-foreground">This unit has no weapons.</p>
    );

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={1}
        className="flex-wrap"
        value={selected?.step ?? ""}
        onValueChange={(step) => step && onSelect(step)}
        aria-label="Weapon slot"
      >
        {slots.map((slot) => {
          const changed = slotEditCount(slot, overrides, unitKey);
          return (
            <ToggleGroupItem
              key={slot.step}
              value={slot.step}
              aria-label={`Weapon ${slot.number}, ${slot.name}`}
              title={slot.name}
              className="gap-1.5"
            >
              <span className="font-mono text-xs text-muted-foreground">
                {slot.number}
              </span>
              <span className="max-w-48 truncate">{slotTitle(slot)}</span>
              {changed > 0 && (
                <span
                  className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground"
                  title={`${changed} field${changed === 1 ? "" : "s"} changed`}
                >
                  {changed}
                </span>
              )}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      {selected?.definition.kind === "missing" && (
        <p className="max-w-prose text-xs text-destructive">
          No weapon definition in this game is called {selected.name}, so the
          engine leaves this slot empty.
        </p>
      )}

      {view && (
        <UnitFieldGroups
          view={{ groups: view.groups, shown: view.shown, hidden: view.hidden }}
          inPlace={inPlace}
          consumers={consumers}
          assets={assets}
          inheritedLabel={inheritedLabel}
          onChange={onChange}
          onReset={onReset}
        />
      )}
    </div>
  );
}
