import { isSddName } from "../../content/format";
import { createPersistedCache } from "../../lib/persistedCache";
import type { ArchiveGame, ArchiveTarget } from "./archive";
import type { HandmadeMapError } from "./errors";

/**
 * What reading inside one game archive found: the hand-made map folders, the
 * `index.json` flag, and the member paths under `coilbox/maps/`. Both the
 * Conquest list and the "Generate a map" drawer are built from this record,
 * so they cannot disagree about a game.
 *
 * It lives in the app settings under {@link ARCHIVE_CACHE_KEY}, which is saved
 * to the app data directory, and holds one entry per installed packaged game.
 *
 * Invalidation:
 * - A packaged archive (`.sdz`, `.sd7`, `.sdp`) is a new file name when its
 *   game updates, so the key is the data directory, the archive file name, and
 *   the size and CRC the content scan gave it. An entry is kept for good until
 *   the game is gone, and is dropped at the end of the next full search that
 *   does not list the archive.
 * - A loose `.sdd` folder can be edited in place under the same name, so it is
 *   never stored. {@link listingKey} gives it no key. It is read again whenever
 *   the content is rescanned, because a rescan makes a new archive reader.
 * - A change to what is read or stored here raises {@link ARCHIVE_CACHE_VERSION},
 *   and every stored entry is then ignored.
 */
export const ARCHIVE_CACHE_KEY = "conquest.archiveListings";
export const ARCHIVE_CACHE_VERSION = 1;

/** One game's archive, as stored. The game itself is attached on the way out. */
export interface CachedListing {
  items: { folder: string; files: string[]; manifest: string }[];
  unreadable: { folder: string; errors: HandmadeMapError[] }[];
  /** Whether `index.json` asks for the game's own maps only. */
  onlyOwnMaps: boolean;
  /** The real path of every member under `coilbox/maps/`. */
  members: string[];
}

const cache = createPersistedCache<CachedListing>(
  ARCHIVE_CACHE_KEY,
  ARCHIVE_CACHE_VERSION,
);

/**
 * The key a game's listing is stored under, or null for a loose `.sdd` folder,
 * which is never stored.
 */
export function listingKey(
  target: ArchiveTarget,
  game: ArchiveGame,
): string | null {
  if (isSddName(game.archive)) return null;
  return [
    target.dataDir,
    game.archive,
    game.size ?? "",
    game.checksum ?? "",
  ].join("\0");
}

export const cachedListing = cache.get;
export const rememberListing = cache.set;

/** Write what was learned to the settings store, dropping what `keep` leaves out. */
export const saveListings = cache.save;
