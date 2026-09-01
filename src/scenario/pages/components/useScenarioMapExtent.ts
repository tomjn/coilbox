/**
 * How big the map a scenario is set on is, so the validator can say a position
 * is past its far edge as well as before its near one.
 *
 * The same unitsync read the editing surface already makes, and cached with it,
 * so asking costs nothing extra. A map that has not answered yet leaves the
 * extent out rather than holding anything up, which drops the far-edge half of
 * the check until it lands.
 *
 * One hook for the editor header and the test drawer, because a count that
 * disagrees with what Test then says about the same document is worse than no
 * count at all.
 */

import { useMemo } from "react";
import { useUnitsyncHeightmap } from "@/content/config";
import { usePreferredTarget } from "@/play/config";
import type { MapExtent } from "../../validate";

export function useScenarioMapExtent(mapName: string): MapExtent | undefined {
  const { target } = usePreferredTarget();
  const heightmap = useUnitsyncHeightmap(
    target?.enginePath,
    target?.dataDir,
    mapName,
  );
  const samplesX = heightmap.data?.width;
  const samplesZ = heightmap.data?.height;
  // World extent = (samples - 1) x 8 elmos, as `useMissionMapAssets` reports it.
  // Memoised because a caller validates on it changing, and a fresh object every
  // render would be a fresh reason to validate every render.
  return useMemo(
    () =>
      samplesX && samplesZ
        ? { width: (samplesX - 1) * 8, height: (samplesZ - 1) * 8 }
        : undefined,
    [samplesX, samplesZ],
  );
}
