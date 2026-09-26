/**
 * Derived combat and economy numbers for a unit (issue #2644): DPS, alpha
 * damage, cost per hit point, DPS per 100 metal, hit points per build second
 * and range per cost. Nobody argues about `reloadtime`. They argue about
 * these. One derivation, computed from the values the page already resolves
 * (game plus the project's overrides), so #1316's comparison table can import
 * it rather than growing a second copy of this arithmetic.
 *
 * Every formula is read off RecoilEngine, not remembered:
 *
 * - `rts/Sim/Weapons/Weapon.cpp` `CanFire`/`UpdateFire`: a weapon starts its
 *   next burst once `salvoLeft` has reached 0 *and* `reloadTime` has elapsed
 *   since the burst before started, so the time between one burst starting
 *   and the next is `max(reloadTime, burst * burstRate)`, not `reloadTime`
 *   alone.
 * - `rts/Sim/Weapons/WeaponDef.cpp` (`salvosize`/`salvodelay`, each
 *   `externalName`d to `burst`/`burstRate`): the two spellings name the same
 *   fields, `burst` and `salvosize`-era `salvoSize` are one thing.
 * - `rts/Sim/Weapons/WeaponDef.cpp` `WEAPONTAG(int, projectilespershot)
 *   .externalName("projectiles")`: one shot fires this many projectiles,
 *   each carrying the weapon's damage.
 * - `rts/Sim/Weapons/BeamLaser.cpp` `Init()`: a BeamLaser without
 *   `beamburst` throws its own `burst` and `burstRate` away
 *   (`salvoDelay = 0`) and fires once per `reloadTime`, spreading `damage`
 *   over `beamtime` with a multiplier that keeps the total at exactly
 *   `damage`. So a plain BeamLaser's burst is 1 regardless of what `burst`
 *   says, and `beamburst` is what turns `burst`/`burstRate` back on.
 * - `rts/Sim/Weapons/WeaponDef.cpp` (`paralyzer` tag): "does not cause
 *   damage in the form of lost hit-points", so a paralyzer's `damage` is
 *   stun and never health lost. DPS and alpha damage are not stated for one.
 * - `rts/Sim/Weapons/Weapon.cpp` `UpdateFire`/`UpdateStockpile`: a stockpile
 *   weapon is built up over `stockpileTime` rather than firing on a reload
 *   cycle, so it has no honest reload-based DPS either.
 * - `rts/Sim/Weapons/WeaponDef.cpp` "setup the default damages":
 *   `damage.default` defaults to 1, not 0, when a weapon sets no damage
 *   table at all.
 * - `rts/Sim/Weapons/WeaponDef.cpp` `WEAPONTAG(bool, manualfire)
 *   .externalName("commandfire")`: "does the weapon respond to the manual
 *   fire command instead of regular attack", so a manual-fire weapon (a
 *   commander's D-Gun is the usual example) never fires on its own during
 *   ordinary combat and is not a source of sustained DPS.
 * - `rts/Sim/Units/UnitDef.cpp` (`buildTime`, and `workerTime` read into
 *   `buildSpeed`) and `rts/Sim/Units/UnitTypes/Builder.cpp` (`buildSpeed =
 *   unitDef->buildSpeed / GAME_SPEED` applied every frame): completing a
 *   unit takes `buildTime / builderBuildPower` seconds, which means
 *   `buildTime` is already stated in seconds at a build power of 1. Hit
 *   points per build second is `health / buildTime` for any builder, not
 *   only one build power named here.
 *
 * A definition's own weapon mount can set `slaveTo`, firing this weapon only
 * alongside another (`weaponSlots.ts` reads it off the unit's `weapons.*`
 * table, not off the definition), so a slaved weapon is not an independent
 * source of sustained damage. Like a manual-fire weapon, it is left out of
 * the unit's summed DPS and alpha damage, though its own figures are still
 * computed for display: {@link WeaponInput.excludeFromSum} carries both
 * cases in from the caller, which is the one place that knows a slot's mount.
 *
 * A weapon with `weaponType` `"Shield"` deals no damage in the normal sense
 * at all: it is left out of every sum entirely, not merely excluded from it,
 * the same as a weapon nothing defines.
 *
 * Damage is read against the `default` entry of a weapon's `damage` table,
 * never a specific armour class. The strip describes one weapon in the
 * abstract, not a matchup against a chosen target, which is the question
 * #1316's comparison table answers instead. A weapon that deals a different
 * amount to some classes hits harder or softer against those than the number
 * shown here.
 */

