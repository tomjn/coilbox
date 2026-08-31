/**
 * Moving a scenario into a game, and back out (issue #2160).
 *
 * Every scenario is created and imported locally, and nothing infers a home from
 * the game named in its setup: a player with a loose copy of a game would
 * otherwise have their own work written into somebody else's game folder. Moving
 * one in is a deliberate act, and it is a move rather than a copy, so a document
 * has one home and there is no pair to drift.
 */

import type { GameItem } from "../content/bindings";
import { isSdd } from "../content/format";
import { scenarioDeleteMission, scenarioWriteGameMission } from "./bindings";
import { compileScenario } from "./compile";
import { isScenarioId } from "./missions";
import type { Scenario } from "./model";
import {
  deleteScenario,
  type GameOrigin,
  type LoadedScenario,
  saveScenario,
} from "./storage";

/**
 * The folder a mission gets inside a game: a slug of its name.
 *
 * Never a bare UUID. `isScenarioId` reads a UUID folder as coilbox's own test
 * leftover, which Content > Games offers to delete, so a game's real content
 * must never look like one.
 */
export function missionFolderName(scenarioName: string): string {
  const slug = scenarioName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "mission";
  return isScenarioId(slug) ? `mission-${slug}` : slug;
}

/**
 * Put a local scenario into a game: write the document, the compiled mission and
 * the dialogue clips into `missions/<folder>/`, then delete the local copy.
 *
 * A move rather than a copy, so the document has one home. The clips go with it
 * because the compiled mission names them by bare file name and the runtime
 * resolves those beside `mission.lua`. Left in coilbox's store they would keep
 * playing here and nowhere else, so the author would never see what everyone the
 * game ships to gets: a mission with no portraits and no voice.
 *
 * The store keeps its copy anyway (`keepMedia`), because a campaign mission that
 * attached this scenario still loads the same clips out of it by name.
 *
 * `folder` is what the author typed, slugged the same way the default is, so a
 * name with a space in it becomes a folder the game can hold rather than a write
 * the plugin refuses.
 */
export async function putMissionInGame(
  scenario: Scenario,
  game: GameItem,
  folder = scenario.name,
): Promise<GameOrigin> {
  const archivePath = game.primaryArchive.path;
  if (!archivePath || !isSdd(game.primaryArchive)) {
    throw new Error(
      `${game.name} is packaged, so nothing can be written into it.`,
    );
  }
  const named = missionFolderName(folder);
  await scenarioWriteGameMission({
    root: archivePath,
    folder: named,
    document: JSON.stringify(scenario),
    mission: compileScenario(scenario),
    scenarioId: scenario.id,
  });
  await deleteScenario(scenario.id, { keepMedia: true });
  return { gameName: game.name, archivePath, folder: named, loose: true };
}

/**
 * The reverse: back to coilbox's store, and the game's folder removed.
 *
 * Stored first and removed second, so a removal that fails leaves a copy in both
 * places rather than none. A mission in a packaged game never reaches here: there
 * is nothing to remove and the editor never offered the button.
 */
export async function takeMissionOutOfGame(
  loaded: LoadedScenario,
): Promise<Scenario> {
  const origin = loaded.origin;
  if (!origin?.loose) {
    throw new Error("This mission is not in a game coilbox can write to.");
  }
  const saved = await saveScenario(loaded.scenario);
  await scenarioDeleteMission({
    root: origin.archivePath,
    scenarioId: origin.folder,
  });
  return saved;
}
