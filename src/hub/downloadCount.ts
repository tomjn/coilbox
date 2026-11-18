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
 * Maps are named by the request. Games are not: a `hubGame` request holds the
 * hub's download sources, a `rapid` one a tag and a `game` one an archive name,
 * and none of them holds the hub's shortname. They are matched against the games
 * list the client already holds (`heldHubGames`), with no extra fetch. A game
 * that matches nothing, or more than one hub game, sends nothing, since a wrong
 * count is worse than a missing one.
 */

import { isHubImportCountEnabled } from "@/profile/profile";
import { stripVersion } from "../career/games";
import type { EnqueueInput } from "../downloads/DownloadQueueProvider";
import { getHubMapBase } from "../downloads/hubMapBase";
import type { HubGame, HubGameDownload } from "./api";
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

const sourceKey = (d: HubGameDownload) => `${d.kind}:${d.value}`;

/** The one game `matches` picks out, or undefined for none or several. */
function only(
  games: readonly HubGame[],
  matches: (g: HubGame) => boolean,
): HubGame | undefined {
  const found = games.filter(matches);
  return found.length === 1 ? found[0] : undefined;
}

/**
 * The hub game a game request stands for. A `hubGame` request carries the hub's
 * own sources, so it matches the game whose sources are the same set whatever
 * order a pin put them in. A `rapid` request matches the game that lists its tag.
 * A `game` request names an archive, which matches a game whose title or
 * shortname it is once the version is cut off. Anything else names no game.
 */
function hubGameFor(
  req: EnqueueInput,
  games: readonly HubGame[],
): HubGame | undefined {
  switch (req.kind) {
    case "hubGame": {
      const wanted = new Set(req.args.downloads.map(sourceKey));
      if (wanted.size === 0) return undefined;
      return only(games, (g) => {
        const have = new Set((g.downloads ?? []).map(sourceKey));
        return (
          have.size === wanted.size && [...wanted].every((k) => have.has(k))
        );
      });
    }
    case "rapid":
      return only(games, (g) =>
        (g.downloads ?? []).some(
          (d) => d.kind === "rapid" && d.value === req.args.tag,
        ),
      );
    case "game": {
      const name = stripVersion(req.args.gameName).toLowerCase();
      if (!name) return undefined;
      return only(
        games,
        (g) =>
          g.title.toLowerCase() === name || g.shortname.toLowerCase() === name,
      );
    }
    default:
      return undefined;
  }
}

/**
 * The map a request names, or undefined. A `file` request names a url and a
 * filename, not a map, so it counts for nothing.
 */
function mapNameFor(req: EnqueueInput): string | undefined {
  const name =
    req.kind === "mapAnySource"
      ? req.args.mapName
      : req.kind === "map"
        ? req.args.springName
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

    const games = heldHubGames(base);
    const game = games && hubGameFor(req, games);
    if (!game) return;
    void fetch(gameDownloadedUrl(base, game.shortname), {
      method: "POST",
    }).catch(() => undefined);
  } catch {
    // A ping must never affect the download that triggered it.
  }
}
