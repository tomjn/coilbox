/**
 * How far each weapon reaches and which way it can fire, as the engine tests
 * it (issue #3295). The viewport draws this, and the preview uses the same
 * test to stop aiming where the engine would (#4134).
 *
 * Read in `~/dev/RecoilEngine`:
 *
 * - `CWeapon::TestRange` (`rts/Sim/Weapons/Weapon.cpp:1106-1128`) measures
 *   from `aimFromPos`, the position of the piece `AimFromWeapon<n>` returns
 *   (`UpdateWeaponVectors`, `Weapon.cpp:282-297`). The distance is 2D, and the
 *   range it is compared with shrinks with the height difference, or is a
 *   cylinder for a unit target when `cylinderTargeting` is set.
 * - The arc test is `CheckTargetAngleConstraint` (`Weapon.cpp:886-907`), on
 *   the 3D direction to the target. A turret checks it against the slot's
 *   `mainDir` turned into the world, with `maxAngleDif` stored as the cosine
 *   of half its width (`UnitDef.cpp:38-50`). A weapon with `turret = false`
 *   checks the unit's own front instead, against `tolerance`
 *   (`WeaponLoader.cpp:175-178`, `WeaponDef.cpp:572`).
 */

import { weaponSlots } from "@/workshop/weaponSlots";
import type { LegoProject, LegoWeaponRef } from "./model";
import type { Vec3 } from "./snapping";
import { arcFields, mountedWeapons, slotTarget } from "./weaponModule";

/** `COBSCALE_HALF`: `tolerance` is in the 16-bit angle unit, half a turn
 *  being 32768 (`TAANG2RAD`, `CobInstance.h:25`). */
const TA_HALF_TURN = 32768;

/** How a weapon's range changes with the height of its target. */
export type RangeKind =
  /** `CWeapon::GetRange2D`: the range is the hypotenuse, so a target above
   *  or below is reached less far out. */
  | "sphere"
  /** `CStarburstLauncher::GetRange2D`: the range grows with height. */
  | "starburst"
  /** `CCannon::GetRange2D`: the range follows from the shell's speed and
   *  gravity, see {@link cannonRange2D}. */
  | "ballistic";

/** Which directions a weapon can fire in. */
export type WeaponArc =
  /** No arc test at all, the engine's default `maxAngleDif` of 360. */
  | { kind: "full" }
  /**
   * A turret: the direction to the target, dotted with `dir` turned into the
   * world, must be at least `minDot`. `dir` is the slot's `mainDir` in the
   * unit's own space, normalised, x being `rightdir`.
   */
  | { kind: "mainDir"; dir: Vec3; minDot: number }
  /** A weapon with `turret = false`: the same test against the unit's front. */
  | { kind: "forward"; minDot: number };

/** What a cannon's reach is worked out from, in the engine's own units. */
export interface BallisticShell {
  /** `projectilespeed`, in elmos per frame: `weaponVelocity` / 30. */
  speed: number;
  /** Per frame squared, negative for a fall. */
  gravity: number;
  /** `heightBoostFactor`, -1 meaning the engine works it out. */
  heightBoostFactor: number;
}

/** One weapon's range and arc. */
export interface WeaponReach {
  /** `n` in `AimWeapon<n>`, counting from 1. */
  number: number;
  /** The weapon's name, as its slot gives it. */
  name: string;
  /** `range`, in elmos. The engine's default is 10 (`WeaponDef.cpp:106`). */
  range: number;
  rangeKind: RangeKind;
  /** Set for a cannon. Without it a ballistic weapon reaches its range. */
  shell?: BallisticShell;
  heightMod: number;
  cylinderTargeting: number;
  /** The piece `AimFromWeapon<n>` names, null when it names none. */
  aimFrom: string | null;
  arc: WeaponArc;
}

/** What one weapon is made from: its slot and its definition. */
export interface ReachSource {
  number: number;
  name: string;
  /** The weapon definition. */
  def: Record<string, unknown>;
  /** The slot's own table in `weapons`, where `mainDir` and `maxAngleDif`
   *  live. Absent for a slot written as a bare name. */
  slot: Record<string, unknown> | undefined;
  aimFrom: string | null;
}

/** `GAME_SPEED` (`GlobalConstants.h:52`), simulation frames per second. */
const GAME_SPEED = 30;

/** The map's default gravity in elmos per second squared
 *  (`MapInfo.cpp:101`, `topTable.GetFloat("gravity", 130.0f)`). The builder
 *  has no map, so a cannon is worked out on this. */
export const DEFAULT_MAP_GRAVITY = 130;

/** Sine and cosine of 45 degrees, as `GetStaticRange2D` writes them
 *  (`Cannon.cpp:256`). */
const CANNON_SPEED_FACTOR = 0.7071067;

