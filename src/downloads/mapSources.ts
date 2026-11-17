/**
 * Download source ordering for maps (issue #511, following #500's game ordering).
 *
 * Project policy: fetch content from the hub's sources, then known mirrors, and fall back to
 * pr-downloader (rapid) only as a last resort. This module is the map
 * counterpart to `gameSources.ts`, kept pure so it can be unit-tested without
 * touching Tauri. `downloadMapAnySource` (in `downloadMap.ts`) consumes it.
 *
 * Every source here is springfiles-backed, directly or through pr-downloader's
 * own default search. Beyond All Reason's `files-cdn` search used to sit at the
 * end of the rapid step and is gone. `downloadMap.ts` carries why.
 */

export type MapSource =
  | "hub"
  | "springfiles"
  | "hakora"
  | "evolutionrts"
  | "rapid";

/**
 * The sources to try, in order, for a map.
 *
 * - `hub`: the sources the hub lists for the map (issue #5251), each tried in the
 *   hub's order. First, because the author's own repository or a mirror the hub
 *   knows holds the archive is a better source than the catalogues below, and
 *   this is a deliberate change to the order #511 set. Only present when the hub
 *   listed some, and it needs a write root.
 * - `evolutionrts`: the maps.evolutionrts.info mirror of maps first made for
 *   Beyond All Reason (direct download). Needs a write root. First because its
 *   list is one small JSON file, where springfiles sends its whole catalogue.
 * - `springfiles`: the springfiles catalog mirror (direct download). Needs a
 *   write root.
 * - `hakora`: the hakora.xyz maps mirror (direct download). Needs a write root.
 * - `rapid`: pr-downloader on its default (springfiles) search. Always the final
 *   fallback, and the only step that works without a write root.
 */
export function mapSourceOrder(opts: {
  hasWritePath: boolean;
  hasHubSources?: boolean;
}): MapSource[] {
  const order: MapSource[] = [];
  if (opts.hasWritePath && opts.hasHubSources) order.push("hub");
  if (opts.hasWritePath) order.push("evolutionrts", "springfiles", "hakora");
  order.push("rapid");
  return order;
}
