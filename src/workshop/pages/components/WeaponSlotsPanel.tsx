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
 *
 * Last are the unit's two death explosions (issue #2642,
 * `deathExplosions.ts`). Each is a weapon definition the game names, and a
 * change to a shared one gives the unit its own copy out of the library.
 */
import { Button, Input } from "@picoframe/frame";
import { Plus, Undo2 } from "lucide-react";
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CustomParamsResult } from "@/content/bindings";
import type { AssetBrowsing } from "../../assetFields";
import type { PostNote } from "../../beforePost";
import type { DeathExplosion } from "../../deathExplosions";
import type { UnitOverrides } from "../../overrides";
import type { FieldRow } from "../../unitSections";
import type { DeathMount, WeaponLibrary } from "../../weaponLibrary";
import { librarySupport, type SupportingDef } from "../../weaponRefs";
import {
  describeLeaf,
  slotEditCount,
  supportingEditCount,
  type WeaponSlot,
  type WeaponSlotView,
} from "../../weaponSlots";
import { EquipWeaponPopover } from "./EquipWeaponPopover";
import { UnitFieldGroups } from "./UnitFieldGroups";
import type { InPlaceField } from "./UnitFieldRow";

/**
 * A button that turns into a name box, for adding one row to a weapon's
 * damage table (issue #2645). The value starts at 0, the same way a fresh
 * damage table entry means nothing until somebody types a number into it: this
 * only has to make the row exist, the field it becomes is the same one every
 * other damage row already draws.
 */
