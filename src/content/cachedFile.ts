/**
 * Trusting a session's memory of a unitsync worker cache file.
 *
 * The session caches in `config.ts` remember the file name the worker answered
 * with and never ask again, which cost nothing while nothing ever removed a
 * cache file. The thumb cache is swept now (issues #1535 and #1550), so a name
 * can outlive its file: the picture goes blank, or the terrain check reads no
 * heights, and it stays that way until the app is restarted (issue #1551).
 *
 * So a session hit is checked before it is used, and a name whose file has gone
 * is forgotten, which sends the caller back to the worker to write it again.
 */

import { unitsyncThumbUrl } from "../lib/assetUrl";

/**
 * Whether the thumb cache still holds `file`.
 *
 * Asks the asset protocol for the first byte, so the answer costs a stat rather
 * than a read of a height grid that runs to tens of megabytes. `no-store`
 * because these URLs are served `immutable`, and a webview answering out of its
 * own cache would say a file is there when it is not.
 *
 * Only a 404 is a missing file. Anything else, including a request that fails
 * outright, is no answer, and the caller keeps what it had: reading no answer as
 * gone would send every thumbnail on the page back to the worker, and each of
 * those is a subprocess.
 */
export async function thumbFileExists(file: string): Promise<boolean> {
  try {
    const res = await fetch(unitsyncThumbUrl(file), {
      cache: "no-store",
      headers: { Range: "bytes=0-0" },
    });
    return res.status !== 404;
  } catch {
    return true;
  }
}

/**
 * The value `cache` holds for `key`, or undefined when it holds none or when the
 * file it names has gone. A name that has gone is dropped on the way out, so the
 * caller's own miss path writes a fresh one.
 *
 * A value that names no file inlined its bytes instead and has nothing on disk
 * to lose.
 */
export async function liveCacheHit<T>(
  cache: Map<string, T>,
  key: string,
  fileOf: (value: T) => string | undefined,
): Promise<T | undefined> {
  const hit = cache.get(key);
  if (!hit) return undefined;
  const file = fileOf(hit);
  if (!file) return hit;
  if (await thumbFileExists(file)) return hit;
  cache.delete(key);
  return undefined;
}
