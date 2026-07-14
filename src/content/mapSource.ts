import type { SuggestedMap } from "./branding";

/**
 * BAR's HTTP map-search endpoint (`PRD_HTTP_SEARCH_URL`). It resolves both
 * BAR-exclusive maps and the classic springfiles catalogue it proxies, so it is
 * a safe default source for every curated map. Mirrors the local const used by
 * the downloads/replay/battle callers.
 */
export const BAR_SEARCH_URL = "https://files-cdn.beyondallreason.dev/find";

/**
 * Default a curated map's search source to BAR when the catalog entry omits
 * `searchUrl`. Without it the sidecar falls back to springfiles' default search,
 * which does not serve BAR springnames and exits non-zero — so an author omitting
 * `searchUrl` would otherwise ship a silently-broken card. Set `searchUrl`
 * explicitly on an entry to force a different source.
 *
 * Pure and free of the plugin-command imports in `./branding`, so it stays unit
 * testable (the type import above is erased at build time).
 */
export function withMapSource(m: SuggestedMap): SuggestedMap {
  if (m.download.kind !== "map" || m.download.searchUrl?.trim()) return m;
  return { ...m, download: { ...m.download, searchUrl: BAR_SEARCH_URL } };
}