/** Below this far under the shooter the height boost applies whole
 *  (`Cannon.cpp:232`). */
const CANNON_SMOOTH_HEIGHT = 100;

/**
 * `CCannon::GetStaticRange2D` (`Cannon.cpp:226-269`) with the range boost
 * factor worked out from scratch, as `CCannon::UpdateRange` does
 * (`Cannon.cpp:48-56`). `ydiff` is the height of the target above the shooter,
 * already scaled by `heightMod`.
 *
 * The range boost factor is the stated range over what the shell reaches on
 * level ground, capped at 1, so a shell too slow for its range falls short.
 * Firing downhill is boosted by the height boost factor, which is
 * `(2 - rangeBoostFactor) / sqrt(rangeBoostFactor)` unless the def gives one.
 */
export function cannonRange2D(
  range: number,
  ydiff: number,
  { speed, gravity, heightBoostFactor }: BallisticShell,
): number {
  const speed2D = speed * CANNON_SPEED_FACTOR;
  const sqSpeed2D = speed2D * speed2D;
  const calc = (
    heightDiff: number,
    rangeBoost: number,
    heightBoost: number,
  ) => {
    let diff = heightDiff;
    if (diff < -CANNON_SMOOTH_HEIGHT) {
      diff *= heightBoost;
    } else if (diff < 0) {
      diff *= 1 + ((heightBoost - 1) * -diff) / CANNON_SMOOTH_HEIGHT;
    }
    const root = sqSpeed2D + 2 * gravity * diff;
    if (root < 0) return 0;
    return (rangeBoost * (sqSpeed2D + speed2D * Math.sqrt(root))) / -gravity;
  };
  const levelRange = calc(0, 1, heightBoostFactor);
  const rangeBoost = Math.min(Math.max(range / levelRange, 0), 1);
  let heightBoost = heightBoostFactor;
  if (heightBoost < 0 && rangeBoost > 0)
    heightBoost = (2 - rangeBoost) / Math.sqrt(rangeBoost);
  return calc(ydiff, rangeBoost, heightBoost);
}

/** A key read whichever case it came in, as the engine's lower-cased
 *  tables are. */
function field(
  table: Record<string, unknown> | undefined,
  ...names: string[]
): unknown {
  if (!table) return undefined;
  for (const name of names) {
    const lower = name.toLowerCase();
    const key = Object.keys(table).find((k) => k.toLowerCase() === lower);
    if (key !== undefined) return table[key];
  }
  return undefined;
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** `LuaTable::GetBool`: a boolean, a number other than zero, or a string
 *  that reads as one. */
function boolOf(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text === "true" || (text !== "" && Number(text) !== 0);
  }
  return false;
}

/** `ParseFloat3` (`LuaParser.cpp:1415-1431`): a table of three numbers, or
 *  a string of three separated by spaces. */
function float3Of(value: unknown): Vec3 | undefined {
  if (Array.isArray(value) && value.length >= 3) {
    const parts = value.slice(0, 3).map(numberOf);
    if (parts.every((n) => n !== undefined)) return parts as Vec3;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const table = value as Record<string, unknown>;
    const parts = ["1", "2", "3"].map((k) => numberOf(table[k]));
    if (parts.every((n) => n !== undefined)) return parts as Vec3;
  }
  if (typeof value === "string") {
    const parts = value.trim().split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite))
      return [parts[0], parts[1], parts[2]];
  }
  return undefined;
}

/** `float3::SafeNormalize`: a zero vector stays zero. */
function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : v;
}

/**
 * The arc out of a slot and its definition.
 *
 * `onlyForward` is `!turret` unless the weapon is a starburst launcher
 * (`WeaponDef.cpp:572`). A forward weapon tests `tolerance`, default 3000,
 * as a half width. A turret tests `maxAngleDif`, a full width in degrees,
 * default 360. The engine skips the test when the cosine is -1, which only
 * 360 gives.
 */
export function weaponArc(
  def: Record<string, unknown>,
  slot: Record<string, unknown> | undefined,
): WeaponArc {
  const type = String(field(def, "weaponType") ?? "Cannon");
  const turret = boolOf(field(def, "turret"));
  if (!turret && type !== "StarburstLauncher") {
    const tolerance = numberOf(field(def, "tolerance")) ?? 3000;
    return {
      kind: "forward",
      minDot: Math.cos((tolerance * Math.PI) / TA_HALF_TURN),
    };
  }
  const width = numberOf(field(slot, "maxAngleDif")) ?? 360;
  const minDot = Math.cos((width * 0.5 * Math.PI) / 180);
  if (!(minDot > -1)) return { kind: "full" };
  const dir = normalise(float3Of(field(slot, "mainDir")) ?? [0, 0, 1]);
  return { kind: "mainDir", dir, minDot };
}

