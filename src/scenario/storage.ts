import {
  scenarioDelete,
  scenarioList,
  scenarioMediaDelete,
  scenarioMediaImport,
  scenarioSave,
} from "./bindings";
import { parseScenarioJson, type Scenario } from "./model";

/**
 * Reading and writing stored scenarios. The `coilbox-scenario` plugin keeps the
 * documents as opaque JSON, so this module is where they become validated
 * {@link Scenario} values and where the timestamps are stamped. Callers work with
 * documents, never with JSON text or file names.
 */

/**
 * Every stored scenario, newest edit first. A document that fails validation is
 * skipped with a warning rather than failing the whole read, so one bad file
 * cannot make the scenario list unusable. Mirrors how the campaign list loads.
 */
export async function listScenarios(): Promise<Scenario[]> {
  const { items } = await scenarioList({});
  const loaded: Scenario[] = [];
  for (const item of items) {
    const scenario = parseScenarioJson(item.json);
    if (scenario) {
      loaded.push(scenario);
    } else {
      console.warn("skipping invalid scenario document");
    }
  }
  return loaded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Persist a scenario, stamping `updatedAt` (and `createdAt` on the first save).
 * Returns the stamped document so the caller can hold the same value that was
 * written, rather than one whose timestamps have already drifted.
 */
export async function saveScenario(scenario: Scenario): Promise<Scenario> {
  const now = new Date().toISOString();
  const stamped: Scenario = {
    ...scenario,
    createdAt: scenario.createdAt || now,
    updatedAt: now,
  };
  await scenarioSave({ id: stamped.id, json: JSON.stringify(stamped) });
  return stamped;
}

/** Delete a scenario and the dialogue media stored alongside it. */
export async function deleteScenario(id: string): Promise<void> {
  await scenarioDelete({ id });
}

/**
 * Import a dialogue portrait or voice clip from a file the user picked. Returns
 * the bare stored filename to put on a `ScenarioDialogue`.
 */
export async function importScenarioMedia(
  scenarioId: string,
  srcPath: string,
): Promise<string> {
  const { file } = await scenarioMediaImport({ scenarioId, srcPath });
  return file;
}

/** Drop a stored dialogue clip. */
export async function deleteScenarioMedia(
  scenarioId: string,
  file: string,
): Promise<void> {
  await scenarioMediaDelete({ scenarioId, file });
}
