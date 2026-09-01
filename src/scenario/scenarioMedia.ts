/**
 * Reading a scenario's dialogue clips, from whichever of the two stores holds
 * them (issue #2235).
 *
 * A scenario coilbox stores keeps its portraits and voice clips in the media
 * store, at `media/<scenarioId>/<file>`. A mission that came inside somebody
 * else's game keeps them inside the game archive, beside the compiled
 * `mission.lua`, and has never been through that store at all. Both are read
 * here, so a caller holding a document never has to know which kind it has.
 *
 * Before this the export and the editor preview each reached straight for the
 * media store, found nothing for a game's own mission, and dropped the
 * reference without a word. That is what {@link gatherScenarioExport} now
 * reports through `missing`: an export with holes in it has to say so, because
 * the person it is handed to cannot tell a mission with no portraits from a
 * mission whose portraits were lost on the way out.
 */

import { scenarioMediaUrl } from "../lib/assetUrl";
import { scenarioMediaRead } from "./bindings";
import { gameMissionOrigin, missionFileBase64 } from "./gameScenarios";
import type { Scenario } from "./model";
import { type ScenarioExport, scenarioMediaFiles } from "./transfer";

/**
 * Content type for a clip, by extension, so a `data:` URI built here is one a
 * webview will actually decode. `application/octet-stream` is not: an `<img>`
 * given one draws nothing, whatever the bytes are.
 *
 * The same extensions `coilbox_portable::mime_for` maps on the Rust side, which
 * is what the media store's own reader uses, so the same clip gets the same
 * content type whichever store it came out of. `dds` is absent from both, and
 * falls through: it is what a game ships its art as and no browser engine draws
 * one, which the dialogue panel already says out loud.
 */
function clipMime(file: string): string {
  switch (file.toLowerCase().split(".").pop()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "webp":
      return "image/webp";
    case "ogg":
    case "oga":
      return "audio/ogg";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "flac":
      return "audio/flac";
    case "opus":
      return "audio/opus";
    case "m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}

/**
 * One dialogue clip as a `data:` URI, out of the game archive when the scenario
 * is a game's own mission and out of the media store otherwise. Throws when the
 * clip cannot be read, so a caller has to decide what to do about it rather
 * than being handed a URI to nothing.
 */
export async function readDialogueClip(
  scenarioId: string,
  file: string,
): Promise<string> {
  const origin = gameMissionOrigin(scenarioId);
  if (!origin) {
    const { dataUrl } = await scenarioMediaRead({ scenarioId, file });
    return dataUrl;
  }
  const base64 = await missionFileBase64(origin, file);
  return `data:${clipMime(file)};base64,${base64}`;
}

/**
 * Where a panel points an `<img>` or an `<audio>` at a clip without reading it
 * first, or `null` when there is no such URL and the bytes have to be fetched
 * with {@link readDialogueClip}.
 *
 * A stored scenario's clips are served over the `scenario://` scheme, which
 * streams and seeks rather than holding a whole voice clip in memory as base64
 * (issue #785). A game's own mission has nothing in that store, so its clips
 * come out of the archive one read at a time.
 */
export function dialogueClipUrl(
  scenarioId: string,
  file: string,
): string | null {
  return gameMissionOrigin(scenarioId)
    ? null
    : scenarioMediaUrl(scenarioId, file);
}

/**
 * An export and the clips it could not gather. Kept as a pair rather than an
 * extra key on the export itself, so nothing can serialize "what went wrong"
 * into the file it went wrong in.
 */
export interface GatheredScenario {
  exported: ScenarioExport;
  /**
   * Clips the document names that could not be read. Non-empty means the
   * export is short of what the document asks for, and whoever is about to
   * hand it to someone else has to be told.
   */
  missing: string[];
}

/**
 * Gather everything one self-contained export holds: the document plus every
 * dialogue clip it references, read back out of its store and inlined.
 *
 * This gathers rather than serializing, because the same value feeds both share
 * routes, a file and a code (issue #1336), and reading the clips is the
 * expensive part. A share drawer that offered both would otherwise read them
 * twice. Naming the game (issue #1335) happens at the serialize step, so both
 * routes get it from the one place.
 *
 * A clip that cannot be read is still left out rather than sinking the whole
 * export, the way a campaign export drops a broken image, but it is named in
 * `missing` instead of only reaching the console.
 */
export async function gatherScenarioExport(
  scenario: Scenario,
): Promise<GatheredScenario> {
  const media: Record<string, string> = {};
  const missing: string[] = [];
  await Promise.all(
    scenarioMediaFiles(scenario).map(async (file) => {
      try {
        media[file] = await readDialogueClip(scenario.id, file);
      } catch (e) {
        console.warn("skipping unreadable dialogue clip", file, e);
        missing.push(file);
      }
    }),
  );
  return { exported: { scenario, media }, missing: missing.sort() };
}
