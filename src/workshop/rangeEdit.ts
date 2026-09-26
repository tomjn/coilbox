/**
 * Editing Range from the Reference table (issue #3157): the one editable
 * column that is not a field on the unit at all. The table's Range column is
 * the longest range among a unit's own weapons, a shield's not counted
 * (`unitReference.ts`'s `maxRange`), so writing a new range means picking
 * which weapon or weapons change and then writing each one exactly the way
 * the unit editor's Weapons tab would: an override on the unit's own copy, a
 * change to a library weapon a slot fires, or, for a slot that still fires
 * the game's shared definition, a copy into the project's library first
 * (`weaponLibrary.ts`, `weaponRefs.ts`), equipped into that slot, the same
 * three destinations `UnitPage.tsx`'s `slotLibrary` writes to.
 *
 * Two rules, matching what "Change by %", "Add", "Set to" and an in-place
 * cell edit already mean for every other column, bent around Range having
 * more than one number underneath it:
 *
 * - A percentage or an offset touches every one of the unit's non-shield
 *   weapons, each computed from its own current range.
 * - Setting to a value, whether from the bulk panel or an in-place edit,
 *   touches only the weapon or weapons currently at the unit's longest
 *   range, and leaves a shorter one alone, so the column reads exactly the
 *   value typed afterwards.
 *
 * `planRangeChanges` computes both the preview and the write in one pass,
 * threading the project's weapon library forward across the units it
 * touches so two units copying the same shared weapon in one bulk change get
 * two distinct copies, named the way copying one at a time from the Weapons
 * tab would name them (`suggestWeaponKeyWhere`). The caller writes the
 * result's `overrides`, `library` and `equipped` back as one commit, which is
 * what keeps a bulk change to one undo step.
 */

import {
  applyBatchOperation,
  applyBatchRounding,
  type BatchOperation,
  type BatchRounding,
  toNumber,
} from "./batchEdit";
import type { PostChange } from "./beforePost";
import type { UnitClones } from "./clones";
import { weaponStats } from "./derivedStats";
import { setOverride, type UnitOverrides } from "./overrides";
import { sameValue } from "./unitReference";
import {
  addLibraryWeapon,
  copyGameWeapon,
  type EquippedWeapons,
  equipWeapon,
  type LibraryWeapon,
  libraryWeaponDef,
  setLibraryField,
  suggestWeaponKeyWhere,
  type WeaponLibrary,
} from "./weaponLibrary";
import { planLibraryCopy, sharedWeaponCopy } from "./weaponRefs";
import { type WeaponSlot, weaponSlots } from "./weaponSlots";

/** The key a table spells a field under, however it cases it. */
function findKeyCI(
  table: Record<string, unknown>,
  lower: string,
): string | undefined {
  return Object.keys(table).find((key) => key.toLowerCase() === lower);
}

/** Where one weapon's range is written. */
export type RangeWeaponTarget =
  /** The unit's own copy of the definition. */
  | { kind: "override"; path: string; inherited: unknown }
  /** A library weapon the slot already fires. */
  | { kind: "library"; key: string; path: string; inherited: unknown }
  /** The game's shared definition, which the slot fires unedited: writing to
   *  it takes copying it into the project's library first, equipped into
   *  this slot, the same as the Weapons tab's "Give this unit its own copy". */
  | {
      kind: "copy";
      step: string;
      source: string;
      def: Record<string, unknown>;
      beforePost: PostChange | undefined;
    };

/** One of a unit's non-shield weapons, as Range edits it. */
export interface RangeWeapon {
  /** What the preview calls it: the slot's number and its weapon's name. */
  label: string;
  /** Its current effective range. */
  range: number;
  target: RangeWeaponTarget;
}

/** Everything `planRangeChanges` needs to read a project's units and write
 *  back to them, the same three stores the unit editor's Weapons tab reads
 *  and writes (`UnitPage.tsx`). */
export interface RangeEditContext {
  /** The game's units with the project's own copies in among them,
   *  unedited: the same table every other reference edit reads. */
  units: Record<string, Record<string, unknown> | undefined>;
  /** Which unit a clone was copied from, for a slot whose name still says
   *  the source (`weaponSlots.ts`'s `owners`). */
  ownClones: UnitClones;
  weaponDefs: Record<string, Record<string, unknown>>;
  overrides: UnitOverrides;
  library: WeaponLibrary;
  equipped: EquippedWeapons;
  /** The game's own checksum, carried onto a fresh library copy the way
   *  `UnitPage.tsx`'s own copy button does, for the drift check (issue
   *  #1281). */
  checksum: string | undefined;
  /** What the game's post files changed in a shared weapon, when the game
   *  could say (issue #3054). */
  beforePostOf: (name: string) => PostChange | undefined;
}

