/**
 * A layout read out of a game's file, put into a scenario (issue #1312).
 *
 * There is nowhere else for one to go yet. A blueprint lives inside a scenario
 * document and the library that would hold it on its own is
 * https://github.com/tomjn/coilbox/issues/1415, so an import lands as a base:
 * the layout in `blueprints`, and one placement of it in `bases`.
 *
 * The build order comes with it. `addBase` does not carry the flag, because a
 * base drawn on the map building by building has no order worth claiming, so an
 * imported one says so afterwards. A layout that never claimed one stays
 * unclaimed rather than being handed the order its file happened to hold.
 */

import type { BaseBlueprint } from "@/blueprint/model";
import type { Point, Scenario } from "../../model";
import { addBase, setBlueprintOrdered } from "./bases";

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
