import type { OpenResult } from "../container/container";
import {
  scenarioDelete,
  scenarioList,
  scenarioMediaDelete,
  scenarioMediaImport,
  scenarioMediaRead,
  scenarioMediaSweep,
  scenarioMediaWrite,
  scenarioSave,
} from "./bindings";
import { requiredRuntimeVersion } from "./gating";
import { parseScenarioJson, type Scenario } from "./model";
import {
  dropMissingDialogueMedia,
  encodeScenarioExport,
  readScenarioExport,
  scenarioMediaFiles,
} from "./transfer";

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
 * Persist a scenario, stamping `updatedAt` (and `createdAt` on the first save)
 * and the runtime version its triggers need. Returns the stamped document so the
 * caller can hold the same value that was written, rather than one whose
 * timestamps have already drifted.
 *
 * `runtimeVersion` is computed here rather than by each editor panel because
 * every path that changes a document goes through this one function, including
 * import, so a scenario on disk always names the runtime it actually needs.
 */
export async function saveScenario(scenario: Scenario): Promise<Scenario> {
  const now = new Date().toISOString();
  const stamped: Scenario = {
    ...scenario,
    runtimeVersion: requiredRuntimeVersion(scenario),
    createdAt: scenario.createdAt || now,
    updatedAt: now,
  };
  await scenarioSave({ id: stamped.id, json: JSON.stringify(stamped) });
  return stamped;
}

/**
 * Delete a scenario and, unless `keepMedia`, the dialogue media stored alongside
 * it.
 *
 * A campaign mission that attached this scenario carries the whole document, but
 * its dialogue names portraits and voice clips by file name in this store, so
 * deleting them leaves that mission playing silent (issue #866). Callers that
 * know about campaigns pass `keepMedia` for a scenario one of them attached.
 */
export async function deleteScenario(
  id: string,
  opts: { keepMedia?: boolean } = {},
): Promise<void> {
  await scenarioDelete({ id, keepMedia: opts.keepMedia === true });
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

/**
 * Drop every stored media folder whose scenario id is not in `keep`, and say
 * which ones went.
 *
 * `keep` has to be the whole of what is still named, so a caller that could not
 * read part of it must not call this at all.
 */
export async function sweepScenarioMedia(
  keep: Iterable<string>,
): Promise<string[]> {
  const { removed } = await scenarioMediaSweep({ keep: [...keep] });
  return removed;
}

/**
 * Export a scenario as the text of one self-contained container file: the
 * document plus every dialogue clip it references, read back off disk and
 * inlined. A clip that cannot be read is left out rather than sinking the
 * export, the way a campaign export drops a broken image.
 */
export async function exportScenario(scenario: Scenario): Promise<string> {
  const media: Record<string, string> = {};
  await Promise.all(
    scenarioMediaFiles(scenario).map(async (file) => {
      try {
        const { dataUrl } = await scenarioMediaRead({
          scenarioId: scenario.id,
          file,
        });
        media[file] = dataUrl;
      } catch {
        console.warn("skipping unreadable dialogue clip", file);
      }
    }),
  );
  return encodeScenarioExport({ scenario, media });
}

/**
 * Import an exported scenario file's text and store it. Mints a fresh id, so an
 * import never overwrites the scenario it was exported from, then writes the
 * clips into that new id's media folder under the names the document already
 * uses. References to clips that did not make it are dropped, so what is saved
 * is a scenario whose media all exist here.
 *
 * Returns the container's typed failure rather than a bare `null`, so the caller
 * can say "that is a campaign, not a scenario" instead of "invalid file".
 */
export async function importScenario(
  text: string,
): Promise<OpenResult<Scenario>> {
  const read = readScenarioExport(text);
  if (!read.ok) return read;

  const id = crypto.randomUUID();
  const { scenario, media } = read.payload;
  const written = new Set<string>();
  for (const [file, dataUri] of Object.entries(media)) {
    try {
      await scenarioMediaWrite({ scenarioId: id, file, dataUri });
      written.add(file);
    } catch {
      console.warn("skipping unwritable dialogue clip", file);
    }
  }

  const saved = await saveScenario({
    ...dropMissingDialogueMedia(scenario, written),
    id,
  });
  return { ok: true, payload: saved };
}
