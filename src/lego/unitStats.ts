/**
 * The numbers the stats panel shows for a unit (issue #3293): cost, health,
 * speed, longest weapon range and damage per second. One function reads them
 * off any unit definition, so the unit being built and the game unit beside it
 * are measured the same way. Damage and range come from `unitDerivedStats`, so
 * a stat means here what it means on the workshop's unit page.
 *
 * The built unit's definition is the one the next export would write, except
 * for a field a re-export keeps because somebody changed it in the game's file
 * (issue #3245). For those the file's value is the unit's value.
 */

import { t } from "@lingui/core/macro";
import {
  numberField,
  unitDerivedStats,
  type WeaponInput,
  weaponStats,
} from "@/workshop/derivedStats";
import { weaponSlots } from "@/workshop/weaponSlots";
import { withValue } from "./reexport";
import { DERIVED_FIELDS, defValue } from "./unitDef";

export const STATS = [
  {
    id: "cost",
    get label() {
      return t`Cost`;
    },
  },
  {
    id: "health",
    get label() {
      return t`Health`;
    },
  },
  {
    id: "speed",
    get label() {
      return t`Speed`;
    },
  },
  {
    id: "range",
    get label() {
      return t`Range`;
    },
  },
  {
    id: "dps",
    get label() {
      return t`DPS`;
    },
  },
] as const;

export type StatId = (typeof STATS)[number]["id"];

/** Each stat, or null where the unit has none. */
export type UnitStats = Record<StatId, number | null>;

/** The stats of `def`, given the weapons it fires. */
export function unitStats(
  def: Record<string, unknown> | undefined,
  weapons: WeaponInput[],
): UnitStats {
  const derived = unitDerivedStats({ def }, weapons);
  const ranges = derived.weapons
    .filter((weapon) => weapon.weaponType !== "Shield")
    .map((weapon) => weapon.range);
  return {
    cost: numberField(def, ["metalCost", "buildCostMetal"]) ?? null,
    health: numberField(def, ["health", "maxDamage"]) ?? null,
    speed: numberField(def, ["speed"]) ?? null,
    range: ranges.length > 0 ? Math.max(...ranges) : null,
    dps: derived.dps,
  };
}

/**
 * Where each stat is on the workshop's unit page, as a field path in the unit's
 * entry in the game, or null where there is no field to open (the unit has
 * nothing for that stat). The keys are spelled the way the file has them.
 * Range and damage live in a weapon, so they open the slot that sets them.
 */
export function statFields(
  file: Record<string, unknown>,
  weaponDefs: Record<string, Record<string, unknown>>,
  unitKey: string,
): Record<StatId, string | null> {
  const spelled = (names: string[]): string | null => {
    for (const name of names) {
      const key = Object.keys(file).find(
        (k) => k.toLowerCase() === name.toLowerCase(),
      );
      if (key !== undefined) return key;
    }
    return null;
  };
  const slots = weaponSlots(file, weaponDefs, [unitKey]).flatMap((slot) =>
    slot.definition.kind === "missing"
      ? []
      : [{ slot, stats: weaponStats({ def: slot.definition.def }) }],
  );
  const longest = slots
    .filter(({ stats }) => stats.weaponType !== "Shield")
    .reduce<(typeof slots)[number] | undefined>(
      (best, entry) =>
        !best || entry.stats.range > best.stats.range ? entry : best,
      undefined,
    );
  const firing = slots.find(
    ({ stats }) => stats.dps !== null && stats.excludedFromSum === undefined,
  );
  return {
    cost: spelled(["metalCost", "buildCostMetal"]),
    health: spelled(["health", "maxDamage"]),
    speed: spelled(["speed"]),
    range: longest
      ? longest.slot.definition.kind === "own"
        ? `${longest.slot.definition.path}.range`
        : `${longest.slot.path}.name`
      : null,
    dps: firing ? `${firing.slot.path}.name` : null,
  };
}

/** A value for comparing, with the spellings the engine treats as one thing
 *  made one: key case, and a list against a table keyed 1, 2, 3. */
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 0 && entries.every(([key]) => /^\d+$/.test(key))) {
    return entries
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, entry]) => comparable(entry));
  }
  return entries
    .map(([key, entry]) => [key.toLowerCase(), comparable(entry)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

/** The value at a dotted `path`, with each key read in any case, as the
 *  engine's lower-cased tables are. */
export function fileValue(def: Record<string, unknown>, path: string): unknown {
  let at: unknown = def;
  for (const key of path.split(".")) {
    if (typeof at !== "object" || at === null) return undefined;
    const table = at as Record<string, unknown>;
    const found = Object.keys(table).find(
      (k) => k.toLowerCase() === key.toLowerCase(),
    );
    if (found === undefined) return undefined;
    at = table[found];
  }
  return at;
}

/**
 * `next`, the definition the next export would write, with the file's value
 * for every derived field a re-export would keep. `file` is the unit's entry in
 * the game and `last` is what the last export wrote there. A field is kept when
 * the file holds neither what the last export wrote nor what the next one will,
 * which is the test `reexport.rs` applies. A `last` of null means nothing
 * records the builder writing the file, so the whole file stays and every
 * derived field is the file's.
 */
export function withKeptFields(
  next: Record<string, unknown>,
  file: Record<string, unknown> | undefined,
  last: Record<string, unknown> | null | undefined,
): { def: Record<string, unknown>; kept: string[] } {
  if (!file || last === undefined) return { def: next, kept: [] };
  let def = next;
  const kept: string[] = [];
  for (const path of DERIVED_FIELDS) {
    const found = fileValue(file, path);
    if (sameValue(found, defValue(next, path))) continue;
    if (last !== null && sameValue(found, defValue(last, path))) continue;
    def = withValue(def, path, found);
    kept.push(path);
  }
  return { def, kept };
}
