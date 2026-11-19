/**
 * Telling the hub that a map or game finished downloading, so it can show how
 * many times each has been downloaded. Like the import count in `./importCount`,
 * it carries no account, no token and no identifier. The map route takes the
 * map's name as JSON, the game route takes nothing but the shortname in its
 * address, and nothing here reads the answer.
 *
 * It runs from the queue's success branch, so every download that finished
 * counts, whether a player clicked it or the lobby or onboarding started it.
 * Engines send nothing.
 *
 * The off switches are the import count's: no trusted hub (the base the queue
 * already reads, `getHubMapBase`, is null when the profile switched the hub off)
 * and `isHubImportCountEnabled()`.
 *
 * Maps are named by the request: a map name, or a `mapName` a file request
 * carries when its caller knows one. A hub game carries its shortname. A rapid
 * request is matched to the one hub game listing its tag in the games list the
 * client already holds (`heldHubGames`). A game archive name is matched exactly
 * against the hub catalogue the mismatch check holds (`gameShortnameFor`).
 * Anything that matches nothing, or more than one game, sends nothing, since a
 * wrong count is worse than a missing one.
 */

import { isHubImportCountEnabled } from "@/profile/profile";
import type { EnqueueInput } from "../downloads/DownloadQueueProvider";
import { getHubMapBase } from "../downloads/hubMapBase";
import { gameShortnameFor } from "../downloads/hubMismatch";
import type { HubGame } from "./api";
import { heldHubGames } from "./gameIcons";

function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

/** Where to report a map download. Same prefix handling as `importCountUrl`. */
export function mapDownloadedUrl(base: string): string {
  return `${trimBase(base)}/api/v1/maps/downloaded`;
}

/** Where to report a game download. */
export function gameDownloadedUrl(base: string, shortname: string): string {
  return `${trimBase(base)}/api/v1/games/${encodeURIComponent(shortname)}/downloaded`;
}

/**
 * The hub game a rapid request stands for: the one game that lists that tag.
 * Two games listing it, or none, is no answer.
 */
function hubGameForTag(
  tag: string,
  games: readonly HubGame[],
): HubGame | undefined {
  const found = games.filter((g) =>
    (g.downloads ?? []).some((d) => d.kind === "rapid" && d.value === tag),
  );
  return found.length === 1 ? found[0] : undefined;
}

/**
 * The hub shortname a game request carries or can be matched to, or undefined.
 * A `game` request names an archive, which is looked up exactly in the hub's
 * catalogue, so it can fetch that catalogue once. It rejects when that fails.
 */
async function shortnameFor(
  base: string,
  req: EnqueueInput,
): Promise<string | undefined> {
  if (req.kind === "hubGame") return req.args.shortname || undefined;
  if (req.kind === "game") return gameShortnameFor(base, req.args.gameName);
  if (req.kind !== "rapid") return undefined;
  const games = heldHubGames(base);
  return games ? hubGameForTag(req.args.tag, games)?.shortname : undefined;
}

/** The map a request names, or undefined. */
function mapNameFor(req: EnqueueInput): string | undefined {
  const name =
    req.kind === "mapAnySource"
      ? req.args.mapName
      : req.kind === "map"
        ? req.args.springName
        : req.kind === "file"
          ? req.args.mapName
          : undefined;
  return name?.trim() ? name : undefined;
}

/**
 * Report that `req` finished downloading, and forget about it. Returns before
 * anything is sent, never throws and never waits, so a hub that is slow or down
 * cannot touch the queue.
 */
export function reportDownload(req: EnqueueInput): void {
  try {
    const base = getHubMapBase();
    if (!base || !isHubImportCountEnabled()) return;

    const mapName = mapNameFor(req);
    if (mapName) {
      void fetch(mapDownloadedUrl(base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: mapName }),
      }).catch(() => undefined);
      return;
    }

    void shortnameFor(base, req)
      .then((shortname) => {
        if (!shortname) return;
        return fetch(gameDownloadedUrl(base, shortname), { method: "POST" });
      })
      .catch(() => undefined);
  } catch {
    // A ping must never affect the download that triggered it.
  }
}
