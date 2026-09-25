/**
 * Which weapon a unit's slot actually fires (issue #3081): a library weapon
 * the project has equipped into the slot stands in for the slot's own
 * definition (`weaponLibrary.ts`, issue #2640). `UnitPage.tsx`'s
 * `derivedWeapons` memo answered this for the one unit open in the editor.
 * This is that resolution pulled out so the reference table
 * (`unitReference.ts`) and the search predicate (`searchQuery.ts`) answer it
 * the same way, rather than the table showing an equipped weapon's own
 * unequipped numbers while the editor shows the one actually firing.
 */
import {
  type UnitDerivedStats,
  type UnitEconomyInput,
  unitDerivedStats,
  type WeaponInput,
} from "./derivedStats";
import { libraryWeaponDef, type WeaponLibrary } from "./weaponLibrary";
import { weaponSlots } from "./weaponSlots";

/** A weapon slot's own `slaveTo` field, the unit's own weapon mount, which
 *  excludes a slaved weapon from the unit's summed DPS the same way
 *  `UnitPage.tsx`'s own reading of it does. */
function slavedExclude(
  table: Record<string, unknown> | undefined,
): "slaved" | undefined {
  if (!table) return undefined;
  const key = Object.keys(table).find((k) => k.toLowerCase() === "slaveto");
  const value = key ? table[key] : undefined;
  return typeof value === "number" && value !== 0 ? "slaved" : undefined;
}

/**
 * A unit's weapons as they actually fire, in slot order: a library weapon the
 * project has equipped into a slot stands in for the slot's own definition,
 * the same way `UnitPage.tsx`'s editor resolves one for display. `def` is the
 * unit's resolved definition (`resolvedDef`'s answer, overrides applied), the
 * same one every other reading of the unit on the page or the table works
 * from. `owners` is the unit's own key plus, for a copy, the unit it was
 * copied from (`weaponSlots.ts`'s `ownDefinitionKey`). `unitEquipped` is this
 * one unit's slice of the project's `equipped` store (`equipped[unitKey]`),
 * `undefined` when the project has equipped nothing on it.
 */
export function unitEffectiveWeapons(
  def: Record<string, unknown> | undefined,
  weaponDefs: Record<string, Record<string, unknown>>,
  owners: string[],
  library: WeaponLibrary,
  unitEquipped: Record<string, string> | undefined,
): WeaponInput[] {
  const slots = weaponSlots(def, weaponDefs, owners);
  return slots.flatMap((slot): WeaponInput[] => {
    const fires = unitEquipped?.[slot.step];
    const equippedWeapon = fires ? library[fires] : undefined;
    const weaponDef = equippedWeapon
      ? libraryWeaponDef(equippedWeapon)
      : slot.definition.kind === "missing"
        ? undefined
        : slot.definition.def;
    if (!weaponDef) return [];
    return [{ def: weaponDef, excludeFromSum: slavedExclude(slot.table) }];
  });
}

/**
 * A unit's derived combat and economy numbers (`derivedStats.ts`), off its
 * actually-firing weapons (`unitEffectiveWeapons`). The one place both the
 * unit editor and the reference table go for "what does this unit do", so an
 * equipped library weapon changes the answer in both.
 */
export function unitEffectiveDerivedStats(
  unit: UnitEconomyInput,
  weaponDefs: Record<string, Record<string, unknown>>,
  owners: string[],
  library: WeaponLibrary,
  unitEquipped: Record<string, string> | undefined,
): UnitDerivedStats {
  const weapons = unitEffectiveWeapons(
    unit.def,
    weaponDefs,
    owners,
    library,
    unitEquipped,
  );
  return unitDerivedStats(unit, weapons);
}
