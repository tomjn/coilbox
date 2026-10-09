import type { ScanResult } from "./bindings";

/**
 * What the content scan knows about an archive, kept so a read of it can be
 * answered from the cache without starting a worker (issue #3714).
 *
 * The cache key is made from an archive's path, and for the maps that make up
 * nearly all of a library, from the map's name and the map file's name in its
 * archive. The scan already holds all of them. The size and modified time are
 * deliberately not here: the plugin reads those off the file itself each time, so
 * an archive changed since the scan is read again rather than answered from an
 * old entry.
 *
 * A read made before the scan has finished, or of something the scan does not
 * list, finds no hint and goes to a worker as it always did.
 */

interface TargetHints {
  /** Primary archive file name to its full path. */
  games: Map<string, string>;
  /** Map name to what its key is made from. */
  maps: Map<string, MapHint>;
}

export interface MapHint {
  /** The map's own archive, when its path resolved. Rare, since a map's archive
   *  is named by its versioned name and the path lookup wants a file name. */
  archivePath: string | undefined;
  /** The map file inside the archive, as the scan reported it. */
  fileName: string | undefined;
}

const hints = new Map<string, TargetHints>();

function targetKey(dataDir: string, enginePath: string): string {
  return `${dataDir}::${enginePath}`;
}

/** Keep what a scan of a target found, replacing any earlier scan of it. */
export function rememberScanHints(
  dataDir: string,
  enginePath: string,
  scan: ScanResult,
): void {
  const games = new Map<string, string>();
  for (const game of scan.games) {
    const { name, path } = game.primaryArchive;
    if (path) games.set(name, path);
  }
  const maps = new Map<string, MapHint>();
  for (const map of scan.maps) {
    maps.set(map.name, {
      archivePath: map.archives[0]?.path,
      fileName: map.fileName,
    });
  }
  hints.set(targetKey(dataDir, enginePath), { games, maps });
}

/** Forget one target, or every target when none is named. */
export function forgetScanHints(dataDir?: string, enginePath?: string): void {
  if (dataDir === undefined || enginePath === undefined) {
    hints.clear();
    return;
  }
  hints.delete(targetKey(dataDir, enginePath));
}

/** A game's primary archive path, when the scan of this target placed it. */
export function gameArchivePath(
  dataDir: string,
  enginePath: string,
  archiveName: string,
): string | undefined {
  return hints.get(targetKey(dataDir, enginePath))?.games.get(archiveName);
}

/** What a map's cache key is made from, when the scan of this target listed it. */
export function mapHint(
  dataDir: string,
  enginePath: string,
  mapName: string,
): MapHint | undefined {
  return hints.get(targetKey(dataDir, enginePath))?.maps.get(mapName);
}
