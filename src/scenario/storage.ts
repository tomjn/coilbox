import {
  type MediaSweepSummary,
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
  type ScenarioExport,
  scenarioMediaFiles,
} from "./transfer";

/**
 * Reading and writing stored scenarios. The `coilbox-scenario` plugin keeps the
 * documents as opaque JSON, so this module is where they become validated
 * {@link Scenario} values and where the timestamps are stamped. Callers work with
 * documents, never with JSON text or file names.
 */

/** A parsed scenario plus where it came from. Bundled ones are read-only. */
export interface LoadedScenario {
  scenario: Scenario;
  source: "local" | "bundled";
}

/**
 * One stored file as a document, whether it is a bare scenario or the whole
 * export file the builder writes.
 *
 * A local scenario is always the bare document, because that is what
 * `saveScenario` writes. A bundled one is whatever the distribution dropped
 * into `.coilbox/scenarios/`, and the thing they have to hand is an export, so
 * that is unwrapped here. The dialogue clips travelling beside it in that file
 * are left alone: `ensureBundledScenarioMedia` puts them in the media store on
 * the launch path, the way a bundled campaign's are.
 */
export function parseStoredScenario(json: string): Scenario | null {
  const bare = parseScenarioJson(json);
  if (bare) return bare;
  const read = readScenarioExport(json);
  return read.ok ? read.payload.scenario : null;
}

/**
 * Every scenario, newest edit first: the ones stored here, then any a
 * distribution bundled. A document that fails validation is skipped with a
 * warning rather than failing the whole read, so one bad file cannot make the
 * scenario list unusable. Mirrors how the campaign list loads.
 */
export async function listScenarios(): Promise<LoadedScenario[]> {
  const { items } = await scenarioList({});
  const loaded: LoadedScenario[] = [];
  for (const item of items) {
    const scenario = parseStoredScenario(item.json);
    if (scenario) {
      loaded.push({ scenario, source: item.source });
    } else {
      console.warn("skipping invalid scenario document", item.source);
    }
  }
  return loaded.sort((a, b) =>
    b.scenario.updatedAt.localeCompare(a.scenario.updatedAt),
  );
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

/** Bundled scenarios whose clips this session has already written. */
const materialised = new Set<string>();

/**
 * Put a bundled scenario's dialogue clips in the media store, before it is
 * launched (issue #786).
 *
 * An imported scenario wrote its clips at import time. A bundled one never went
 * through import: it is read straight out of `.coilbox/scenarios/` as the file
 * the builder exported, and {@link listScenarios} takes the document and leaves
 * the clips beside it. So without this a distribution's mission plays its radio
 * messages with no portrait and no voice.
 *
 * They go in the ordinary media store under the id the export carried, even
 * though the scenario itself is read-only, because that store is the only place
 * the compile step reads clips from. The sweep keeps them for as long as the
 * scenario is bundled, since a bundled scenario is in the list the keep set is
 * built from, and takes them once it is not.
 *
 * On the launch path rather than the list read, because this decodes and writes
 * files and the list is read on every start for the sidebar's gate. A scenario
 * that carries no clips costs one read.
 */
export async function ensureBundledScenarioMedia(
  scenarioId: string,
): Promise<void> {
  if (materialised.has(scenarioId)) return;
  materialised.add(scenarioId);
  try {
    const { items } = await scenarioList({});
    for (const item of items) {
      if (item.source !== "bundled") continue;
      const read = readScenarioExport(item.json);
      if (!read.ok || read.payload.scenario.id !== scenarioId) continue;
      for (const [file, dataUri] of Object.entries(read.payload.media)) {
        try {
          await scenarioMediaWrite({ scenarioId, file, dataUri });
        } catch {
          console.warn("skipping unwritable dialogue clip", file);
        }
      }
      return;
    }
  } catch (e) {
    // Retry on the next launch. A clip that did not land only costs a line its
    // picture, so this must never be the reason a scenario does not start.
    materialised.delete(scenarioId);
    console.warn("could not materialise bundled dialogue clips", e);
  }
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
 * Drop the stored dialogue clips nothing names any more, and say what went.
 *
 * `keep` maps a scenario id to the clip names still referenced under it, so a
 * folder can survive while a clip inside it goes. It has to be the whole of what
 * is still named, so a caller that could not read part of it must not call this
 * at all. `apply` false previews without deleting.
 */
export async function sweepScenarioMedia(
  keep: ReadonlyMap<string, ReadonlySet<string>>,
  apply: boolean,
): Promise<MediaSweepSummary> {
  const { summary } = await scenarioMediaSweep({
    keep: Object.fromEntries([...keep].map(([id, files]) => [id, [...files]])),
    apply,
  });
  return summary;
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
 * Store a scenario an import has already decoded. Mints a fresh id, so an import
 * never overwrites the scenario it was exported from, then writes the clips into
 * that new id's media folder under the names the document already uses.
 * References to clips that did not make it are dropped, so what is saved is a
 * scenario whose media all exist here.
 *
 * Decoding and storing are separate steps because the caller has to know what
 * game and map the scenario needs before anything is written, so it can fetch
 * them first (issue #822). Nothing here touches disk until that gate has
 * cleared.
 */
export async function storeScenario(
  exported: ScenarioExport,
): Promise<Scenario> {
  const id = crypto.randomUUID();
  const { scenario, media } = exported;
  const written = new Set<string>();
  for (const [file, dataUri] of Object.entries(media)) {
    try {
      await scenarioMediaWrite({ scenarioId: id, file, dataUri });
      written.add(file);
    } catch {
      console.warn("skipping unwritable dialogue clip", file);
    }
  }

  return saveScenario({ ...dropMissingDialogueMedia(scenario, written), id });
}
