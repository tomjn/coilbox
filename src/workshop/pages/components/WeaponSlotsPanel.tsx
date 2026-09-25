/**
 * The unit page's weapons tab: one weapon slot at a time, its mount and its
 * definition in two labelled groups (issue #2639).
 *
 * Which fields belong to which table, and where each edit is written, is
 * `weaponSlots.ts`'s. This only draws the slot picker and hands the chosen
 * slot's groups to the same field list the rest of the page uses, so a weapon
 * field is edited, reset, marked unknown and refused for the in-place route
 * exactly the way a unit field is (issue #3050).
 *
 * Each slot can also fire a weapon out of the project's library instead of the
 * game's (issue #2640), which is how a unit gets its own copy of a weapon it
 * mounts from the game's shared table (issue #3052). Those fields are the
 * library weapon's, so they go to their own writer rather than the unit's.
 */
import { Button } from "@picoframe/frame";
import { Undo2 } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CustomParamsResult } from "@/content/bindings";
import type { AssetBrowsing } from "../../assetFields";
import type { UnitOverrides } from "../../overrides";
import type { FieldRow } from "../../unitSections";
import type { WeaponLibrary } from "../../weaponLibrary";
import {
  slotEditCount,
  type WeaponSlot,
  type WeaponSlotView,
} from "../../weaponSlots";
import { EquipWeaponPopover } from "./EquipWeaponPopover";
import { UnitFieldGroups } from "./UnitFieldGroups";
import type { InPlaceField } from "./UnitFieldRow";

/** What a slot is called on its button: the weapon's display name, or the
 *  name the slot holds when its definition gives none. */
function slotTitle(slot: WeaponSlot, equipped: string | undefined): string {
  if (equipped) return equipped;
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
  library,
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
  /** The project's weapon library, and what the panel can do with it (issue
   *  #2640). */
  library: SlotLibrary;
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
          const fires = library.equippedIn(slot.step);
          const changed =
            slotEditCount(slot, overrides, unitKey) + (fires ? 1 : 0);
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
              <span className="max-w-48 truncate">
                {slotTitle(slot, fires)}
              </span>
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

      {selected && (
        <SlotWeaponActions
          slot={selected}
          library={library}
          fires={library.equippedIn(selected.step)}
        />
      )}

      {selected?.definition.kind === "missing" &&
        !library.equippedIn(selected.step) && (
          <p className="max-w-prose text-xs text-destructive">
            No weapon definition in this game is called {selected.name}, so the
            engine leaves this slot empty.
          </p>
        )}

      {view && (
        <div className="flex flex-col gap-8">
          <UnitFieldGroups
            view={{
              groups: view.groups,
              shown: view.shown,
              hidden: view.hidden,
            }}
            inPlace={inPlace}
            consumers={consumers}
            assets={assets}
            inheritedLabel={inheritedLabel}
            onChange={onChange}
            onReset={onReset}
          />
          {view.library && selected && (
            <UnitFieldGroups
              view={{
                groups: [view.library],
                shown: view.shown,
                hidden: view.hidden,
              }}
              consumers={consumers}
              assets={assets}
              inheritedLabel="Copied value"
              onChange={(row, value) =>
                library.onChange(library.equippedIn(selected.step), row, value)
              }
              onReset={(row) =>
                library.onReset(library.equippedIn(selected.step), row)
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

/** What the weapons panel needs to offer the project's library (issue #2640). */
export interface SlotLibrary {
  weapons: WeaponLibrary;
  unitName: string;
  /** The library weapon a slot fires, by the slot's step. */
  equippedIn: (step: string) => string | undefined;
  /** The weapon a slot fires now as the game names it, when there is one to
   *  copy. */
  copySourceOf: (slot: WeaponSlot) => string | undefined;
  mounts: (key: string) => number;
  refusal: (key: string) => string | undefined;
  onCopy: (slot: WeaponSlot, key: string) => void;
  onEquip: (slot: WeaponSlot, key: string) => void;
  onUnequip: (slot: WeaponSlot) => void;
  onChange: (key: string | undefined, row: FieldRow, value: unknown) => void;
  onReset: (key: string | undefined, row: FieldRow) => void;
}

/** Which weapon the slot fires, and the buttons that change it. */
function SlotWeaponActions({
  slot,
  library,
  fires,
}: {
  slot: WeaponSlot;
  library: SlotLibrary;
  fires: string | undefined;
}) {
  const shared = !fires && slot.definition.kind === "shared";
  const copySource = fires ? undefined : library.copySourceOf(slot);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {fires && (
        <p className="text-xs text-muted-foreground">
          Weapon {slot.number} fires{" "}
          <span className="font-mono text-foreground">{fires}</span> from the
          project's weapon library, in place of{" "}
          <span className="font-mono">{slot.name}</span>.
        </p>
      )}
      <EquipWeaponPopover
        label={
          fires
            ? "Change weapon"
            : shared
              ? `Give ${library.unitName} its own copy`
              : "Equip a library weapon"
        }
        shared={shared}
        unitName={library.unitName}
        slotNumber={slot.number}
        copySource={copySource}
        library={library.weapons}
        equippedHere={fires}
        mounts={library.mounts}
        refusal={library.refusal}
        onCopy={(key) => library.onCopy(slot, key)}
        onEquip={(key) => library.onEquip(slot, key)}
      />
      {fires && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => library.onUnequip(slot)}
        >
          <Undo2 className="size-3.5" />
          Put back {slot.name}
        </Button>
      )}
    </div>
  );
}