/**
 * The shell of a cannon. `projectilespeed` is `weaponVelocity` (or
 * `maxVelocity`) per second, divided by 30 and held to at least 0.01
 * (`WeaponDef.cpp:76`, `DefinitionTag.h:128-132`). `Cannon::Init`
 * (`Cannon.cpp:35`) takes `-myGravity` when it is not 0 and the map's gravity
 * otherwise, which is `-gravity / 30^2` (`MapInfo.cpp:103`).
 */
function shellOf(def: Record<string, unknown>): BallisticShell {
  const velocity = numberOf(field(def, "weaponVelocity", "maxVelocity")) ?? 0;
  const myGravity = numberOf(field(def, "myGravity")) ?? 0;
  return {
    speed: Math.max(velocity / GAME_SPEED, 0.01),
    gravity:
      myGravity !== 0
        ? -myGravity
        : -DEFAULT_MAP_GRAVITY / (GAME_SPEED * GAME_SPEED),
    heightBoostFactor: numberOf(field(def, "heightBoostFactor")) ?? -1,
  };
}

/** One weapon's reach, from its slot and definition. */
export function weaponReach(source: ReachSource): WeaponReach {
  const { def } = source;
  const type = String(field(def, "weaponType") ?? "Cannon");
  // `heightMod` and `cylinderTargeting` defaults depend on the weapon type
  // (`WeaponDef.cpp:107,109,381-398`).
  const heightModDefault =
    type === "Cannon"
      ? 0.8
      : type === "BeamLaser" || type === "LightningCannon"
        ? 1
        : 0.2;
  const cylinder = numberOf(
    field(def, "cylinderTargeting", "cylinderTargetting"),
  );
  return {
    number: source.number,
    name: source.name,
    range: numberOf(field(def, "range")) ?? 10,
    rangeKind:
      type === "Cannon"
        ? "ballistic"
        : type === "StarburstLauncher"
          ? "starburst"
          : "sphere",
    ...(type === "Cannon" ? { shell: shellOf(def) } : {}),
    heightMod: numberOf(field(def, "heightMod")) ?? heightModDefault,
    cylinderTargeting: Math.min(
      Math.max(cylinder ?? (type === "Melee" ? 1 : 0), 0),
      128,
    ),
    aimFrom: source.aimFrom,
    arc: weaponArc(def, source.slot),
  };
}

/**
 * Every weapon of a unit that has a definition to read, in slot order.
 *
 * The weapons picked in the builder when there are any, since those are what
 * an export writes, each slot built the way `weaponExportPlan` builds it.
 * Otherwise the `weapons` table of the definition the unit was opened with.
 * `defOf` finds a picked weapon's definition, `shared` is the game's weapon
 * table, and `aimFromOf` names the piece `AimFromWeapon<n>` returns, given
 * the piece the weapon is mounted on when it is a picked one.
 */
export function unitReaches(
  project: LegoProject,
  defOf: (fires: LegoWeaponRef) => Record<string, unknown> | null,
  shared: Record<string, Record<string, unknown>>,
  aimFromOf: (number: number, mountedOn: string | null) => string | null,
): WeaponReach[] {
  const mounted = mountedWeapons(project);
  if (mounted.length > 0) {
    return mounted.flatMap(({ piece, weapon, fires }, index) => {
      const def = defOf(fires);
      if (!def) return [];
      const number = index + 1;
      return [
        weaponReach({
          number,
          name: slotTarget(project.unitName, fires).name,
          def,
          slot: arcFields(weapon),
          aimFrom: aimFromOf(number, piece.name),
        }),
      ];
    });
  }
  return weaponSlots(project.gameUnitDef, shared, [project.unitName]).flatMap(
    (slot) =>
      slot.definition.kind === "missing"
        ? []
        : [
            weaponReach({
              number: slot.number,
              name: slot.name,
              def: slot.definition.def,
              slot: slot.table,
              aimFrom: aimFromOf(slot.number, null),
            }),
          ],
  );
}

/** What a weapon is aimed at: a unit, or a place on the ground. */
export type TargetKind = "unit" | "ground";

/**
 * How far out, in 2D, the weapon reaches a target `heightDiff` above its
 * aim-from piece. Zero when it cannot reach that height at all.
 *
 * `TestRange` with `GetRange2D(0, heightDiff * heightMod)`: a ground target,
 * or a weapon whose `cylinderTargeting` is below 0.01, is tested in a sphere.
 * Otherwise a unit target is reached at the full range while it is within the
 * cylinder's height, and not at all past it.
 */
