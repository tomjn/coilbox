/**
 * Download source ordering for maps (issue #511, following #500's game ordering).
 *
 * Project policy: fetch content from known mirrors first, and fall back to
 * pr-downloader (rapid) only as a last resort. This module is the map
 * counterpart to `gameSources.ts`, kept pure so it can be unit-tested without
 * touching Tauri. `downloadMapAnySource` (in `downloadMap.ts`) consumes it.
 *
 * Every source here is springfiles-backed, directly or through pr-downloader's
 * own default search. Beyond All Reason's `files-cdn` search used to sit at the
 * end of the rapid step and is gone. `downloadMap.ts` carries why.
 */

export type MapSource = "springfiles" | "hakora" | "rapid";

/**
 * The sources to try, in order, for a map.
 *
 * - `springfiles`: the springfiles catalog mirror (direct download). Needs a
 *   write root.
 * - `hakora`: the hakora.xyz maps mirror (direct download). Needs a write root.
 * - `rapid`: pr-downloader on its default (springfiles) search. Always the final
 *   fallback, and the only step that works without a write root.
 */
export function mapSourceOrder(opts: { hasWritePath: boolean }): MapSource[] {
  const order: MapSource[] = [];
  if (opts.hasWritePath) order.push("springfiles", "hakora");
  order.push("rapid");
  return order;
}
