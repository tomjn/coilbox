/**
 * The compiled missions coilbox has written into a game, and which of them are
 * coilbox's to remove (issue #814).
 *
 * Launching a scenario in a game that vendors the runtime writes
 * `missions/<scenario id>/` into the game folder and leaves it there, so a
 * player who tests five scenarios ends up with five folders and a scenario they
 * have since deleted still launchable. A game may also ship missions of its own
 * under the same folder, and those are its content, so the two have to be told
 * apart before coilbox offers to delete anything.
 *
 * The folder name is what tells them apart. Coilbox names one after the
 * scenario, and a scenario id is always a v4 UUID (`newScenarioId`), including
 * one that arrived inside someone else's export. A game names its own missions
 * for people to read.
 */

import type { Scenario } from "./model";

/** The shape `crypto.randomUUID` mints, which is every scenario id. */
const SCENARIO_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when a mission folder is named the way coilbox names one. */
export function isScenarioId(folder: string): boolean {
  return SCENARIO_ID.test(folder);
}

/** One mission folder in a game, as the Content page lists it. */
export interface GameMission {
  /** The folder name, which for coilbox's own is the scenario id. */
  id: string;
  /** The scenario it was compiled from, or null when this machine has none. */
  name: string | null;
  /** True when coilbox wrote it, so removing it takes nothing of the game's. */
  ours: boolean;
}

/**
 * Describe every mission folder a game holds: which coilbox wrote, and what the
 * scenario behind each is called.
 *
 * A folder with no matching scenario is still coilbox's when it is named like
 * one. That is the case the issue is about: the scenario was deleted and the
 * folder it wrote outlived it.
 */
export function gameMissions(
  folders: string[],
  scenarios: Scenario[],
): GameMission[] {
  return folders.map((id) => ({
    id,
    name: scenarios.find((s) => s.id === id)?.name ?? null,
    ours: isScenarioId(id),
  }));
}
