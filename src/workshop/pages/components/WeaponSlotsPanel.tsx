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
 *
 * Below the slots are the definitions the unit carries and no slot mounts,
 * such as a cluster munition's child (issue #2641, `weaponRefs.ts`). Their
 * fields are the unit's own, edited the way a mounted definition's are, and a
 * reference on the unit that names nothing is listed above both.
 */
import { Button } from "@picoframe/frame";
import { Undo2 } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CustomParamsResult } from "@/content/bindings";
import type { AssetBrowsing } from "../../assetFields";
import type { PostNote } from "../../beforePost";
import type { UnitOverrides } from "../../overrides";
import type { FieldRow } from "../../unitSections";
import type { WeaponLibrary } from "../../weaponLibrary";
import {
  librarySupport,
  type RefProblem,
  type SupportingDef,
} from "../../weaponRefs";
import {
  slotEditCount,
  supportingEditCount,
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
  post,
  onSelect,
  onChange,
  onReset,
  library,
  supporting = [],
  selectedSupport,
  onSelectSupport,
  problems = [],
}: {
  slots: WeaponSlot[];
  /** The slot on screen, which is always one of `slots` when there are any
   *  and no supporting definition is on screen instead. */
  selected: WeaponSlot | undefined;
  /** The selected slot's fields, or the supporting definition's, grouped. */
  view: WeaponSlotView | null;
  overrides: UnitOverrides;
  unitKey: string;
  consumers: CustomParamsResult | null;
  assets?: AssetBrowsing;
  inheritedLabel?: string;
  inPlace?: (row: FieldRow) => InPlaceField | undefined;
  /** What the game's post files do to a field of the unit's (issue #3057). */
  post?: (row: FieldRow) => PostNote | undefined;
  onSelect: (step: string) => void;
  onChange: (row: FieldRow, value: unknown) => void;
  onReset: (row: FieldRow) => void;
  /** The project's weapon library, and what the panel can do with it (issue
   *  #2640). */
  library: SlotLibrary;
  /** The definitions the unit carries and no slot mounts (issue #2641). */
  supporting?: SupportingDef[];
  /** The supporting definition on screen, by key, in place of a slot. */
  selectedSupport?: string;
  onSelectSupport?: (key: string) => void;
  /** References on this unit that name nothing (issue #2641). */
  problems?: RefProblem[];
}) {
  if (slots.length === 0 && supporting.length === 0)
    return (
      <p className="text-sm text-muted-foreground">This unit has no weapons.</p>
    );
  const onSlot = selectedSupport === undefined ? selected : undefined;

  return (
    <div className="flex flex-col gap-4">
      {problems.length > 0 && (
        <ul
          className="flex max-w-prose flex-col gap-1 text-xs text-destructive"
          aria-label="Weapon references that name nothing"
        >
          {problems.map((problem) => (
            <li key={problem.id}>{problem.message}</li>
          ))}
        </ul>
      )}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={1}
        className="flex-wrap"
        value={onSlot?.step ?? ""}
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

      {supporting.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground" id="supporting-defs">
            Supporting definitions: carried by this unit, mounted in no slot
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            className="flex-wrap"
            value={selectedSupport ?? ""}
            onValueChange={(key) => key && onSelectSupport?.(key)}
            aria-labelledby="supporting-defs"
          >
            {supporting.map((support) => {
              const changed = supportingEditCount(support, overrides, unitKey);
              return (
                <ToggleGroupItem
                  key={support.key}
                  value={support.key}
                  aria-label={`Supporting definition ${support.key}`}
                  title={
                    support.usedBy.length > 0
                      ? `Named by ${support.usedBy.map((u) => `${u.from}'s ${u.field}`).join(" and ")}`
                      : support.key
                  }
                  className="gap-1.5"
                >
                  <span className="max-w-48 truncate font-mono text-xs">
                    {support.key}
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
        </div>
      )}

      {onSlot && (
        <SlotWeaponActions
          slot={onSlot}
          library={library}
          fires={library.equippedIn(onSlot.step)}
        />
      )}

      {onSlot?.definition.kind === "missing" &&
        !library.equippedIn(onSlot.step) && (
          <p className="max-w-prose text-xs text-destructive">
            No weapon definition in this game is called {onSlot.name}, so the
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
            post={post}
            consumers={consumers}
            assets={assets}
            inheritedLabel={inheritedLabel}
            onChange={onChange}
            onReset={onReset}
          />
          {view.library && onSlot && (
            <UnitFieldGroups
              view={{
                groups: [view.library],
                shown: view.shown,
                hidden: view.hidden,
              }}
              consumers={consumers}
              assets={assets}
              inheritedLabel="Copied value"
              post={(row) =>
                library.postOf(library.equippedIn(onSlot.step), row)
              }
              onChange={(row, value) =>
                library.onChange(library.equippedIn(onSlot.step), row, value)
              }
              onReset={(row) =>
                library.onReset(library.equippedIn(onSlot.step), row)
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
  /** What the game's post files do to a library weapon's field (issue
   *  #3057). */
  postOf: (key: string | undefined, row: FieldRow) => PostNote | undefined;
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
  const brings = fires ? librarySupport(library.weapons, fires) : [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {fires && (
        <p className="text-xs text-muted-foreground">
          Weapon {slot.number} fires{" "}
          <span className="font-mono text-foreground">{fires}</span> from the
          project's weapon library, in place of{" "}
          <span className="font-mono">{slot.name}</span>.
          {brings.length > 0 && (
            <>
              {" "}
              It names{" "}
              <span className="font-mono text-foreground">
                {brings.join(", ")}
              </span>
              , which {brings.length === 1 ? "goes" : "go"} into{" "}
              {library.unitName} beside it. Change{" "}
              {brings.length === 1 ? "it" : "them"} in the weapon library.
            </>
          )}
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
