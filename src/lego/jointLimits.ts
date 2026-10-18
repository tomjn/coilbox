/**
 * How far a piece may turn, and what that means for the script, the weapon
 * definition and the viewport (issue #3353).
 *
 * A range is a lowest and highest angle in degrees from the piece's rest pose.
 * Yaw is the turn about the vertical axis, read as degrees to the right of the
 * unit's front, which is how the weapon panel's `heading` reads. Pitch is the
 * elevation of the aim, positive up, which is the `pitch` an aim function is
 * handed.
 *
 * Nothing here knows about pieces beyond the two ranges they carry, so the
 * presets, the unit definition and the viewport all ask the same functions and
 * cannot disagree about where an edge is.
 */

import type { LegoAngleRange, LegoPieceLimits, LegoProject } from "./model";

/** A piece's yaw range when it has one that limits anything. A range of a full
 *  turn or more allows every heading, so it is no range. */
export function yawRange(
  limits: LegoPieceLimits | undefined,
): LegoAngleRange | null {
  return usable(limits?.yaw, 360);
}

/** A piece's pitch range when it has one. */
export function pitchRange(
  limits: LegoPieceLimits | undefined,
): LegoAngleRange | null {
  return usable(limits?.pitch, Number.POSITIVE_INFINITY);
}

function usable(
  range: LegoAngleRange | undefined,
  widest: number,
): LegoAngleRange | null {
  if (!range) return null;
  const { min, max } = range;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return min < max && max - min < widest ? range : null;
}

/**
 * The ranges a role can be given, which are the ones the presets keep to: a
 * turret and a build arm's base turn about the vertical axis, a barrel and a
 * build arm lift, and an aim point does both.
 */
export function limitAxes(role: string | undefined): ("yaw" | "pitch")[] {
  switch (role) {
    case "turret":
    case "buildarm.base":
      return ["yaw"];
    case "barrel":
    case "buildarm.arm":
      return ["pitch"];
    case "aim":
      return ["yaw", "pitch"];
    default:
      return [];
  }
}

/**
 * `project` with a piece's limits set, or cleared for `undefined`. A mirror
 * twin gets the mirrored limits in the same edit, so the two cannot disagree.
 */
export function withLimits(
  project: LegoProject,
  pieceId: string,
  limits: LegoPieceLimits | undefined,
): LegoProject {
  const twin = project.pieces.find((piece) => piece.id === pieceId)?.twin;
  const set = (
    piece: LegoProject["pieces"][number],
    next: LegoPieceLimits | undefined,
  ) => {
    const { limits: _old, ...rest } = piece;
    return next ? { ...rest, limits: next } : rest;
  };
  return {
    ...project,
    pieces: project.pieces.map((piece) => {
      if (piece.id === pieceId) return set(piece, limits);
      // The twin of a turret is a turret. One whose role cannot be limited is
      // not a mirror of this piece, so it is left alone.
      if (piece.id === twin && limitAxes(piece.role).length > 0) {
        return set(piece, limits ? mirrorLimits(limits) : undefined);
      }
      return piece;
    }),
  };
}

/** Whether a piece has any range at all. */
export function hasLimits(limits: LegoPieceLimits | undefined): boolean {
  return yawRange(limits) !== null || pitchRange(limits) !== null;
}

/**
 * The firing arc a yaw range gives a weapon slot.
 *
 * The engine keeps one half width about one centre (`UnitDef.cpp:38-51`), so
 * a range that is not symmetric about the front becomes a cone about the
 * middle of the range. `-30` to `90` is a cone 120 degrees wide, centred 30
 * degrees to the right. Every range is symmetric about its own middle, so the
 * cone covers the range exactly and nothing more on the level.
 */
export function yawArc(range: LegoAngleRange): {
  /** Full width in degrees, written as `maxAngleDif`. */
  arc: number;
  /** Degrees to the right of the front, written as `mainDir`. */
  heading: number;
} {
  return { arc: range.max - range.min, heading: (range.min + range.max) / 2 };
}

/** The limits of the mirror twin: right becomes left, up stays up. */
export function mirrorLimits(limits: LegoPieceLimits): LegoPieceLimits {
  return {
    ...(limits.yaw
      ? { yaw: { min: -limits.yaw.max, max: -limits.yaw.min } }
      : {}),
    ...(limits.pitch ? { pitch: limits.pitch } : {}),
  };
}

/** A number as it is written into the script: three places, no `-0`. */
function num(n: number): string {
  return String(Number(n.toFixed(3)) || 0);
}

function rad(degrees: number): string {
  return `math.rad(${num(degrees)})`;
}

/**
 * The yaw range as the engine's heading sees it: a start in (-180, 180] and a
 * width. `AimWeapon` is handed the heading negated (`Weapon.cpp:424`), so a
 * range to the right of the front is a range of negative headings.
 */
function headingSpan(range: LegoAngleRange): { start: number; width: number } {
  const width = range.max - range.min;
  const start = -range.max;
  // 180 - ((180 - start) mod 360), with the modulus kept positive.
  const wrapped = 180 - ((((180 - start) % 360) + 360) % 360);
  return { start: wrapped, width };
}

/**
 * A Lua condition that is true when `heading` (radians, as `AimWeapon` is
 * given it) lies outside the yaw range.
 *
 * Compared against the edges themselves rather than the distance from the
 * middle, so a heading exactly on an edge is inside and no rounding comes
 * between the range the game maker typed and the one the script keeps.
 */
export function headingOutside(range: LegoAngleRange, name = "heading") {
  const { start, width } = headingSpan(range);
  const end = start + width;
  if (end <= 180) {
    return `${name} < ${rad(start)} or ${name} > ${rad(end)}`;
  }
  // The range runs through the back, past 180 degrees round to -180.
  return `${name} < ${rad(start)} and ${name} > ${rad(end - 360)}`;
}

/** A Lua condition that is true when `pitch` lies outside the pitch range. */
export function pitchOutside(range: LegoAngleRange, name = "pitch") {
  return `${name} < ${rad(range.min)} or ${name} > ${rad(range.max)}`;
}

/** A Lua expression for `heading` held to the yaw range, for a script that
 *  turns to whatever it is given rather than refusing it. */
export function clampedHeading(range: LegoAngleRange, name = "heading") {
  const { start, width } = headingSpan(range);
  const middle = start + width / 2;
  // Measured from the middle and wrapped to half a turn either side, so the
  // nearer edge wins for a range through the back as well.
  return `${rad(middle)} + math.max(-${rad(width / 2)}, math.min(${rad(width / 2)}, (${name} - ${rad(middle)} + math.pi) % (2 * math.pi) - math.pi))`;
}

/** A Lua expression for `pitch` held to the pitch range. */
export function clampedPitch(range: LegoAngleRange, name = "pitch") {
  return `math.max(${rad(range.min)}, math.min(${rad(range.max)}, ${name}))`;
}
