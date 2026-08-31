/**
 * Saving an edit to a mission that lives inside a game (issue #2160).
 *
 * The editor has no save button, so every keystroke is written back where the
 * document came from. For a mission a game ships, "where it came from" is
 * `missions/<folder>/` inside that game, not coilbox's own store. Writing it to
 * the store instead would leave two documents claiming to be the same mission,
 * drifting apart and both listed, which is the thing moving a mission in rather
 * than copying it exists to prevent.
 *
 * The compiled `mission.lua` is rewritten in the same operation as the document,
 * so the mission a game plays never disagrees with the document its author is
 * looking at.
 */

import { scenarioWriteGameMission } from "./bindings";
import { compileScenario } from "./compile";
import { requiredRuntimeVersion } from "./gating";
import type { Scenario } from "./model";
import { addGameMission, forgetGameMission } from "./scenarios";
import { isEditable, type LoadedScenario, saveScenario } from "./storage";

/**
 * Write an edit into the game the mission lives in, and hand back the stamped
 * document now on disk.
 *
 * Stamped the way {@link saveScenario} stamps a stored one, because a game's
 * document wants `updatedAt` and a recomputed `runtimeVersion` for the same
 * reasons: the list is sorted by the first and the launch gate reads the second.
 *
 * The write is fenced by {@link isEditable}, which is the one rule for whether
 * anything may be written back at all. A packaged `.sd7`/`.sdz` cannot be
 * written into, and the plugin command refuses one as well, so this refuses
 * before the author's edit turns into an error from a layer down.
 */
export async function saveMissionIntoGame(
  loaded: LoadedScenario,
  scenario: Scenario,
): Promise<Scenario> {
  const origin = loaded.origin;
  if (!origin || !isEditable(loaded)) {
    throw new Error(
      `${loaded.scenario.name} ships inside ${origin?.gameName ?? "a game"}, which is packaged, so it cannot be saved there.`,
    );
  }
  const now = new Date().toISOString();
  const stamped: Scenario = {
    ...scenario,
    runtimeVersion: requiredRuntimeVersion(scenario),
    createdAt: scenario.createdAt || now,
    updatedAt: now,
  };
  await scenarioWriteGameMission({
    root: origin.archivePath,
    folder: origin.folder,
    document: JSON.stringify(stamped),
    mission: compileScenario(stamped),
    // A clip the author adds while editing in place is imported into coilbox's
    // store, and the compiled mission names it as a bare filename resolved
    // beside itself. Without this the game would ship a mission naming a
    // portrait it does not hold.
    scenarioId: stamped.id,
  });
  // The games half of the list is read from the installed games list, not after
  // a save, so an edit that changed the name would otherwise show the archive's
  // old one until the next full reload. Forget then add, so the mission is
  // replaced rather than listed twice.
  forgetGameMission(origin);
  addGameMission({ scenario: stamped, source: "game", origin });
  return stamped;
}

/**
 * The editor's one way out: write a document back where it came from.
 *
 * A game's mission goes into that game, anything else into coilbox's store. An
 * undefined `loaded` is a document the list has not caught up with, which is
 * stored, because that is where a document with no other home belongs.
 */
export function saveEditedScenario(
  loaded: LoadedScenario | undefined,
  scenario: Scenario,
): Promise<Scenario> {
  if (loaded?.source === "game") return saveMissionIntoGame(loaded, scenario);
  return saveScenario(scenario);
}
