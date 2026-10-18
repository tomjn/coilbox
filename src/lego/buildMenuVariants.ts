/**
 * Putting the loadouts of a chassis on a builder's build menu (issue #3288).
 *
 * The edit is the workshop editor's own: an `add` operation recorded against
 * the builder in a workshop project's `menus`, through `addToBuildMenu`, so the
 * workshop shows it like any other. Nothing here edits a unit file. A loadout
 * that has not been exported has no unit name in the game yet, so it is listed
 * and not offered.
 */

import { receiptFor } from "@/lego/exportRecord";
import {
  addToBuildMenu,
  isBuilder,
  removeFromBuildMenu,
} from "@/workshop/buildMenus";
import { normaliseCloneKey } from "@/workshop/clones";
import { editSlot, type GameEdits, type ModProject } from "@/workshop/project";
import { newestProjectForGame } from "@/workshop/routes";
import type { LegoProject } from "./model";
import { chainOrder } from "./upgradeChain";

export interface Variant {
  /** The loadout's id. */
  id: string;
  name: string;
  /** The unit name it exported under into the game, or null when it has not
   *  been exported there. */
  unit: string | null;
}

/**
 * Every loadout of the project in upgrade chain order, with the unit it is in
 * the game at `gameFolder`. The chain order is the order units are added in, so
 * it is the order they sit on the menu.
 */
export function variantsOf(
  project: LegoProject,
  gameFolder: string,
): Variant[] {
  return chainOrder(project.loadouts ?? []).map((loadout) => {
    const receipt = receiptFor(loadout, gameFolder);
    const unit = receipt ? normaliseCloneKey(receipt.unitName) : null;
    return { id: loadout.id, name: loadout.name, unit: unit || null };
  });
}

/** The game's builders, by unit key, with the name to show. */
export function buildersOf(
  units: Record<string, unknown>,
): { key: string; name: string }[] {
  return Object.entries(units)
    .filter(([, def]) => isBuilder(def as Record<string, unknown>))
    .map(([key, def]) => {
      const name = (def as Record<string, unknown>).name;
      return { key, name: typeof name === "string" && name ? name : key };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

/** The project the operations are written to: the game's newest, if any. A
 *  game with none gets a new one from the caller. */
export function projectForGame(
  projects: readonly ModProject[],
  gameName: string,
): ModProject | undefined {
  return newestProjectForGame(projects, gameName);
}

/** The edits with `units` added to the end of `builder`'s menu, in order. */
export function withVariantsAdded(
  edits: GameEdits,
  builder: string,
  units: readonly string[],
  inherited: string[],
): GameEdits {
  return editSlot(edits, "menus", (menus) =>
    units.reduce(
      (acc, unit) => addToBuildMenu(acc, builder, unit, inherited),
      menus,
    ),
  );
}

/** The edits with `units` taken off `builder`'s menu. */
export function withVariantsRemoved(
  edits: GameEdits,
  builder: string,
  units: readonly string[],
  inherited: string[],
): GameEdits {
  return editSlot(edits, "menus", (menus) =>
    units.reduce(
      (acc, unit) => removeFromBuildMenu(acc, builder, unit, inherited),
      menus,
    ),
  );
}
