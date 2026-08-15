import { useCallback, useMemo, useState } from "react";
import { useBarMap } from "@/downloads/config";
import {
  type HeldMapAsset,
  type MapPicture,
  mapPictureLadder,
  shownMapPicture,
} from "./picture";
import { assetCdnBase } from "./tier";

/**
 * The picture ladder for one map, assembled from what this session can see
 * (issue #1637). The order and the reasoning are in `./picture.ts`.
 *
 * `local` is whatever unitsync rendered, which the caller already has: every
 * screen that shows a map is holding a `useUnitsyncMinimap` result for its own
 * reasons, and asking for a second one here would render the same archive twice.
 *
 * BAR's list is only fetched when there is no local picture, which is what the
 * hook this replaced did. It is one request per session and memoised, but a
 * reader with the map installed has no use for it at all.
 *
 * `held` is what the hub holds for `(mapName, "minimap")`. Nothing passes it
 * yet: the hub has no public route that answers with a path. Issue #1686.
 */
export function useMapPictureLadder(
  mapName: string | undefined,
  local: string | null | undefined,
  held: HeldMapAsset | null = null,
): MapPicture[] {
  const bar = useBarMap(mapName && !local ? mapName : undefined);

  return useMemo(
    () =>
      mapPictureLadder({
        mapName: mapName ?? "",
        local,
        held,
        bar: bar?.images?.preview ?? null,
        size:
          bar?.mapWidth && bar?.mapHeight
            ? { width: bar.mapWidth, height: bar.mapHeight }
            : null,
        cdnBase: assetCdnBase(),
      }),
    [mapName, local, held, bar],
  );
}

/**
 * The rung to draw, and what to call when it fails to load.
 *
 * A picture that 404s or is refused demotes to the next rung rather than leaving
 * a broken image in the page, which is the whole reason the ladder is a list
 * rather than a single answer. The drawing at the bottom has no URL and so can
 * never fail, which is what makes this terminate.
 *
 * Failures are remembered by URL rather than by position, because the ladder is
 * rebuilt as its sources arrive and a remembered index would then point at a
 * different rung than the one that failed.
 */
export function useMapPictureRung(ladder: MapPicture[]): {
  picture: MapPicture;
  onError: () => void;
} {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const picture = shownMapPicture(ladder, failed);

  const onError = useCallback(() => {
    if (picture.from === "placeholder") return;
    const url = picture.url;
    setFailed((prev) => new Set(prev).add(url));
  }, [picture]);

  return { picture, onError };
}
