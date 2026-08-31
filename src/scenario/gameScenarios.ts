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
 * A packaged game's mission list, keyed by the archive and what it was when we
 * read it. A packaged archive is one file, so its reported size and checksum
 * say whether its contents changed. A loose `.sdd` is deliberately absent: a
 * folder's checksum does not move when a file inside it does, and re-reading a
 * directory listing is cheap, which is what makes an edit show up at once.
 */
const packagedLists = new Map<
  string,
  { stamp: string; missions: GameMissionEntry[] }
>();

/** Files already pulled out of an archive this session, keyed archive + path. */
const files = new Map<string, string>();

/**
 * A game's mission list, cached for a packaged archive since pulling its
 * listing means opening the archive, and re-read every time for a loose
 * `.sdd` because a directory listing costs almost nothing.
 */
async function missionList(
  game: GameItem,
  root: string,
): Promise<GameMissionEntry[]> {
  const archive = game.primaryArchive;
  if (isSdd(archive)) {
    const { missions } = await scenarioGameMissions({ root });
    return missions;
  }
  const stamp = `${archive.size ?? ""}:${archive.checksum ?? ""}`;
  const cached = packagedLists.get(root);
  if (cached && cached.stamp === stamp) return cached.missions;
  const { missions } = await scenarioGameMissions({ root });
  packagedLists.set(root, { stamp, missions });
  return missions;
}

/**
 * One file out of a game's mission, base64 encoded and cached: a `.sd7` is
 * usually solid LZMA, so pulling one member can mean decompressing a large
 * block, and a redraw must not pay that twice.
 */
async function fileBase64(
  root: string,
  folder: string,
  file: string,
): Promise<string> {
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
    try {
      const missions = await missionList(game, archivePath);
      for (const mission of missions) {
        if (!mission.hasDocument) continue;
        const base64 = await fileBase64(
          archivePath,
          mission.folder,
          "scenario.json",
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
        found.push({
          scenario,
          source: "game",
          origin: {
            gameName: game.name,
            archivePath,
            folder: mission.folder,
            loose: isSdd(game.primaryArchive),
          },
        });
      }
    } catch (e) {
      console.warn("could not read missions from", game.name, e);
    }
  }
  return found;
}

/**
 * One of a mission's dialogue files as a `data:` URI, for coilbox's own panels.
 * The engine reads the archive itself, so this exists only so the app can draw a
 * portrait. Nothing is written to disk.
 */
export async function missionFileUrl(
  origin: GameOrigin,
  file: string,
): Promise<string> {
  const base64 = await fileBase64(origin.archivePath, origin.folder, file);
  return `data:application/octet-stream;base64,${base64}`;
}