export function rangeAt(
  reach: WeaponReach,
  heightDiff: number,
  target: TargetKind = "unit",
): number {
  const { range, heightMod, cylinderTargeting } = reach;
  if (target === "unit" && cylinderTargeting >= 0.01) {
    return cylinderTargeting * range > Math.abs(heightDiff) * heightMod
      ? range
      : 0;
  }
  const ydiff = heightDiff * heightMod;
  if (reach.rangeKind === "starburst") return range + ydiff * heightMod;
  if (reach.rangeKind === "ballistic")
    return reach.shell ? cannonRange2D(range, ydiff, reach.shell) : range;
  return Math.sqrt(Math.max(range * range - ydiff * ydiff, 0));
}

/** A unit's axes in the world: `rightdir`, `updir` and `frontdir`. */
export interface UnitAxes {
  right: Vec3;
  up: Vec3;
  front: Vec3;
}

/** A level unit at heading zero: `rightdir` is `(-1,0,0)`, so the model's
 *  own x is the unit's left (see `basisOf` in `aimResolver.ts`). */
export const LEVEL_AXES: UnitAxes = {
  right: [-1, 0, 0],
  up: [0, 1, 0],
  front: [0, 0, 1],
};

/** `GetObjectSpaceVec`, `SolidObject.h:232`. */
function objectSpaceVec(v: Vec3, { right, up, front }: UnitAxes): Vec3 {
  return [
    front[0] * v[2] + right[0] * v[0] + up[0] * v[1],
    front[1] * v[2] + right[1] * v[0] + up[1] * v[1],
    front[2] * v[2] + right[2] * v[0] + up[2] * v[1],
  ];
}

/** The world direction the arc is centred on, and the cosine it is held to,
 *  or null for a weapon with no arc test. */
export function arcAxis(
  arc: WeaponArc,
  axes: UnitAxes = LEVEL_AXES,
): { dir: Vec3; minDot: number } | null {
  if (arc.kind === "full") return null;
  if (arc.kind === "forward") {
    // The engine skips the forward test at -1 too (`Weapon.cpp:894`).
    return arc.minDot > -1 ? { dir: axes.front, minDot: arc.minDot } : null;
  }
  return { dir: objectSpaceVec(arc.dir, axes), minDot: arc.minDot };
}

/**
 * Where the weapon measures from, in the unit's own space.
 *
 * The aim-from piece where it rests, or the unit's origin when the script
 * names none. A piece below the ground is moved to 10 elmos above the unit's
 * origin, as `UpdateWeaponVectors` does for a pop-up weapon
 * (`Weapon.cpp:293-296`). The ground here is the flat y = 0.
 */
export function aimFromPosition(
  reach: WeaponReach,
  rest: Map<string, Vec3>,
): Vec3 {
  const at = (reach.aimFrom && rest.get(reach.aimFrom)) || [0, 0, 0];
  return at[1] < 0 ? [0, 10, 0] : at;
}

/**
 * Why the engine's `TestRange` would refuse a target, or null when it would
 * not. `from` is the aim-from position and `to` the target, both in the world.
 * `axes` are the unit's own, for a unit that has turned or tilted.
 */
export function outOfReach(
  reach: WeaponReach,
  from: Vec3,
  to: Vec3,
  target: TargetKind = "unit",
  axes: UnitAxes = LEVEL_AXES,
): "range" | "arc" | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const limit = rangeAt(reach, dy, target);
  if (dx * dx + dz * dz > limit * limit) return "range";
  const axis = arcAxis(reach.arc, axes);
  if (!axis) return null;
  const dir = normalise([dx, dy, dz]);
  // `CheckTargetAngleConstraint` passes a degenerate direction.
  if (dir[0] === 0 && dir[1] === 0 && dir[2] === 0) return null;
  const dot =
    dir[0] * axis.dir[0] + dir[1] * axis.dir[1] + dir[2] * axis.dir[2];
  return dot < axis.minDot ? "arc" : null;
}

/**
 * The arc as it covers targets level with the aim-from piece, for drawing on
 * the ground: the heading of its middle, in radians from the unit's front
 * (+z) towards +x, and its half width. Null for a full circle. A half width of
 * zero means the weapon can fire at no level target at all.
 *
 * A level direction `d` at heading `a` dots with the axis as `h cos(a - c)`,
 * `h` being the length of the axis's level part and `c` its heading, so the
 * arc is every `a` with `cos(a - c) >= minDot / h`.
 */
export function levelArc(
  arc: WeaponArc,
  axes: UnitAxes = LEVEL_AXES,
): { centre: number; half: number } | null {
  const axis = arcAxis(arc, axes);
  if (!axis) return null;
  const level = Math.hypot(axis.dir[0], axis.dir[2]);
  if (level === 0) return axis.minDot <= 0 ? null : { centre: 0, half: 0 };
  const ratio = axis.minDot / level;
  if (ratio <= -1) return null;
  return {
    centre: Math.atan2(axis.dir[0], axis.dir[2]),
    half: ratio >= 1 ? 0 : Math.acos(ratio),
  };
}
