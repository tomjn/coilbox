/**
 * The movement classes a game declares, so the field is picked rather than
 * typed (issue #2651).
 *
 * A movement class names an entry in the game's own move definitions, and the
 * engine drops a unit whose `canMove` is set and whose class does not resolve.
 * That failure is the reason the lego builder writes `canmove = false` and
 * leaves the class out: it is a game-independent tool with nothing to name.
 * From here there is a game, so there is something to name, and a list is the
 * only honest way to offer it. Typing a class is guessing at another file's
 * spelling, and the only report you get is a unit that is not in the game.
 *
 * The workshop's picker reads them off the game's own units rather than out of
 * `gamedata/movedefs.lua`. The unit-defs read carries that file's classes too
 * now (`moveDefsOf`, which the unit builder uses, issue #3255), but the unit
 * table costs one pass over something already in memory. It is also the
 * stronger guarantee of the two: a class some unit in this game already moves
 * on is one the engine has resolved, where a class declared in a file may be
 * declared and unreachable. What it misses is a class no unit uses, which is a
 * class nothing can vouch for, and the field stays typeable for anyone who
 * knows one is there.
 *
 * Keys arrive lowercased from `gamedata/defs.lua`, so the read is case
 * insensitive the way every other field lookup in the workshop is. Values are
 * not: a class name is matched against the move definitions by whatever the
 * game wrote, and folding its case here would offer a name the engine may not
 * accept.
 */
import { t } from "@lingui/core/macro";

/** One class, and how much of the game is already using it. */
export interface MoveClass {
  /** The name, exactly as the game's units spell it. */
  name: string;
  /** How many units in the game declare it. */
  units: number;
}

/** A def's value for `key`, whatever case the game wrote the key in. */
export function field(
  def: Record<string, unknown> | undefined,
  key: string,
): unknown {
  if (!def) return undefined;
  for (const [k, value] of Object.entries(def)) {
    if (k.toLowerCase() === key) return value;
  }
  return undefined;
}

/**
 * A unit definition's flag, as the engine reads one.
 *
 * `true`, `1` and `"1"` all reach here: a game writes Lua booleans in some
 * files and the numbers it inherited from a `.fbi` in others, and the engine's
 * own `GetBool` takes either.
 */
export function flag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text === "true" || text === "1";
  }
  return false;
}

/**
 * Whether the movement class is a field worth showing for this unit.
 *
 * A definition that says anything at all about moving, either way, is one whose
 * class is a live question, and a unit that has never mentioned it is a
 * building nobody is going to drive. The distinction matters because the
 * relevant view otherwise hides a field the definition does not declare, and
 * for this field not being declared is the whole problem: a unit built in the
 * lego builder arrives with `canmove = false` and no class at all, and hiding
 * the class would hide the one edit that turns it into a unit somebody can
 * drive (issues #663 and #2651).
 */
export function asksAboutMovement(
  def: Record<string, unknown> | undefined,
): boolean {
  if (flag(field(def, "canfly"))) return false;
  return (
    field(def, "canmove") !== undefined ||
    field(def, "movementclass") !== undefined
  );
}

/**
 * What is wrong with this unit's movement, said where the class is picked.
 *
 * Both halves have to agree or the unit is not the unit somebody meant, and
 * neither says so anywhere a person would see. A moving unit with no class is
 * dropped at load by `UnitDefHandler`, which is the failure #663 recorded, and
 * a class on a unit that does not move is a field with no effect, which is
 * quieter and just as wrong. A flier resolves neither against the move
 * definitions, so it is asked about neither.
 */
export function moveClassProblem(
  def: Record<string, unknown> | undefined,
): string | undefined {
  if (flag(field(def, "canfly"))) return undefined;
  const moves = flag(field(def, "canmove"));
  const named = moveClassOf(def) !== "";
  if (moves && !named)
    return t`This unit moves but names no movement class, so the engine drops it at load. Pick one.`;
  if (named && !moves)
    return t`This unit does not move, so the class has no effect until Can move is on.`;
  return undefined;
}

