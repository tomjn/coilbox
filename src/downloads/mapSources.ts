/**
 * Download source ordering for maps (issue #511, following #500's game ordering).
 *
 * Project policy: fetch content from known mirrors first, and fall back to
 * pr-downloader (rapid) only as a last resort. This module is the map
 * counterpart to `gameSources.ts`, kept pure so it can be unit-tested without
 * touching Tauri. `downloadMapAnySource` (in `downloadMap.ts`) consumes it.
 *
 * Tradeoff worth naming: pr-downloader's map search already reaches a BAR mirror
 * through the sidecar (the `BAR_SEARCH_URL` search override hits BAR's files-cdn),
 * so for a common BAR map, putting the springfiles/hakora catalog fetches ahead of
 * it adds two lookups that usually miss before falling through to the search that
 * would have worked immediately. This ordering accepts that cost for policy
 * consistency with games (mirrors first, rapid last, always) rather than special-
 * casing BAR maps to keep rapid first.
 */

export type MapSource = "springfiles" | "hakora" | "rapid";

/**
 * The sources to try, in order, for a map.
 *
 * - `springfiles`: the springfiles catalog mirror (direct download). Needs a
 *   write root.
 * - `hakora`: the hakora.xyz maps mirror (direct download). Needs a write root.
 * - `rapid`: pr-downloader, tried with both the default (springfiles) search and
 *   the BAR files-cdn search. Always the final fallback, and the only step that
 *   works without a write root.
 */
export function mapSourceOrder(opts: { hasWritePath: boolean }): MapSource[] {
  const order: MapSource[] = [];
  if (opts.hasWritePath) order.push("springfiles", "hakora");
  order.push("rapid");
  return order;
}
