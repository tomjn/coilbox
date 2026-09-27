import { useEffect, useState } from "react";
import type { SuggestedMapList } from "@/content/branding";
import { isHubEnabled } from "@/profile/profile";
import { fetchHubMapPacks, type HubMapPack } from "../api";
import { useHubUrl } from "../config";

/**
 * Featured map packs from the hub, shown alongside the branding catalog's
 * packs in the same "Map packs" menu (issue #3143).
 *
 * The hub has no `/api/v1/map-packs` route yet - see the doc comment on
 * {@link HubMapPack} in `../api` for what a client asks it for once it does.
 * Until then `fetchHubMapPacks` always comes back `ok: false`, which this
 * hook reads the same way it would read a hub that is offline or waking up:
 * as no packs, not an error. The branding catalog's packs are curated by
 * coilbox itself and must keep showing whatever the hub is doing, so nothing
 * here is ever surfaced to the reader - that's `MapPacksBanner`'s job to
 * decide, and it decides nothing, by never being told.
 */
export function hubMapPackToList(pack: HubMapPack): SuggestedMapList {
  return {
    id: pack.id,
    title: pack.title,
    blurb: pack.blurb,
    maps: pack.maps,
  };
}

/**
 * The hub's currently featured map packs, converted to {@link SuggestedMapList}
 * so they merge and install exactly like a branding catalog pack (see
 * `downloads/mapLists.ts`'s `mergeMapLists` and `suggestedMapToInput`).
 *
 * Gated on `isHubEnabled()` the same way `useMapPictureLadder` gates its own
 * hub read: a distribution that switched the hub off asks it nothing.
 */
export function useFeaturedHubMapPacks(): SuggestedMapList[] {
  const hubUrl = useHubUrl();
  const [packs, setPacks] = useState<SuggestedMapList[]>([]);

  useEffect(() => {
    setPacks([]);
    if (!isHubEnabled()) return;
    let live = true;
    const controller = new AbortController();
    fetchHubMapPacks(hubUrl, controller.signal).then((result) => {
      if (!live) return;
      if (!result.ok) return;
      setPacks(
        result.value.filter((pack) => pack.featured).map(hubMapPackToList),
      );
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [hubUrl]);

  return packs;
}
