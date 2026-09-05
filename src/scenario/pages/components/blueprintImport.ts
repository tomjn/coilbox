/**
 * A layout read out of a game's file, put into a scenario (issue #1312).
 *
 * Two ways in, and they differ over whether the caller has a point to put the
 * base on:
 *
 * - {@link takeBlueprint} places it, for a caller holding a click on the map.
 * - {@link carryBlueprint} does not, for a caller with no map in front of it.
 *   The layout goes into `blueprints` and nothing goes into `bases`, which is
 *   the "not placed" state the contents list already offers a pin for, so the
 *   placement is a click rather than a corner somebody has to undo (#1434).
 *
 * The build order comes with it either way. `addBase` does not carry the flag,
 * because a base drawn on the map building by building has no order worth
 * claiming, so an imported one says so afterwards. A layout that never claimed
 * one stays unclaimed rather than being handed the order its file happened to
 * hold.
 */

import type { BaseBlueprint } from "@/blueprint/model";
import { addBase, setBlueprintOrdered } from "@/lib/scenarioEditing/bases";
import type { Point, Scenario } from "../../model";

export function takeBlueprint(
  scenario: Scenario,
  layout: Omit<BaseBlueprint, "id">,
  /** A `setup.participants` id, because a base on the map belongs to someone. */
  team: string,
  /** Minted by the caller, so it can be handed back what it just added. */
  ids: { base: string; blueprint: string },
  origin: Point,
): Scenario {
  const placed = addBase(scenario, ids.base, ids.blueprint, {
    team,
    origin,
    name: layout.name,
    // Whatever map the layout says it was drawn for, which is not this
    // scenario's: an imported layout was shaped somewhere else and saying
    // otherwise would be inventing provenance (issue #1315).
    designedFor: layout.designedFor,
    buildings: layout.buildings,
  });
  return layout.ordered ? setBlueprintOrdered(placed, ids.base, true) : placed;
}

/**
 * The same layout, carried by the scenario and standing nowhere (issue #1434).
 *
 * For the panel that reads a game's file, which has no map in it and so no
 * point to put a base on. It used to drop one at the map's north-west corner,
 * which is half off the map and, on a large map, somewhere the author has to go
 * and find before they can move it.
 *
 * Whatever map the layout says it was drawn for is kept, and this scenario's is
 * not written over it: an imported layout was shaped somewhere else and saying
 * otherwise would be inventing provenance (issue #1315).
 */
export function carryBlueprint(
  scenario: Scenario,
  layout: Omit<BaseBlueprint, "id">,
  /** Minted by the caller, so this stays an edit rather than something that
   *  makes up an id every time it runs. */
  blueprintId: string,
): Scenario {
  return {
    ...scenario,
    blueprints: [
      ...scenario.blueprints,
      {
        id: blueprintId,
        name: layout.name,
        designedFor: layout.designedFor?.trim() || undefined,
        // Whole elmos, the same as a placed one, because an author never means
        // 1023.9997 and a file is free to hold it.
        buildings: layout.buildings.map((building) => ({
          ...building,
          offset: {
            x: Math.round(building.offset.x),
            z: Math.round(building.offset.z),
          },
        })),
        ...(layout.ordered ? { ordered: true } : {}),
      },
    ],
  };
}
