/**
 * Flattening a scenario document into the individual units the editor draws.
 *
 * A document holds three different shapes that all end up as a model standing
 * somewhere on the map: an actor is one unit at one point, a group is a bag of
 * counts at one point, and a base is a blueprint's buildings offset from an
 * origin. The scene does not care which it came from, so the difference is
 * resolved once, here, into the shared {@link Placement} everything downstream
 * works on.
 *
 * Arithmetic only, so it can be tested without a GPU.
 */

import type { SnapBuilding } from "@/blueprint/footprint";
import { type Placement, placementKey } from "@/placement/placements";
import { baseBuildings, type Point, type Scenario } from "../../model";

/**
 * How far apart a group's units stand, in elmos.
 *
 * A group carries no positions, only counts, so the editor has to invent a
 * formation. Wide enough that medium units do not overlap, tight enough that a
 * twenty-strong group still reads as one block.
 */
export const GROUP_SPACING = 96;

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
 * bases.
 *
 * A group's `units` counts are expanded one unit per model, because the whole
 * point of drawing a scenario is seeing how much is on the map. Groups have no
 * facing of their own, so their units face south, the engine's zero.
 *
 * Given a `snap`, a base's buildings are drawn where the engine will stand them
 * rather than on the point the document names, so a model and its footprint
 * square are never in two places (#1421). Only the drawing moves: a document
 * whose numbers the grid disagrees with is left as its author wrote it, and
 * making those numbers agree is a conversion an import asks for and says it did.
 * The point it was written on is kept as `named`, because an edit shifts that
 * one. Without a `snap` everything is drawn where the document puts it, which is
 * what happens while the game's units are still being read.
 */
export function scenarioPlacements(
  scenario: Pick<Scenario, "actors" | "groups" | "bases" | "blueprints">,
  snap?: SnapBuilding,
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

  for (const base of scenario.bases) {
    baseBuildings(scenario.blueprints, base).forEach((building, index) => {
      const at = {
        x: base.origin.x + building.offset.x,
        z: base.origin.z + building.offset.z,
      };
      out.push({
        key: placementKey("base", base.id, index),
        kind: "base",
        id: base.id,
        index,
        def: building.def,
        team: base.team,
        pos: snap ? snap(at, building.def, building.facing) : at,
        named: at,
        facing: building.facing,
      });
    });
  }

  return out;
}