function AddDamageClass({ onAdd }: { onAdd: (className: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  if (!adding) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit gap-1.5 text-xs"
        onClick={() => setAdding(true)}
      >
        <Plus className="size-3.5" />
        Add a class to the damage table
      </Button>
    );
  }
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName("");
    setAdding(false);
  };
  return (
    <div className="flex w-fit items-center gap-1.5">
      <Input
        className="h-8 w-40 font-mono text-xs"
        aria-label="Armour class to add to the damage table"
        placeholder="Armour class"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setName("");
            setAdding(false);
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-[10px]"
        onClick={submit}
      >
        Add
      </Button>
    </div>
  );
}

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
  explosions,
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
  /** Things wrong with this unit's weapons that only its neighbours or the
   *  game's own data reveal: a reference that names nothing (issue #2641)
   *  and a damage table naming an armour class nobody has (issue #2645). */
  problems?: { id: string; message: string }[];
  /** The unit's death explosions, and what the panel can do with them
   *  (issue #2642). When one is selected, `view` is its fields. */
  explosions?: ExplosionPanel;
}) {
  const hasExplosions = (explosions?.entries.length ?? 0) > 0;
  if (slots.length === 0 && supporting.length === 0 && !hasExplosions)
    return (
      <p className="text-sm text-muted-foreground">This unit has no weapons.</p>
    );
  const activeExplosion =
    explosions?.selected === undefined
      ? undefined
      : explosions.entries.find((e) => e.mount === explosions.selected);
  const onSlot =
    selectedSupport === undefined && activeExplosion === undefined
      ? selected
      : undefined;

  // Where "add a class" writes, when there is anywhere it can (issue #2645):
  // the supporting definition on screen, the library weapon the slot fires,
  // or the slot's own definition. A shared definition offers nothing, the
  // same as every other field on one.
  const activeSupport =
    selectedSupport !== undefined && activeExplosion === undefined
      ? supporting.find((s) => s.key === selectedSupport)
      : undefined;
  const fires = onSlot ? library.equippedIn(onSlot.step) : undefined;
  const firesWeapon = fires ? library.weapons[fires] : undefined;
  // A death explosion takes a new class the way it takes any other field: on
  // its library weapon, on the definition the unit carries, or, for a shared
  // one, by copying it first.
  const explosionFires = activeExplosion
    ? explosions?.equippedIn(activeExplosion.mount)
    : undefined;
  const explosionTarget = !activeExplosion
    ? undefined
    : explosionFires && library.weapons[explosionFires]
      ? { prefix: "", def: library.weapons[explosionFires].def }
      : activeExplosion.follows
        ? undefined
        : activeExplosion.definition.kind === "own"
          ? {
              prefix: activeExplosion.definition.path,
              def: activeExplosion.definition.def,
            }
          : activeExplosion.definition.kind === "shared"
            ? { prefix: "", def: activeExplosion.definition.def }
            : undefined;
  const addTarget:
    | { prefix: string; def: Record<string, unknown> }
    | undefined = activeExplosion
    ? explosionTarget
    : activeSupport
      ? { prefix: activeSupport.path, def: activeSupport.def }
      : firesWeapon
        ? { prefix: "", def: firesWeapon.def }
        : onSlot?.definition.kind === "own"
          ? { prefix: onSlot.definition.path, def: onSlot.definition.def }
          : undefined;
  const onAddDamageClass = (className: string) => {
    if (!addTarget) return;
    const leaf = `damage.${className}`;
    const field = describeLeaf(leaf, addTarget.def);
    const path = addTarget.prefix ? `${addTarget.prefix}.${leaf}` : leaf;
    const row: FieldRow = {
      path,
      field,
      label: field.label,
      present: false,
      inherited: field.default,
      value: 0,
      state: "overridden",
    };
    if (activeExplosion && explosions)
      explosions.onChange(activeExplosion, row, 0);
    else if (firesWeapon) library.onChange(fires, row, 0);
    else onChange(row, 0);
  };

  return (
    <div className="flex flex-col gap-4">
      {problems.length > 0 && (
        <ul
          className="flex max-w-prose flex-col gap-1 text-xs text-destructive"
          aria-label="Problems with this unit's weapons"
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
            value={activeSupport?.key ?? ""}
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

      {explosions && hasExplosions && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground" id="death-explosions">
            Death explosions: what the unit explodes as
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            className="flex-wrap"
            value={activeExplosion?.mount ?? ""}
            onValueChange={(mount) =>
              mount && explosions.onSelect(mount as DeathMount)
            }
            aria-labelledby="death-explosions"
          >
            {explosions.entries.map((explosion) => {
              const changed = explosions.editCount(explosion);
              const equippedHere = explosions.equippedIn(explosion.mount);
              return (
                <ToggleGroupItem
                  key={explosion.mount}
                  value={explosion.mount}
                  aria-label={explosion.label}
                  title={explosion.field}
                  className="gap-1.5"
                >
                  <span>
                    {explosion.mount === "explodeas"
                      ? "Dies"
                      : "Self-destructs"}
                  </span>
                  <span className="max-w-48 truncate font-mono text-xs text-muted-foreground">
                    {equippedHere ??
                      (explosion.follows
                        ? "as it dies"
                        : explosion.name || "nothing")}
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

      {activeExplosion && explosions && (
        <ExplosionActions
          explosion={activeExplosion}
          explosions={explosions}
          library={library}
        />
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

      {view && activeExplosion && explosions && (
        <UnitFieldGroups
          view={view}
          inPlace={
            activeExplosion.definition.kind === "own" && !explosionFires
              ? inPlace
              : undefined
          }
          post={(row) => explosions.postOf(activeExplosion, row)}
          consumers={consumers}
          assets={assets}
          inheritedLabel={
            explosionFires
              ? "Copied value"
              : activeExplosion.definition.kind === "own"
                ? inheritedLabel
                : undefined
          }
          onChange={(row, value) =>
            explosions.onChange(activeExplosion, row, value)
          }
          onReset={(row) => explosions.onReset(activeExplosion, row)}
        />
      )}

      {view && !activeExplosion && (
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
      {addTarget && <AddDamageClass onAdd={onAddDamageClass} />}
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

/** What the weapons panel needs to show and edit the unit's death
 *  explosions (issue #2642). */
export interface ExplosionPanel {
  entries: DeathExplosion[];
  /** The one on screen, in place of a slot. */
  selected: DeathMount | undefined;
  /** The library weapon one is, when the project made it one. */
  equippedIn: (mount: DeathMount) => string | undefined;
  editCount: (explosion: DeathExplosion) => number;
  /** What a copy of one would be called. */
  copyKey: (explosion: DeathExplosion) => string;
  onSelect: (mount: DeathMount) => void;
  onChange: (explosion: DeathExplosion, row: FieldRow, value: unknown) => void;
  onReset: (explosion: DeathExplosion, row: FieldRow) => void;
  postOf: (explosion: DeathExplosion, row: FieldRow) => PostNote | undefined;
  onCopy: (explosion: DeathExplosion, key: string) => void;
  onEquip: (explosion: DeathExplosion, key: string) => void;
  onPutBack: (explosion: DeathExplosion) => void;
}

/** What a death explosion is now, and the buttons that change it. */
function ExplosionActions({
  explosion,
  explosions,
  library,
}: {
  explosion: DeathExplosion;
  explosions: ExplosionPanel;
  library: SlotLibrary;
}) {
  const fires = explosions.equippedIn(explosion.mount);
  const noun =
    explosion.mount === "explodeas"
      ? "death explosion"
      : "self-destruct explosion";
  if (!fires && explosion.follows) {
    const death = explosions.equippedIn("explodeas") ?? explosion.name;
    return (
      <p className="max-w-prose text-xs text-muted-foreground">
        {library.unitName} sets no {explosion.field}, so the engine uses its
        death explosion,{" "}
        <span className="font-mono text-foreground">{death || "nothing"}</span>,
        when it self-destructs. Change the death explosion to change both, or
        set {explosion.field} on the fields tab to give it one of its own.
      </p>
    );
  }
  const shared = !fires && explosion.definition.kind === "shared";
  const copySource =
    fires || explosion.definition.kind === "missing"
      ? undefined
      : explosion.definition.kind === "shared"
        ? explosion.definition.key
        : explosion.name.toLowerCase();
  return (
    <div className="flex flex-col gap-2">
      {fires ? (
        <p className="max-w-prose text-xs text-muted-foreground">
          The {noun} is{" "}
          <span className="font-mono text-foreground">{fires}</span> from the
          project's weapon library, in place of{" "}
          <span className="font-mono">{explosion.name || "nothing"}</span>.
        </p>
      ) : (
        explosion.definition.kind === "missing" && (
          <p className="max-w-prose text-xs text-destructive">
            {explosion.name
              ? `No weapon definition in this game is called ${explosion.name}, so the engine uses its empty NOWEAPON definition and the unit explodes as nothing.`
              : `${library.unitName} sets no ${explosion.field}, so the engine uses its empty NOWEAPON definition and the unit explodes as nothing.`}
          </p>
        )
      )}
      <div className="flex flex-wrap items-center gap-2">
        <EquipWeaponPopover
          label={
            fires
              ? "Change explosion"
              : shared
                ? `Give ${library.unitName} its own copy`
                : "Use a library weapon"
          }
          shared={shared}
          unitName={library.unitName}
          usesCopy={`the ${noun} is the copy`}
          copySource={copySource}
          suggestedKey={copySource ? explosions.copyKey(explosion) : undefined}
          library={library.weapons}
          equippedHere={fires}
          mounts={library.mounts}
          refusal={library.refusal}
          onCopy={(key) => explosions.onCopy(explosion, key)}
          onEquip={(key) => explosions.onEquip(explosion, key)}
        />
        {fires && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => explosions.onPutBack(explosion)}
          >
            <Undo2 className="size-3.5" />
            Put back {explosion.name || "the game's"}
          </Button>
        )}
      </div>
    </div>
  );
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
        usesCopy={`weapon ${slot.number} fires the copy`}
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
