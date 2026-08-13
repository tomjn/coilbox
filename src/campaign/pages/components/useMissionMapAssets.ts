import {
  useUnitsyncHeightField,
  useUnitsyncHeightmap,
  useUnitsyncMapSkybox,
  useUnitsyncMinimap,
} from "../../../content/config";
import { usePreferredTarget } from "../../../play/config";

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

  const heightUrl = heightmap.url ?? undefined;
  const textureUrl = minimap.url ?? undefined;
  // The heightmap alone is enough for a wireframe relief; a textured render also
  // needs the minimap diffuse.
  const width = heightmap.data?.width;
  const height = heightmap.data?.height;

  return {
    enginePath,
    dataDir,
    heightSrc: heightUrl,
    /** The map's own heights, when they were asked for: the file, and the grid
     *  it holds. Undefined until the write has finished, and on a map whose
     *  heights would not read. */
    heightFieldSrc: heightField.url ?? undefined,
    heightFieldWidth: heightField.data?.width,
    heightFieldHeight: heightField.data?.height,
    /** Whether the raw heights were asked for and have settled one way or the
     *  other, so an absent grid can be told from a read still in flight. */
    heightFieldRead:
      !exactHeights || (!heightField.loading && !!heightField.data),
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
