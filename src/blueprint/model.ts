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
  /**
   * Whether the order of `buildings` is the build order (issue #1418).
   *
   * The array is already a sequence, so a build order is a layout whose
   * sequence was meant rather than a second thing to hold beside the buildings.
   * Absent on a layout drawn without caring what comes first, which is most of
   * them, and what stops one pretending to be an opening it is not.
   *
   * Beyond All Reason's `blueprints.json` carries the same flag under the same
   * name next to units in array order, so an imported one keeps its sequence
   * and an exported one hands it back.
   */
  ordered?: boolean;
  /**
   * The archive name of the map this layout was drawn on (issue #1315).
   *
   * A layout is geometry with no map in it, but the geometry was arrived at by
   * looking at one: a wind farm spaced for flat ground, a line of extractors on
   * a metal spot pattern. Naming that map is what lets a reader tell whether the
   * layout is being used where it was meant to be, and it is why layouts posted
   * in the community gallery carry a map name in their titles.
   *
   * Absent on a layout drawn on no map, which is every layout made in the
   * standalone editor. Recording it never makes the layout require that map: it
   * is a note about where the shape came from, not a restriction on where it
   * goes.
   */
  designedFor?: string;
  buildings: BlueprintBuilding[];
};
