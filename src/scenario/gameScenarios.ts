/**
 * The missions a game ships inside its own archive, read as scenarios (issue
 * #2160).
 *
 * A game that bundles the mission runtime can also bundle finished missions, and
 * those are scenarios like any other: they appear in the same list, play through
 * the same launch, and are shared the same way. What differs is where the
 * document came from and whether it can be written back, which is what
 * {@link GameOrigin} carries.
 *
 * This lives outside the `coilbox-scenario` plugin's own storage because the
 * plugin knows nothing about installed games. `listScenarios` merges the two.
 */

import type { GameItem } from "../content/bindings";
import { isSdd } from "../content/format";
import {
  type GameMissionEntry,
  scenarioGameMissionFile,
  scenarioGameMissions,
} from "./bindings";
import type { GameOrigin, LoadedScenario } from "./storage";
import { parseStoredScenario } from "./storage";

/** Decode a base64 payload to text. */
function text(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Whether a game's own missions may be cached for the session, for both the
 * listing and file contents. This is the one place that rule is decided, so
 * neither cache below can be reached for a loose game by a call site that
 * forgot to check.
 *
 * A loose `.sdd` is a folder someone may be editing right now, so its listing
 * and every file inside it are read fresh on every call: nothing about it is
 * ever cached. A packaged `.sd7`/`.sdz` cannot be edited in place the way a
 * folder can, so its listing and file contents are safe to keep for the
 * session, as long as the archive at that path has not been replaced
 * underneath us (which `stamp` below exists to notice).
 */
function cacheable(loose: boolean): boolean {
  return !loose;
}

/**
 * The last stamp seen for a packaged archive's root (from `scenario_game_missions`).
 * Used only to notice a game reinstalled at the same path, so the `files` bytes
 * cached under that root can be dropped rather than served from the version
 * that used to be there. Never populated for a loose `.sdd`, which is never
 * cached in the first place.
 */
const packagedStamps = new Map<string, string | null>();

/** Files already pulled out of a packaged archive this session, keyed archive + path. */
const files = new Map<string, string>();

/**
 * Where each game mission listed this session came from, by scenario id.
 *
 * A game's own mission keeps its dialogue clips inside the game archive rather
 * than in the media store every other scenario's clips live in, so anything
 * reading a clip has to know which of the two to reach for (issue #2235). That
 * is what {@link GameOrigin} answers, and this is how a caller holding nothing
 * but a document gets one.
 *
 * A lookup rather than a prop because the document is what travels: the share
 * drawer, the copy and the editor's portrait preview each receive a
 * {@link Scenario} and no more, and threading the origin through all three
 * would put the same question in three places. {@link gameScenarios} is the
 * only writer, and it is what put the mission in the list somebody can reach
 * those three from in the first place.
 */
const origins = new Map<string, GameOrigin>();

/**
 * Where a mission came from, or `undefined` for an ordinary stored scenario.
 * Populated by {@link gameScenarios}, so a game whose missions have never been
 * listed this session answers `undefined` and the caller reads the media store,
 * which is the same answer it gave before this existed.
 */
export function gameMissionOrigin(scenarioId: string): GameOrigin | undefined {
  return origins.get(scenarioId);
}

/** Drop every cached file under a root, because the archive there has changed. */
function forgetFiles(root: string): void {
  const prefix = `${root} `;
  for (const key of files.keys()) {
    if (key.startsWith(prefix)) files.delete(key);
  }
}

/**
 * A game's mission list. Always read fresh: there is no way to learn whether a
 * packaged archive changed without asking, since `stamp` itself comes back on
 * this same call. For a packaged archive, a stamp that differs from the one
 * last seen for this root means the archive was replaced, so any file bytes
 * cached under it are dropped before anything new is cached.
 */
async function missionList(
  game: GameItem,
  root: string,
): Promise<GameMissionEntry[]> {
  const { missions, stamp } = await scenarioGameMissions({ root });
  if (cacheable(isSdd(game.primaryArchive))) {
    const previous = packagedStamps.get(root);
    if (previous !== undefined && previous !== stamp) forgetFiles(root);
    packagedStamps.set(root, stamp);
  }
  return missions;
}

/**
 * One file out of a game's mission, base64 encoded. Cached for a packaged
 * archive, since a `.sd7` is usually solid LZMA and pulling one member can mean
 * decompressing a large block, and a redraw must not pay that twice. Never
 * cached for a loose `.sdd`, so an author editing a mission's document on disk
 * sees the edit on the next read within the same session.
 */
async function fileBase64(
  root: string,
  folder: string,
  file: string,
  loose: boolean,
): Promise<string> {
  if (!cacheable(loose)) {
    const { base64 } = await scenarioGameMissionFile({ root, folder, file });
    return base64;
  }
  const key = `${root} ${folder} ${file}`;
  const cached = files.get(key);
  if (cached !== undefined) return cached;
  const { base64 } = await scenarioGameMissionFile({ root, folder, file });
  files.set(key, base64);
  return base64;
}

/**
 * Every mission every installed game ships, as scenarios.
 *
 * A mission folder counts as a mission when it holds `mission.lua`, which
 * `scenarioGameMissions` already applies. Only one that also ships
 * `scenario.json` becomes a scenario here, because only that one has a
 * document to show. A compiled-only mission has nothing this list can render.
 *
 * A game that cannot be read is skipped with a warning rather than failing the
 * list, for the same reason one bad stored document does not: a scenario list
 * that refuses to load is worse than one missing an entry.
 */
export async function gameScenarios(
  games: GameItem[],
): Promise<LoadedScenario[]> {
  const found: LoadedScenario[] = [];
  for (const game of games) {
    const archivePath = game.primaryArchive.path;
    if (!archivePath) continue;
    const loose = isSdd(game.primaryArchive);
    try {
      const missions = await missionList(game, archivePath);
      for (const mission of missions) {
        if (!mission.hasDocument) continue;
        const base64 = await fileBase64(
          archivePath,
          mission.folder,
          "scenario.json",
          loose,
        );
        const scenario = parseStoredScenario(text(base64));
        if (!scenario) {
          console.warn(
            "skipping invalid mission document",
            game.name,
            mission.folder,
          );
          continue;
        }
        const origin: GameOrigin = {
          gameName: game.name,
          archivePath,
          folder: mission.folder,
          loose,
        };
        origins.set(scenario.id, origin);
        found.push({ scenario, source: "game", origin });
      }
    } catch (e) {
      console.warn("could not read missions from", game.name, e);
    }
  }
  return found;
}

/**
 * One of a mission's own files, base64 encoded, for coilbox's own panels and
 * its export. The engine reads the archive itself, so this exists only so the
 * app can draw a portrait, play a clip and inline one in a share. Nothing is
 * written to disk, which is what keeps a game's media in its game.
 *
 * Base64 rather than a `data:` URI because the content type depends on what the
 * caller is doing with the bytes, and that is `scenarioMedia.ts`'s question,
 * not this module's.
 */
export async function missionFileBase64(
  origin: GameOrigin,
  file: string,
): Promise<string> {
  return fileBase64(origin.archivePath, origin.folder, file, origin.loose);
}
