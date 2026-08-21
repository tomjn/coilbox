/**
 * The unit's aim point: the one point on it that another unit shoots at.
 *
 * A weapon does not fire at a model, it fires at a single position, and the
 * engine uses that same position as the unit's middle for range checks, lead
 * prediction and everything else that treats a unit as a point. `CUnit::PreInit`
 * sets both from the model with `SetMidAndAimPos(model->relMidPos,
 * model->relMidPos, true)`, and `relMidPos` is read straight out of the s3o
 * header by `CS3OParser::Load`. So the header's mid is the only lever a model
 * file has over either, and it moves them together. Prising them apart needs
 * `Spring.SetUnitMidAndAimPos` from a game's own Lua, which is not something an
 * exported unit can carry.
 *
 * Nobody has to set one. Left alone it is the middle of the unit's bounding
 * box, which is what the engine would work out for itself. That is the wrong
 * point whenever a long outlying piece drags the box's middle off the body: a
 * crane arm, an aircraft tail, a raised radar dish. Shots then aim at air beside
 * the unit, or down in its legs.
 *
 * Two other numbers are measured from this point rather than from the origin,
 * so both move with it:
 *
 * - the s3o header's radius, which is the collision sphere's radius and is
 *   measured from the mid (see `header` in `s3oBuild.ts`).
 * - the collision volume's offsets, which `GetWorldSpacePos` adds to the
 *   object's `midPos` (see `collisionVolume.ts`).
 */

import type { LegoProject } from "./model";
import type { UnitBounds } from "./s3oBuild";

/**
 * Where this unit is aimed at: the point it has been given, or the middle of
 * its bounding box when it has none.
 *
 * `bounds` is the measured box, so a unit that has not been given an aim point
 * keeps getting a fresh one as it is built.
 */
export function aimPoint(
  project: LegoProject,
  bounds: UnitBounds,
): [number, number, number] {
  return project.mid ?? bounds.mid;
}
