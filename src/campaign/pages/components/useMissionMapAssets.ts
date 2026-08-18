import { useEffect, useState } from "react";
import { type HeightGrid, readHeightGrid } from "@/placement/terrain";
import {
  useUnitsyncHeightField,
  useUnitsyncHeightmap,
  useUnitsyncMapSkybox,
  useUnitsyncMinimap,
} from "../../../content/config";
import { usePreferredTarget } from "../../../play/config";

/**
 * The worker's raw height grid, fetched once for everything that wants it.
 *
 * One read because there is one grid and two readers: the terrain the preview
 * displaces and the ground a building's verdict is worked out on (issue #1730).
 * Tens of megabytes on a large map, so a second fetch is not a rounding error.
 */
function useHeightGrid(
  src?: string,
  width?: number,
  height?: number,
): { grid: HeightGrid | null; read: boolean } {
  const [grid, setGrid] = useState<HeightGrid | null>(null);
  const [read, setRead] = useState(true);
  useEffect(() => {
    if (!src || !width || !height) {
      setGrid(null);
      setRead(true);
      return;
    }
    setRead(false);
    let cancelled = false;
    readHeightGrid(src, width, height)
      .then((got) => {
        if (cancelled) return;
        setGrid(got);
        setRead(true);
      })
      .catch(() => {
        if (cancelled) return;
        setGrid(null);
        setRead(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src, width, height]);
  return { grid, read };
}

/**
 * Resolve every {@link MapPreview3D} input for a mission's map by name, reusing the
 * content browser's unitsync hooks against the launcher's preferred target — the
 * same target `useMissionRun` scans for its install check, so a map that passes the
 * gate is exactly the one these assets resolve. Mirrors the `MapDetailPage` wiring
 * (minimap → diffuse + appearance, heightmap → displacement + world bounds, skybox
 * → sky), but keyed by the mission's `snapshot.mapName` rather than a page route.
 */
export function useMissionMapAssets(
  mapName: string,
  /**
   * Also read the map's raw heights, for a caller that has to say whether a
   * building will stand rather than only draw the relief (issue #1490). Tens of
   * megabytes on a large map, so a backdrop does not ask for it.
   */
  exactHeights = false,
) {
  const { target } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

  const minimap = useUnitsyncMinimap(enginePath, dataDir, mapName);
  const heightmap = useUnitsyncHeightmap(enginePath, dataDir, mapName);
  const heightField = useUnitsyncHeightField(
    enginePath,
    dataDir,
    exactHeights ? mapName : undefined,
  );
  const skybox = useUnitsyncMapSkybox(enginePath, dataDir, mapName);
  const heights = useHeightGrid(
    heightField.url ?? undefined,
    heightField.data?.width,
    heightField.data?.height,
  );

  const heightUrl = heightmap.url ?? undefined;
  const textureUrl = minimap.url ?? undefined;
  // Whether the raw heights were asked for and have settled one way or the
  // other, so an absent grid can be told from a read still in flight.
  const wordsSettled =
    !exactHeights ||
    (!heightField.loading && !!heightField.data && heights.read);
  // The heightmap alone is enough for a wireframe relief; a textured render also
  // needs the minimap diffuse.
  const width = heightmap.data?.width;
  const height = heightmap.data?.height;

  return {
    enginePath,
    dataDir,
    /**
     * The height picture, for a surface that draws terrain rather than
     * measuring it.
     *
     * Withheld from a caller that asked for the map's own words until that read
     * has settled, and then only offered if it came back with nothing. Handing
     * over both would build the whole scene from the picture and tear it down
     * again when the words landed, and that rebuild costs a second reflection
     * capture and a re-read of every model on the map.
     */
    heightSrc:
      exactHeights && (!wordsSettled || !!heights.grid) ? undefined : heightUrl,
    /** What the height picture's black and white stand for, which is not the
     *  map's own pair: it is rescaled into the window its samples occupy
     *  (issue #1730). */
    heightRange: heightmap.range,
    /** The map's own 16 bit heights, when they were asked for. Null on a map
     *  whose heights would not read, and until the read has finished. */
    heightWords: heights.grid,
    /** Whether the raw heights were asked for and have settled one way or the
     *  other, so an absent grid can be told from a read still in flight. */
    heightFieldRead: wordsSettled,
    textureSrc: textureUrl,
    appearance: minimap.appearance,
    /** The map's own team start positions, in elmos from its north-west corner,
     *  which is the space the scenario's own positions are in. */
    startPositions: minimap.startPositions,
    skyboxSrc: skybox.dataUrl,
    minHeight: heightmap.data?.minHeight ?? 0,
    maxHeight: heightmap.data?.maxHeight ?? 0,
    // World extent = (samples − 1) × 8 elmos, matching MapDetailPage.
    worldWidth: width ? (width - 1) * 8 : 0,
    worldHeight: height ? (height - 1) * 8 : 0,
    loading: minimap.loading || heightmap.loading,
    error: minimap.error || heightmap.error,
    /** Enough data to build a textured render. */
    ready: !!heightUrl && !!textureUrl,
    /** Enough data to build a wireframe relief (heightmap only). */
    heightReady: !!heightUrl,
  };
}
