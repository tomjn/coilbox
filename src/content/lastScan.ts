import {
  type ScanResult,
  unitsyncLastScanRead,
  unitsyncLastScanWrite,
} from "./bindings";

/**
 * The last good scan of each engine and content folder, kept on disk so the Maps
 * and Games pages have a list to show before the live scan returns (issue #3715).
 *
 * This is a first paint and nothing else. It can name an archive deleted since,
 * so it is deliberately not part of `scanCache`: nothing that decides whether
 * content is installed reads it. Only `useScanWithLastKnown` does.
 */

/** Keyed like `scanCache`. Holds the one read per target for the session. */
const saved = new Map<string, Promise<ScanResult | null>>();

const key = (enginePath: string, dataDir: string) =>
  `${dataDir}::${enginePath}`;

function isScan(value: unknown): value is ScanResult {
  const v = value as Partial<ScanResult> | null;
  return !!v && Array.isArray(v.maps) && Array.isArray(v.games);
}

/** The saved scan for a target, or null when there is none or it cannot be read. */
export function readLastScan(
  enginePath: string,
  dataDir: string,
): Promise<ScanResult | null> {
  const k = key(enginePath, dataDir);
  let read = saved.get(k);
  if (!read) {
    read = (async () => {
      try {
        const scan = await unitsyncLastScanRead({ enginePath, dataDir });
        return isScan(scan) ? scan : null;
      } catch {
        return null;
      }
    })();
    saved.set(k, read);
  }
  return read;
}

/**
 * Save a scan that succeeded. Best effort: a scan that could not be saved is
 * still a good scan, so a failure is dropped and the next launch has no first paint.
 */
export function writeLastScan(
  enginePath: string,
  dataDir: string,
  scan: ScanResult,
): void {
  saved.set(key(enginePath, dataDir), Promise.resolve(scan));
  void (async () => {
    try {
      await unitsyncLastScanWrite({ enginePath, dataDir, scan });
    } catch {
      // Nothing to do. The live scan already answered.
    }
  })();
}