/** What a slot is called on the preview: the weapon it fires now, or the
 *  name its own definition gives, or the slot's own name when neither says
 *  anything (the same fallback `WeaponSlotsPanel.tsx`'s `slotTitle` draws the
 *  slot button with). */
function weaponLabel(slot: WeaponSlot, fires: string | undefined): string {
  if (fires) return `Weapon ${slot.number} (${fires})`;
  const def =
    slot.definition.kind !== "missing" ? slot.definition.def : undefined;
  const nameKey = def ? findKeyCI(def, "name") : undefined;
  const named = nameKey ? def?.[nameKey] : undefined;
  const name =
    typeof named === "string" && named.trim() ? named.trim() : slot.name;
  return `Weapon ${slot.number} (${name})`;
}

/** `unitKey`'s non-shield weapons, in slot order, with where each one's
 *  range is written and what it currently reads. A shield does not count,
 *  the same filter `unitReference.ts`'s `maxRange` applies, and a slot naming
 *  no weapon the game defines has nothing to change either. */
export function unitRangeWeapons(
  unitKey: string,
  ctx: RangeEditContext,
): RangeWeapon[] {
  const rawDef = ctx.units[unitKey];
  const cloneSource = ctx.ownClones[unitKey]?.source;
  const owners = cloneSource ? [unitKey, cloneSource] : [unitKey];
  const slots = weaponSlots(rawDef, ctx.weaponDefs, owners);
  const unitEquipped = ctx.equipped[unitKey];
  const out: RangeWeapon[] = [];

  for (const slot of slots) {
    const fires = unitEquipped?.[slot.step];
    const equippedWeapon = fires ? ctx.library[fires] : undefined;
    if (fires && equippedWeapon) {
      const resolved = libraryWeaponDef(equippedWeapon);
      const stats = weaponStats({ def: resolved });
      if (stats.weaponType === "Shield") continue;
      const rangeKey = findKeyCI(equippedWeapon.def, "range") ?? "range";
      out.push({
        label: weaponLabel(slot, fires),
        range: stats.range,
        target: {
          kind: "library",
          key: fires,
          path: rangeKey,
          inherited: equippedWeapon.def[rangeKey],
        },
      });
      continue;
    }
    if (slot.definition.kind === "missing") continue;
    const def = slot.definition.def;
    const stats = weaponStats({ def });
    if (stats.weaponType === "Shield") continue;
    const rangeKey = findKeyCI(def, "range") ?? "range";

    if (slot.definition.kind === "own") {
      const path = `${slot.definition.path}.${rangeKey}`;
      const overrideRaw = ctx.overrides[unitKey]?.[path];
      const overridden =
        overrideRaw !== undefined ? toNumber(overrideRaw) : undefined;
      out.push({
        label: weaponLabel(slot, undefined),
        range: overridden ?? stats.range,
        target: { kind: "override", path, inherited: def[rangeKey] },
      });
      continue;
    }

    // A shared definition, fired unedited: nothing this unit can write to
    // without copying it into the library first (issue #3052).
    out.push({
      label: weaponLabel(slot, undefined),
      range: stats.range,
      target: {
        kind: "copy",
        step: slot.step,
        source: slot.definition.key,
        def,
        beforePost: ctx.beforePostOf(slot.definition.key),
      },
    });
  }
  return out;
}

/** One weapon in the preview: what it was called, its range before and
 *  after, and whether applying would actually change it. `copiedAs` is set
 *  when writing it would copy a shared weapon into the project's library
 *  first, under the name it would get there. */
export interface RangeWeaponRow {
  label: string;
  before: number;
  after: number;
  changed: boolean;
  copiedAs?: string;
}

/** One unit in the preview. `skipped` is a unit with no non-shield weapon at
 *  all, which Range has nothing to change either way. */
export interface RangeUnitRow {
  unit: string;
  weapons: RangeWeaponRow[];
  skipped?: boolean;
}

