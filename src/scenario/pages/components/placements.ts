/**
 * Flattening a scenario document into the individual units the editor draws.
 *
 * A document holds three different shapes that all end up as a model standing
 * somewhere on the map: an actor is one unit at one point, a group is a bag of
 * counts at one point, and a prefab is a list of buildings offset from an
 * origin. The scene does not care which it came from, only where a unit stands,
 * which way it faces and whose it is, so the difference is resolved once, here,
 * and everything downstream works on one list.
 *
 * Arithmetic only, so it can be tested without a GPU. The three.js half lives in
 * `unitsLayer.ts`.
 */

import type { Participant, Rgb } from "@/play/config";
import type { Facing, Point, Scenario } from "../../model";

/** One unit to draw, and the document entry it came from. */
export interface Placement {
  /**
   * Identifies the drawn object. Unique across the whole document, and stable
   * as long as the entry keeps its id and its members keep their order, so a
   * pick can be turned straight back into the thing that was clicked.
   */
  key: string;
  kind: "actor" | "group" | "prefab";
  /** The id of the actor, group or prefab this unit belongs to. */
  id: string;
  /** Which unit within a group or prefab. Always 0 for an actor. */
  index: number;
  /** Unit def name, as the document holds it. */
  def: string;
  /** A `setup.participants` id. */
  team: string;
  /** Where it stands, in elmos from the map's north-west corner. */
  pos: Point;
  facing: Facing;
}

/**
 * How far apart a group's units stand, in elmos.
 *
 * A group carries no positions, only counts, so the editor has to invent a
 * formation. Wide enough that medium units do not overlap, tight enough that a
 * twenty-strong group still reads as one block.
 */
export const GROUP_SPACING = 96;

/** The key format, in one place, so a picker can build a key to look up by. */
export function placementKey(
  kind: Placement["kind"],
  id: string,
  index = 0,
): string {
  return kind === "actor" ? `actor:${id}` : `${kind}:${id}#${index}`;
}

/**
 * Where the `index`th of `total` units in a group stands, relative to the
 * group's position.
 *
 * A centred square-ish grid, filled row by row. The grid is centred on the
 * group's point rather than starting there, so moving a group moves it about
 * its middle, which is what dragging one feels like it should do.
 */
export function groupFormationOffset(
  index: number,
  total: number,
  spacing = GROUP_SPACING,
): Point {
  const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.ceil(total / cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: (col - (cols - 1) / 2) * spacing,
    z: (row - (rows - 1) / 2) * spacing,
  };
}

/**
 * Every unit the document places, in document order: actors, then groups, then
 * prefabs.
 *
 * A group's `units` counts are expanded one unit per model, because the whole
 * point of drawing a scenario is seeing how much is on the map. Groups have no
 * facing of their own, so their units face south, the engine's zero.
 */
export function scenarioPlacements(
  scenario: Pick<Scenario, "actors" | "groups" | "prefabs">,
): Placement[] {
  const out: Placement[] = [];

  for (const actor of scenario.actors) {
    out.push({
      key: placementKey("actor", actor.id),
      kind: "actor",
      id: actor.id,
      index: 0,
      def: actor.unitDef,
      team: actor.team,
      pos: actor.pos,
      facing: actor.facing,
    });
  }

  for (const group of scenario.groups) {
    let index = 0;
    const total = group.units.reduce((sum, u) => sum + u.count, 0);
    for (const entry of group.units) {
      for (let n = 0; n < entry.count; n++) {
        const offset = groupFormationOffset(index, total);
        out.push({
          key: placementKey("group", group.id, index),
          kind: "group",
          id: group.id,
          index,
          def: entry.def,
          team: group.team,
          pos: { x: group.pos.x + offset.x, z: group.pos.z + offset.z },
          facing: 0,
        });
        index++;
      }
    }
  }

  for (const prefab of scenario.prefabs) {
    prefab.buildings.forEach((building, index) => {
      out.push({
        key: placementKey("prefab", prefab.id, index),
        kind: "prefab",
        id: prefab.id,
        index,
        def: building.def,
        team: prefab.team,
        pos: {
          x: prefab.origin.x + building.offset.x,
          z: prefab.origin.z + building.offset.z,
        },
        facing: building.facing,
      });
    });
  }

  return out;
}

/**
 * The engine facing as a rotation about the scene's up axis, in radians.
 *
 * A unit model is built with its front along +z, and the engine's facing 0 is
 * south, which is also +z, so facing 0 is no rotation at all. Each step turns a
 * quarter turn the way three.js rotates +z toward +x, which is east, the
 * engine's facing 1.
 */
export function facingToYaw(facing: Facing): number {
  return (facing * Math.PI) / 2;
}

/** What a unit belonging to nobody is drawn in: a neutral grey. */
export const UNOWNED_COLOR: Rgb = [0.62, 0.65, 0.7];

/**
 * The colour a team's units are drawn in, as the launcher's 0..1 float RGB.
 *
 * Taken straight off the participant, which is the same value the launcher
 * writes into the start script, so what is drawn is what will be played. A team
 * id that no longer names a participant, which a document keeps after its setup
 * is changed, falls back to grey rather than disappearing.
 */
export function teamColor(participants: Participant[], team: string): Rgb {
  return participants.find((p) => p.id === team)?.color ?? UNOWNED_COLOR;
}