/** Whatever a def calls its movement class, or nothing. */
export function moveClassOf(def: Record<string, unknown> | undefined): string {
  const value = field(def, "movementclass");
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The engine's four kinds of ground movement, in the order of
 * `MoveDef::SpeedModClass` in RecoilEngine's `rts/Sim/MoveTypes/MoveDefHandler.h`
 * (Tank 0, KBot 1, Hover 2, Ship 3). A tank is any wheeled or tracked vehicle
 * and a kbot is a walker.
 */
export type MoveKind = "tank" | "kbot" | "hover" | "ship";

const SPEED_MOD_CLASSES: MoveKind[] = ["tank", "kbot", "hover", "ship"];

/** One class out of the game's `gamedata/movedefs.lua`. */
export interface GameMoveClass {
  /** The name, as the game spells it. The engine matches it case blind. */
  name: string;
  kind: MoveKind;
  /** `footprintx`, the width of ground the class paths with, in steps. */
  footprint: number;
  /** `maxSlope` as the game wrote it, in degrees. Absent when the class does
   *  not set one, which leaves the kind's default. */
  maxSlope?: number;
}

/**
 * The kind of one move definition, by the engine's own rule.
 *
 * `ParseSpeedModClass` in `rts/Sim/MoveTypes/MoveDefHandler.cpp` takes a
 * `speedModClass` when the definition has one, clamped into the four kinds.
 * Otherwise it looks for "boat" or "ship", then "hover", then "tank" in the
 * name, which the engine has lowercased by then, and anything else walks. So
 * Splinter Faction's `WALKERTANK3` is a tank to the engine, whatever its name
 * says.
 */
export function moveDefKind(def: Record<string, unknown>): MoveKind {
  const raw = field(def, "speedmodclass");
  const number = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof number === "number" && Number.isFinite(number)) {
    const index = Math.trunc(number);
    if (index !== -1) {
      return SPEED_MOD_CLASSES[Math.min(3, Math.max(0, index))];
    }
  }
  const name = String(field(def, "name") ?? "").toLowerCase();
  if (name.includes("boat") || name.includes("ship")) return "ship";
  if (name.includes("hover")) return "hover";
  if (name.includes("tank")) return "tank";
  return "kbot";
}

/**
 * The classes a game declares, from the `moveDefs` list the unit-defs read
 * carries. A definition with no name is left out, because no unit can name it.
 * `footprintx` defaults to 1 the way `MoveDef`'s constructor reads it.
 */
export function moveDefsOf(moveDefs: unknown[]): GameMoveClass[] {
  const out: GameMoveClass[] = [];
  for (const entry of moveDefs) {
    if (typeof entry !== "object" || entry === null) continue;
    const def = entry as Record<string, unknown>;
    const name = field(def, "name");
    if (typeof name !== "string" || name.trim() === "") continue;
    const footprint = Number(field(def, "footprintx"));
    const rawSlope = field(def, "maxslope");
    const maxSlope =
      typeof rawSlope === "string" && rawSlope.trim() === ""
        ? Number.NaN
        : Number(rawSlope);
    out.push({
      name: name.trim(),
      kind: moveDefKind(def),
      footprint: Number.isFinite(footprint) ? Math.max(1, footprint) : 1,
      ...(rawSlope !== undefined &&
      rawSlope !== null &&
      Number.isFinite(maxSlope)
        ? { maxSlope }
        : {}),
    });
  }
  return out;
}

/**
 * The `maxSlope` a class gets when its definition sets none, from
 * `MoveDefHandler.cpp` lines 233 (tank and kbot, 60) and 238 (hover, 15). A
 * ship has none (line 243).
 */
export const DEFAULT_MAX_SLOPE: Record<MoveKind, number | null> = {
  tank: 60,
  kbot: 60,
  hover: 15,
  ship: null,
};

/** The most a `maxSlope` can say, in degrees: the clamp in `DegreesToMaxSlope`
 *  (`MoveDefHandler.cpp:91`). */
export const MAX_SLOPE_LIMIT = 60;

