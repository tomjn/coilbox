import {
  decodeContainerText,
  encodeContainerJson,
  type OpenResult,
  readContainer,
} from "../container/container";
import { parseScenario, type Scenario } from "./model";

/**
 * Scenario export and import (issue #739). An exported scenario is a canonical
 * coilbox container (`../container/container.ts`) with `kind: "scenario"`, so it
 * identifies itself the way every other coilbox artefact does.
 *
 * Unlike a campaign, the payload is not the document alone. A scenario's
 * dialogue names its portraits and voice clips as bare file names, because the
 * compile step copies those files into the game's VFS where the engine loads
 * them by name and a data URI would be unreachable. Inlining them into the
 * document the way campaigns inline panoramas would therefore change what
 * `compileScenario` emits. So the media travel *beside* the document instead:
 *
 * ```
 * payload: { scenario: <the document>, media: { "<file>": <data URI> } }
 * ```
 *
 * The consequence is that an export is self-contained, and that the file names
 * survive the trip unchanged. Import writes each clip back under the same name
 * into the new scenario's own media folder, so every `portrait` and `audio`
 * reference in the document still resolves without rewriting the document.
 *
 * There is no legacy reader here. Scenarios did not exist before the container,
 * so the container is the only format a scenario has ever had.
 */

/** Payload schema version for `kind: "scenario"`. */
export const SCENARIO_KIND_VERSION = 1;

/**
 * What one exported scenario file holds: the document plus every dialogue clip
 * it references, keyed by the bare file name the document uses.
 */
export interface ScenarioExport {
  scenario: Scenario;
  /** File name to `data:` URI. Empty when the scenario has no dialogue media. */
  media: Record<string, string>;
}

/** The bare file names a scenario's dialogue references, deduplicated. */
export function scenarioMediaFiles(scenario: Scenario): string[] {
  const files = new Set<string>();
  for (const line of scenario.dialogue) {
    if (line.portrait) files.add(line.portrait);
    if (line.audio) files.add(line.audio);
  }
  return [...files];
}

/**
 * Drop every `portrait` and `audio` reference naming a clip that is not in
 * `available`, returning the scenario otherwise untouched.
 *
 * Import ends with this so a stored scenario never names a clip that is not on
 * this machine. An export edited by hand, or one whose clip failed to write, is
 * otherwise a document that compiles happily and then asks the engine for a file
 * that is not there.
 */
export function dropMissingDialogueMedia(
  scenario: Scenario,
  available: ReadonlySet<string>,
): Scenario {
  const keep = (file: string | undefined) =>
    file && available.has(file) ? file : undefined;
  return {
    ...scenario,
    dialogue: scenario.dialogue.map((line) => ({
      ...line,
      portrait: keep(line.portrait),
      audio: keep(line.audio),
    })),
  };
}

/**
 * Narrow an untrusted container payload to a {@link ScenarioExport}. Written to
 * `readContainer`'s `parsePayload` signature, so the envelope checks and the
 * payload checks stay in one call.
 *
 * A malformed media entry is dropped rather than rejecting the whole file: a
 * missing portrait costs a line its picture, where refusing the import costs the
 * author the entire scenario. A malformed *document* still rejects, because
 * `parseScenario` treats structural damage as unrecoverable.
 */
export function parseScenarioPayload(value: unknown): ScenarioExport | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const scenario = parseScenario(v.scenario);
  if (!scenario) return null;

  const media: Record<string, string> = {};
  if (typeof v.media === "object" && v.media !== null) {
    for (const [file, uri] of Object.entries(v.media as object)) {
      if (typeof uri === "string" && uri.startsWith("data:")) media[file] = uri;
    }
  }
  return { scenario, media };
}

/** Serialize a scenario and its dialogue media as an export file's text. */
export function encodeScenarioExport(exported: ScenarioExport): string {
  return encodeContainerJson("scenario", SCENARIO_KIND_VERSION, exported);
}

/**
 * Read an exported scenario file (or a pasted code, which the container decodes
 * for free). Returns the typed failure rather than a bare `null`, so an import
 * can tell "this is a campaign, not a scenario" from "this file is damaged".
 * Never throws.
 */
export function readScenarioExport(text: string): OpenResult<ScenarioExport> {
  return readContainer(
    decodeContainerText(text),
    "scenario",
    parseScenarioPayload,
  );
}