/** A value inside a table, however it spells the key. */
function findKey(
  table: Record<string, unknown>,
  lower: string,
): string | undefined {
  return Object.keys(table).find((key) => key.toLowerCase() === lower);
}

/** A numeric field off a def, trying each spelling in turn and falling back
 *  to the next only when the field is absent, the way `readPath` callers in
 *  this workshop already read `health`/`maxDamage` and `metalCost`/
 *  `buildCostMetal` pairs. Exported so `unitReference.ts` (issue #1316) reads
 *  a unit's raw fields the same way this module does, rather than growing a
 *  second copy of the same fallback pairs. */
export function numberField(
  def: Record<string, unknown> | undefined,
  names: string[],
): number | undefined {
  if (!def) return undefined;
  for (const name of names) {
    const key = findKey(def, name.toLowerCase());
    if (key === undefined) continue;
    const value = def[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function stringField(
  def: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!def) return undefined;
  const key = findKey(def, name.toLowerCase());
  const value = key === undefined ? undefined : def[key];
  return typeof value === "string" ? value : undefined;
}

function boolField(
  def: Record<string, unknown> | undefined,
  name: string,
): boolean {
  if (!def) return false;
  const key = findKey(def, name.toLowerCase());
  return key !== undefined && def[key] === true;
}

/** The weapon's `damage` table, whichever case each key came in. */
function damageTable(
  def: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const key = findKey(def, "damage");
  const value = key === undefined ? undefined : def[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Damage against the `default` armour class, engine default 1 for a weapon
 *  with no `damage` table at all (`WeaponDef.cpp`, "setup the default
 *  damages"). */
function defaultDamage(def: Record<string, unknown>): number {
  const table = damageTable(def);
  const value = table ? numberField(table, ["default"]) : undefined;
  return value ?? 1;
}

/** One weapon a unit fires, as the page resolves it: the game's definition,
 *  a project's edit to it, or a library weapon it equips. */
export interface WeaponInput {
  /** The definition exactly as it will fire. */
  def: Record<string, unknown>;
  /** Why the mount excludes this weapon from a unit's summed DPS and alpha
   *  damage: `slaveTo` set on the unit's own `weapons.*` mount, or
   *  `manualfire` (the weapon's own `commandfire` field, read here from
   *  `def` when the caller has not already decided). `undefined` when
   *  nothing excludes it. The weapon's own figures are computed regardless. */
  excludeFromSum?: "slaved" | "manual";
}

/** Why a weapon's DPS and alpha damage are not stated at all, rather than
 *  merely excluded from a unit's sum. */
export type WeaponOmission = "shield" | "paralyzer" | "stockpile";

/** One weapon's derived numbers. */
export interface WeaponStats {
  /** `weaponType`, for a strip that wants to say what kind of weapon this is. */
  weaponType: string | undefined;
  /** Damage against the `default` armour class, per hit. */
  damage: number;
  /** Projectiles fired per shot. */
  projectiles: number;
  /** Shots fired per burst, corrected for a plain BeamLaser (see the module
   *  doc comment): 1 unless `beamburst` is set. */
  effectiveBurst: number;
  /** Seconds between the start of one burst and the next:
   *  `max(reloadTime, effectiveBurst * burstRate)`, or `reloadTime` alone for
   *  a plain BeamLaser, whose `burstRate` the engine also ignores. */
  cycleSeconds: number;
  /** Total damage in one burst, or `null` when {@link omitted} says why not. */
  alphaDamage: number | null;
  /** Damage per second, sustained across bursts, or `null` when {@link
   *  omitted} says why not. */
  dps: number | null;
  /** Why `dps`/`alphaDamage` are `null`, when they are. */
  omitted?: WeaponOmission;
  /** Why this weapon is left out of a unit's summed DPS and alpha damage,
   *  copied from {@link WeaponInput.excludeFromSum} or read off `def` for
   *  `manualfire` when the caller left it unset. Set even when `dps` is
   *  itself non-null, since the weapon's own number is still shown. */
  excludedFromSum?: "slaved" | "manual";
  /** Maximum targeting range, engine default 10 (`WeaponDef.cpp`). */
  range: number;
}

/** One weapon's derived numbers, read off its resolved definition. */
export function weaponStats(input: WeaponInput): WeaponStats {
  const { def } = input;
  const weaponType = stringField(def, "weaponType");
  const range = numberField(def, ["range"]) ?? 10;
  const reloadTime = numberField(def, ["reloadTime", "reload"]) ?? 1;
  const projectiles =
    numberField(def, ["projectiles", "projectilespershot"]) ?? 1;
  const damage = defaultDamage(def);

  const plainBeamLaser =
    weaponType === "BeamLaser" && !boolField(def, "beamburst");
  const burst = numberField(def, ["burst", "salvosize"]) ?? 1;
  const burstRate = numberField(def, ["burstRate", "salvodelay"]) ?? 0.1;
  const effectiveBurst = plainBeamLaser ? 1 : burst;
  const cycleSeconds = plainBeamLaser
    ? reloadTime
    : Math.max(reloadTime, effectiveBurst * burstRate);

  const shield = weaponType === "Shield";
  const paralyzer = boolField(def, "paralyzer");
  const stockpile = boolField(def, "stockpile");
  const omitted: WeaponOmission | undefined = shield
    ? "shield"
    : paralyzer
      ? "paralyzer"
      : stockpile
        ? "stockpile"
        : undefined;

  const manual = boolField(def, "manualfire") || boolField(def, "commandfire");
  const excludedFromSum =
    input.excludeFromSum ?? (manual ? "manual" : undefined);

  const perBurst = damage * projectiles * effectiveBurst;
  return {
    weaponType,
    damage,
    projectiles,
    effectiveBurst,
    cycleSeconds,
    alphaDamage: omitted ? null : perBurst,
    dps: omitted ? null : perBurst / cycleSeconds,
    omitted,
    excludedFromSum,
    range,
  };
}

/** The unit fields the strip needs. */
export interface UnitEconomyInput {
  def: Record<string, unknown> | undefined;
}

interface UnitEconomy {
  health?: number;
  metalCost?: number;
  buildTime?: number;
}

/** `health` falls back to the Total Annihilation spelling `maxDamage`, and
 *  `metalCost` falls back to `buildCostMetal`, matching `unitFieldNotes.ts`. */
function unitEconomy(def: Record<string, unknown> | undefined): UnitEconomy {
  return {
    health: numberField(def, ["health", "maxDamage"]),
    metalCost: numberField(def, ["metalCost", "buildCostMetal"]),
    buildTime: numberField(def, ["buildTime"]),
  };
}

/** A unit's derived numbers, and which of its weapons fed them. */
export interface UnitDerivedStats {
  /** Summed DPS across every weapon that fires on its own, or `null` when
   *  none does. */
  dps: number | null;
  /** Summed alpha damage across the same weapons, or `null` when none does. */
  alphaDamage: number | null;
  /** `metalCost / health`, or `null` when either is unknown or `health` is 0. */
  costPerHitPoint: number | null;
  /** `dps` scaled to a metal cost of 100, or `null` when `dps` is `null` or
   *  `metalCost` is unknown or 0. */
  dpsPer100Metal: number | null;
  /** `health / buildTime`, or `null` when either is unknown or `buildTime`
   *  is 0. See the module doc comment for why this needs no named builder. */
  hitPointsPerBuildSecond: number | null;
  /** The longest range among every weapon that has one (a shield does not),
   *  divided by `metalCost`, or `null` when there is no such weapon or
   *  `metalCost` is unknown or 0. Every weapon counts here, including one
   *  excluded from the DPS sum: a manual-fire or slaved weapon still
   *  threatens out to its range, even though it is not a sustained source of
   *  damage. */
  rangePerCost: number | null;
  /** Every weapon's own numbers, in the order given. */
  weapons: WeaponStats[];
  /** How many weapons fed the summed `dps`/`alphaDamage`. */
  weaponsSummed: number;
}

/**
 * Wording for what each derived number means, shared between
 * `DerivedStatsStrip.tsx`'s tiles and the reference table's column headers
 * (issue #3110), so both explain a stat the same way rather than growing two
 * descriptions of the same arithmetic. `dps` and `alphaDamage` carry a
 * per-unit exclusion note of their own (which weapons a unit's own tiles left
 * out), added by the strip on top of the base text here.
 */
export const DPS_HELP =
  "Damage per second against the default armour class, summed across every weapon that fires on its own. A weapon that deals different damage to some armour classes may hit harder or softer against them than this.";

export const ALPHA_DAMAGE_HELP =
  "Total damage in one burst from every weapon counted in DPS above. Sometimes called alpha damage.";

export const COST_PER_HIT_POINT_HELP =
  "Metal cost divided by hit points. Lower is a tankier unit for its cost.";

export const DPS_PER_100_METAL_HELP =
  "DPS scaled to a metal cost of 100, so units of different cost can be compared directly.";

export const HIT_POINTS_PER_BUILD_SECOND_HELP =
  "Hit points divided by build time. Build time is already stated in seconds at a build power of 1, so this holds for a builder of any speed.";

export const RANGE_PER_COST_HELP =
  "The longest range among the unit's weapons, divided by metal cost. Counts every weapon, including a manual-fire or slaved one: a threat range does not need a sustained rate of fire.";

/**
 * A unit's derived combat and economy numbers, from its resolved fields and
 * its resolved weapons. `weapons` is in slot order. A definition nothing
 * mounts (issue #2641's supporting definitions) has no business being handed
 * in, since nothing fires it.
 */
export function unitDerivedStats(
  unit: UnitEconomyInput,
  weapons: WeaponInput[],
): UnitDerivedStats {
  const economy = unitEconomy(unit.def);
  const stats = weapons.map(weaponStats);

  const summable = stats.filter(
    (w) => w.dps !== null && w.excludedFromSum === undefined,
  );
  const dps = summable.length
    ? summable.reduce((sum, w) => sum + (w.dps ?? 0), 0)
    : null;
  const alphaDamage = summable.length
    ? summable.reduce((sum, w) => sum + (w.alphaDamage ?? 0), 0)
    : null;

  const ranged = stats.filter((w) => w.weaponType !== "Shield");
  const maxRange = ranged.length
    ? Math.max(...ranged.map((w) => w.range))
    : null;

  const { health, metalCost, buildTime } = economy;
  const costPerHitPoint =
    metalCost !== undefined && health !== undefined && health > 0
      ? metalCost / health
      : null;
  const dpsPer100Metal =
    dps !== null && metalCost !== undefined && metalCost > 0
      ? (dps / metalCost) * 100
      : null;
  const hitPointsPerBuildSecond =
    health !== undefined && buildTime !== undefined && buildTime > 0
      ? health / buildTime
      : null;
  const rangePerCost =
    maxRange !== null && metalCost !== undefined && metalCost > 0
      ? maxRange / metalCost
      : null;

  return {
    dps,
    alphaDamage,
    costPerHitPoint,
    dpsPer100Metal,
    hitPointsPerBuildSecond,
    rangePerCost,
    weapons: stats,
    weaponsSummed: summable.length,
  };
}
