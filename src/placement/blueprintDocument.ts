/**
 * A blueprint as a document the placement surface can edit (issue #1416).
 *
 * The surface edits a scenario. That is not an accident of how it was written:
 * a base on a map is a layout placed at an origin, and dragging one of its
 * buildings, turning it, deleting it or moving it up the build order are all
 * edits to the layout rather than to the mission around it. Every one of those
 * rules already exists, is tested, and is the behaviour an author has learned.
 *
 * So a standalone blueprint is edited as a document holding exactly one base
 * placed from it, on flat ground with no map. Nothing about the editing is
 * reimplemented, the two editors cannot drift apart, and what comes back out is
 * a plain blueprint again.
 *
 * The mission half of that document is empty and stays empty: no actors, no
 * groups, no zones, no triggers, no objectives. The one participant is there
 * because a drawn unit is painted in a team's colour and needs one to name.
 */

import type { BaseBlueprint } from "@/blueprint/model";
import { newScenario } from "@/scenario/create";
import type { Point, Scenario } from "@/scenario/model";
import { GRID_ORIGIN } from "./ground";

/**
 * The base the standalone editor places the layout as.
 *
 * Fixed rather than minted, because there is only ever one of it and the
 * toolbar has to be able to name it before anything has been clicked. Not a
 * UUID, and with no `#` in it, so it cannot collide with a real base's id and
 * still reads back through `parsePlacementKey`.
 */
export const BLUEPRINT_BASE_ID = "blueprint-base";

/**
 * One blueprint as a document to edit it in.
 *
 * The game is named because a building is drawn with its own model and picked
 * out of its own game's units. The map is not, and that is the point.
 */
export function blueprintDocument(
  blueprint: BaseBlueprint,
  gameName: string,
  origin: Point = GRID_ORIGIN,
): Scenario {
  const base = newScenario(blueprint.name);
  // One participant, which is whoever the launcher would call you. A second
  // would be a team picker, and a team picker belongs to a mission.
  const participants = base.setup.participants.slice(0, 1);
  return {
    ...base,
    setup: { ...base.setup, gameName, participants },
    blueprints: [blueprint],
    bases: [
      {
        id: BLUEPRINT_BASE_ID,
        blueprint: blueprint.id,
        team: participants[0].id,
        origin,
        buildings: [],
      },
    ],
  };
}

/**
 * The layout back out of a document the surface has been editing.
 *
 * `previous` is what went in, and it answers the one case the document cannot:
 * deleting a base's last building deletes the base, and the layout is pruned
 * with it. On a map that is a base being cleared away. Standalone there is
 * nothing to clear away, so it is a layout with nothing in it, which is exactly
 * where a new blueprint starts. Its name, its id and whether its order was
 * meant all survive that.
 */
export function documentLayout(
  doc: Scenario,
  previous: BaseBlueprint,
): BaseBlueprint {
  const base = doc.bases.find((entry) => entry.id === BLUEPRINT_BASE_ID);
  const layout = base
    ? doc.blueprints.find((entry) => entry.id === base.blueprint)
    : undefined;
  return layout ?? { ...previous, buildings: [] };
}
