import type { Facing, Point } from "../scenario/model";

/**
 * A base blueprint: a named layout of buildings, and optionally changes to the
 * ground (issues #1310, #4790).
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
  /**
   * What this building was before it was substituted for another side's
   * equivalent (issue #1314).
   *
   * A layout naming one side's buildings is no use to a player of the other, so
   * a layout can be converted by swapping each def for the other side's. Keeping
   * the name it was drawn as is what makes that reversible, and it is the same
   * field under the same name that Beyond All Reason's own substitution writes,
   * so a converted layout survives a trip out through `./bar.ts` and back.
   *
   * Absent on a building nobody has swapped, which is every building of a layout
   * as it was drawn.
   */
  originalName?: string;
};

/**
 * One change to the ground, placed relative to the blueprint's origin (issue
 * #4790).
 *
 * Heights are relative so a blueprint fits any map. A `raise` adds its height
 * to the ground under each point, and a negative height digs. A `level` height
 * and the ends of a ramp are measured from the ground under the point the
 * player holds the blueprint by when placing it. Restore, Zero-K's terraform
 * type 5, is left out because it puts back the map's own ground, which depends
 * on the map rather than on the blueprint.
 *
 * Points are offsets in elmos, snapped to the 8 elmo heightmap corner grid.
 * The wire shape in `./payload.ts` is the same plain values.
 */
export type TerrainStep = {
  kind: "level" | "raise" | "ramp" | "smooth";
  /** An open path or a closed outline. A ramp is a path of two points. */
  shape: "wall" | "area";
  points: Point[];
  /** Level and raise only. */
  height?: number;
  /** Ramp only: the height at each end, in the order of `points`. */
  heights?: [number, number];
  /** Ramp only, in elmos. */
  width?: number;
  /** Level and ramp only: change the ground one way. `raise` fills ground below
   *  the step's height and leaves higher ground standing, `lower` cuts ground
   *  above it and leaves lower ground. Absent changes it both ways. */
  only?: "raise" | "lower";
  /** The index in `buildings` this step comes before. `buildings.length` means
   *  after all of them. */
  before: number;
};

/** A named, reusable layout of buildings, and optionally changes to the ground. */
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
  /**
   * Changes to the ground, in build order among the buildings by each step's
   * `before` (issue #4790). Absent on a layout that changes none, which is every
   * layout made before terrain changes. A layout may have terrain steps and no
   * buildings at all.
   */
  terrain?: TerrainStep[];
};
