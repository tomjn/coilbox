import type { Facing, Point } from "../scenario/model";

/**
 * A base blueprint: a named layout of buildings and nothing else (issue #1310).
 *
 * A blueprint is the geometry a player means when they say "my opening base". It
 * names no team, stands on no map and answers to no trigger, so the same one is
 * equally usable as a mission's pre-built enemy compound, as something stamped
 * out during a live game, and as a file posted for somebody else to use.
 *
 * Everything a mission adds on top lives on the placement instead, in
 * `ScenarioBase` in `../scenario/model.ts`: the team, the origin, the trigger
 * addressable ids and the factory queues. Keeping them off the blueprint is what
 * makes a blueprint portable, and it is also the shape Beyond All Reason's
 * `blueprints.json` already has, so reading one in loses nothing and writing one
 * out only ever strips fields the format is known not to carry.
 *
 * Types only, with no parser of its own. A blueprint currently reaches coilbox
 * inside a scenario document, so `parseScenario` narrows it along with the rest,
 * and a standalone blueprint file carries its own envelope to be read against.
 */

/**
 * One building of a layout, placed relative to the blueprint's origin.
 *
 * The origin itself is not stored: a blueprint is a shape rather than a place,
 * so the offsets are measured from whatever point the layout is put down on.
 */
export type BlueprintBuilding = {
  def: string;
  offset: Point;
  facing: Facing;
};

/** A named, reusable layout of buildings. */
export type BaseBlueprint = {
  id: string;
  /** What the author calls it, which is what a picker lists it by. */
  name: string;
  buildings: BlueprintBuilding[];
};