/**
 * The steepest ground a class climbs, in degrees from level, or null for a ship.
 *
 * `DegreesToMaxSlope` (`MoveDefHandler.cpp:84`) clamps `maxSlope` to 0 to 60
 * and multiplies it by 1.5 before the engine compares it with the ground, so
 * `maxSlope = 15` climbs 22.5 degrees and the most any class climbs is 90.
 * Ground steeper than the limit is blocked (`slope > maxSlope`,
 * `GroundMoveMath.cpp:18`), so ground exactly at the limit is climbed.
 */
export function climbableDegrees(
  move: Pick<GameMoveClass, "kind" | "maxSlope">,
): number | null {
  const fallback = DEFAULT_MAX_SLOPE[move.kind];
  if (fallback === null) return null;
  const set = move.maxSlope ?? fallback;
  return Math.min(MAX_SLOPE_LIMIT, Math.max(0, set)) * 1.5;
}

/**
 * A unit's top speed in elmos a second, the way `UnitDef.cpp` reads it: `speed`,
 * or else the older `maxVelocity`, which is in elmos a frame at 30 frames a
 * second.
 */
export function unitSpeedOf(def: Record<string, unknown> | undefined): number {
  const speed = Number(field(def, "speed"));
  if (Number.isFinite(speed)) return speed;
  const legacy = Number(field(def, "maxvelocity"));
  return Number.isFinite(legacy) ? Math.abs(legacy) * 30 : 0;
}

/**
 * Whether the engine gives this unit a move class at all:
 * `UnitDef::RequireMoveDef` is `canmove && speed > 0 && !canfly`.
 */
export function requiresMoveDef(
  def: Record<string, unknown> | undefined,
): boolean {
  return (
    flag(field(def, "canmove")) &&
    unitSpeedOf(def) > 0 &&
    !flag(field(def, "canfly"))
  );
}

/**
 * A def's reverse speed in elmos a second, read as `UnitDef.cpp:447-448` does:
 * `rSpeed`, else the older `maxReverseVelocity`, which is per frame. 0 for a
 * unit that states neither, and the engine will not reverse it.
 */
export function unitReverseSpeedOf(
  def: Record<string, unknown> | undefined,
): number {
  const speed = Number(field(def, "rspeed"));
  if (field(def, "rspeed") !== undefined && Number.isFinite(speed))
    return speed;
  const legacy = Number(field(def, "maxreversevelocity"));
  return Number.isFinite(legacy) ? Math.abs(legacy) * 30 : 0;
}

/** A def's `turnrate`, or nothing when it states none. */
export function unitTurnRateOf(
  def: Record<string, unknown> | undefined,
): number | undefined {
  const value = Number(field(def, "turnrate"));
  return Number.isFinite(value) ? value : undefined;
}

/**
 * A def's acceleration in elmos a frame squared, read as `UnitDef.cpp` does:
 * `maxAcc`, else `acceleration`. Nothing when it states neither, or states a
 * negative, which the engine throws the unit away for.
 */
export function unitAccelerationOf(
  def: Record<string, unknown> | undefined,
): number | undefined {
  return (
    nonNegative(field(def, "maxacc")) ?? nonNegative(field(def, "acceleration"))
  );
}

/**
 * A def's brake rate in elmos a frame squared: `maxDec`, else `brakeRate`.
 * Nothing when it states neither. The engine then brakes at the unit's
 * acceleration, which is not a number this def wrote.
 */
export function unitBrakeRateOf(
  def: Record<string, unknown> | undefined,
): number | undefined {
  return (
    nonNegative(field(def, "maxdec")) ?? nonNegative(field(def, "brakerate"))
  );
}

function nonNegative(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

/**
 * Every movement class the game's units name, commonest first and then
 * alphabetically.
 *
 * Commonest first because a game's classes are not a flat list of equals: BA
 * has a handful that most of the army uses and a long tail of one-offs, and the
 * one somebody wants for a new tank is near the top of the first group. Ties
 * break on the name so the order does not shuffle between reads.
 */
export function moveClassesOf(
  units: Record<string, Record<string, unknown>>,
): MoveClass[] {
  const counts = new Map<string, number>();
  for (const def of Object.values(units)) {
    const name = moveClassOf(def);
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, units]) => ({ name, units }))
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}
