import {
  decodeContainerText,
  encodeContainerJson,
  type OpenError,
  type OpenResult,
  readContainer,
  tryEncodeContainerCode,
} from "../container/container";
import {
  type ContentRequirement,
  exactGameRequirement,
  exactMapRequirement,
} from "../content/resolveContent";
import { formatBytes } from "../content/rapidPool";
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

/**
 * What this machine has to have installed before a scenario can be played: the
 * game and the map its setup names (issue #822).
 *
 * Import runs these through the shared resolve-content gate the way a campaign
 * import does, so a scenario shared from someone else fetches what it needs
 * before it is written, rather than landing and failing at launch. A draft that
 * names neither needs nothing, and asking for a game called "" would be a
 * requirement nobody could ever satisfy.
 */
export function scenarioContentRequirements(
  scenario: Scenario,
): ContentRequirement[] {
  const { gameName, mapName } = scenario.setup;
  return [
    ...(gameName ? [exactGameRequirement(gameName)] : []),
    ...(mapName ? [exactMapRequirement(mapName)] : []),
  ];
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

/** A pasteable scenario code, or why this scenario cannot have one. */
export type ScenarioCode =
  | { ok: true; code: string }
  | { ok: false; message: string };

/**
 * Encode a scenario as a pasteable code, the way a preset, a challenge and a
 * setup pack all are (issue #1336), or refuse when the result would be too big
 * to decode.
 *
 * Scenarios are the one shareable kind with no upper bound on size, because the
 * export carries the dialogue portraits and voice clips inline as `data:` URIs.
 * Measured against the Silence the Jericho mission: the document alone is 7,146
 * bytes and a 3,128 character code, and the same document copied out to 581
 * triggers and 332 zones is still only an 18,000 character code. Prose and ids
 * compress roughly 30 to 1, so no realistic amount of authoring reaches the
 * ceiling. Media does: 380 KB of clips passes it on its own, because base64
 * costs a third on top and a portrait or a voice clip is already compressed, so
 * DEFLATE wins nothing back.
 *
 * So the refusal is real rather than theoretical, and it has to happen here
 * rather than on import. A code that has already been pasted into Discord is
 * past the point where anyone can fix it.
 */
export function encodeScenarioCode(exported: ScenarioExport): ScenarioCode {
  const result = tryEncodeContainerCode(
    "scenario",
    SCENARIO_KIND_VERSION,
    exported,
  );
  if (result.ok) return result;

  const clips = Object.keys(exported.media).length;
  const because =
    clips > 0
      ? ` Its ${clips} dialogue ${clips === 1 ? "clip travels" : "clips travel"} inside the export, which is most of that.`
      : "";
  return {
    ok: false,
    message: `This scenario is ${formatBytes(result.bytes)}, past the ${formatBytes(result.limit)} a share code can carry.${because} Export it as a file and send that instead.`,
  };
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

/** What an import failure says, for an inline error banner. */
export function scenarioImportErrorMessage(error: OpenError): string {
  switch (error) {
    case "unknown-format":
      return "That file isn't a coilbox scenario.";
    case "unsupported-version":
      return "That scenario was made by a newer version of coilbox. Update coilbox to open it.";
    case "wrong-kind":
      return "That's a coilbox file, but not a scenario.";
    default:
      return "That scenario file is damaged or incomplete.";
  }
}