/** The preview and the write, together: `rows` is what the panel draws,
 *  `overrides`/`library`/`equipped` are the project's three stores with
 *  every change already folded in, ready for the caller to write back as one
 *  commit. Computing both in the same pass is what keeps the library name a
 *  copy gets in the preview the same one it gets on apply. */
export interface RangePlan {
  rows: RangeUnitRow[];
  overrides: UnitOverrides;
  library: WeaponLibrary;
  equipped: EquippedWeapons;
}

/**
 * Range across `unitKeys`, under one operation (issue #3157):
 *
 * - `multiply` (the bulk panel's "Change by %") and `offset` ("Add") touch
 *   every non-shield weapon, each from its own current range.
 * - `set` (the bulk panel's "Set to", and an in-place cell edit) touches
 *   only the weapon or weapons already at the unit's longest range, leaving
 *   a shorter one alone so the column reads exactly the value typed.
 *
 * A weapon whose write would change nothing (the operation's answer equals
 * what it already holds) is still listed, marked unchanged, the same as
 * every other batch preview, and nothing is written for it: a "Set to" that
 * copies a shared weapon only for the copy to sit at the value it was
 * already firing would be a pointless copy.
 */
export function planRangeChanges(
  ctx: RangeEditContext,
  unitKeys: readonly string[],
  operation: BatchOperation,
  rounding: BatchRounding,
): RangePlan {
  let overrides = ctx.overrides;
  let library = ctx.library;
  let equipped = ctx.equipped;
  const rows: RangeUnitRow[] = [];

  for (const unitKey of unitKeys) {
    const weapons = unitRangeWeapons(unitKey, ctx);
    if (weapons.length === 0) {
      rows.push({ unit: unitKey, weapons: [], skipped: true });
      continue;
    }
    const maxRange = Math.max(...weapons.map((w) => w.range));
    const weaponRows: RangeWeaponRow[] = [];

    for (const weapon of weapons) {
      const affected =
        operation.kind === "set" ? sameValue(weapon.range, maxRange) : true;
      if (!affected) continue;
      const after = applyBatchRounding(
        applyBatchOperation(weapon.range, operation),
        rounding,
      );
      const changed = !sameValue(after, weapon.range);
      let copiedAs: string | undefined;

      if (changed) {
        const { target } = weapon;
        if (target.kind === "override") {
          overrides = setOverride(
            overrides,
            unitKey,
            target.path,
            after,
            target.inherited,
          );
        } else if (target.kind === "library") {
          library =
            setLibraryField(
              library,
              target.key,
              target.path,
              after,
              target.inherited,
            ) ?? library;
        } else {
          const suggestedKey = suggestWeaponKeyWhere(target.source, (key) =>
            Object.hasOwn(library, key),
          );
          const planned = planLibraryCopy(
            suggestedKey,
            {
              source: target.source,
              def: target.def,
              beforePost: target.beforePost,
            },
            library,
            (ref) =>
              sharedWeaponCopy(
                ref.value.toLowerCase(),
                ctx.weaponDefs,
                ctx.beforePostOf,
              ),
            suggestWeaponKeyWhere,
          );
          for (const copy of planned) {
            const libraryWeapon: LibraryWeapon = copyGameWeapon(
              copy.key,
              copy.from.source,
              copy.from.def,
              ctx.checksum,
              copy.from.beforePost,
            );
            library = addLibraryWeapon(library, libraryWeapon) ?? library;
          }
          equipped =
            equipWeapon(equipped, unitKey, target.step, suggestedKey) ??
            equipped;
          const rangeKey = findKeyCI(target.def, "range") ?? "range";
          library =
            setLibraryField(
              library,
              suggestedKey,
              rangeKey,
              after,
              target.def[rangeKey],
            ) ?? library;
          copiedAs = suggestedKey;
        }
      }
      weaponRows.push({
        label: weapon.label,
        before: weapon.range,
        after,
        changed,
        copiedAs,
      });
    }
    rows.push({ unit: unitKey, weapons: weaponRows });
  }

  return { rows, overrides, library, equipped };
}

/** How many units in a plan would actually change something, for the bulk
 *  panel's "Apply to N units" and to gate the button, the same way
 *  `batchChangeCount` counts a plain column's rows. */
export function rangeChangeCount(rows: readonly RangeUnitRow[]): number {
  return rows.filter((row) => row.weapons.some((w) => w.changed)).length;
}
