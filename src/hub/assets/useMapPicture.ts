import { useCallback, useEffect, useMemo, useState } from "react";
import { isHubEnabled } from "@/profile/profile";
import { useHubUrl } from "../config";
import { heldMapAsset, heldPicture } from "./heldPictures";
import {
  type HeldMapAsset,
  type MapPicture,
  mapPictureLadder,
  shownMapPicture,
} from "./picture";
import { assetCdnBase } from "./tier";
import { MINIMAP_VARIANT } from "./vocabulary";

/**
 * What the hub holds for `(mapName, "minimap")`, or null while it has not
 * answered, could not be reached, or holds nothing (issue #1687).
 *
 * The request is assembled in `./heldPictures.ts`, which turns a screen of maps
 * asking one at a time into one request. A profile that switched the hub off
 * asks it nothing, which is the one place a picture would otherwise reach a hub
 * the distributor turned off: the browse screen is unreachable without it, and
 * a battle room is not.
 */
export function useHeldMapPicture(
  mapName: string | undefined,
): HeldMapAsset | null {
  const hubUrl = useHubUrl();
  const [held, setHeld] = useState<HeldMapAsset | null>(null);

  useEffect(() => {
    setHeld(null);
    if (!mapName || !isHubEnabled()) return;
    let live = true;
    heldPicture(hubUrl, {
      keyed_on: "map",
      map_name: mapName,
      variant: MINIMAP_VARIANT,
    }).then((picture) => {
      if (live) setHeld(heldMapAsset(picture));
    });
    return () => {
      live = false;
    };
  }, [hubUrl, mapName]);

  return held;
}

/**
 * The picture ladder for one map, assembled from what this session can see
 * (issue #1637). The order and the reasoning are in `./picture.ts`.
 *
 * `local` is whatever unitsync rendered, which the caller already has: every
 * screen that shows a map is holding a `useUnitsyncMinimap` result for its own
 * reasons, and asking for a second one here would render the same archive twice.
 *
 * The hub is only asked when there is no local picture. An installed archive
 * wins the ladder outright, so a reader with the map has no use for the answer,
 * and it is a request somebody else pays for.
 *
 * No size is passed, so the drawing at the bottom is square for every map it
 * has to draw. It used to be shaped from BAR's map list, which is the only
 * source coilbox can reach that knows the proportions of a map nobody here has
 * installed. Reading that list is a dependency on BAR's infrastructure for a
 * rectangle, and the trade went the other way: a square placeholder is the
 * accepted cost. The hub is where the real shape comes back from, once a seeded
 * minimap answers instead of the drawing.
 */
export function useMapPictureLadder(
  mapName: string | undefined,
  local: string | null | undefined,
): MapPicture[] {
  const held = useHeldMapPicture(mapName && !local ? mapName : undefined);

  return useMemo(
    () =>
      mapPictureLadder({
        mapName: mapName ?? "",
        local,
        held,
        cdnBase: assetCdnBase(),
      }),
    [mapName, local, held],
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
