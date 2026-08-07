//! Merging the content scan's tiers back into one map list.

import type { MapItem } from "./bindings";
import type { MapThumbData } from "./config";

/**
 * Put the later tiers back onto the scan's map list: proportions from the
 * thumbnail pass, mapinfo from the metadata pass. The scan itself carries only
 * names and archives, because reading either of these opens every map's archive
 * at about 86ms a map, which used to hold up the whole list.
 *
 * Both tiers arrive after the list, so a map with neither yet keeps its
 * undefined `width`/`height` and empty `info`. Callers already handle that:
 * `mapSizeLabel` returns null and the tag rows come out empty.
 */
export function mergeMapTiers(
  maps: MapItem[],
  thumbs: Map<string, MapThumbData>,
  meta: Map<string, Record<string, string>>,
): MapItem[] {
  if (thumbs.size === 0 && meta.size === 0) return maps;
  return maps.map((m) => {
    const thumb = thumbs.get(m.name);
    const info = meta.get(m.name);
    if (!thumb && !info) return m;
    return {
      ...m,
      width: thumb?.width ?? m.width,
      height: thumb?.height ?? m.height,
      info: info ?? m.info,
    };
  });
}
