import { MapPreview3D } from "../../../mapconv/pages/components/MapPreview3D";
import type { MapPreviewConfig } from "../../model";
import { useMissionMapAssets } from "./useMissionMapAssets";

/** Clamp the stored spin multiplier's magnitude to the editor's slider range,
 * keeping its sign (negative = reverse direction). Default 1. */
function clampSpin(v: number | undefined): number {
  const n = v ?? 1;
  const magnitude = Math.min(4, Math.max(0.25, Math.abs(n)));
  return n < 0 ? -magnitude : magnitude;
}

/**
 * The mission's map as the full-bleed briefing backdrop: a spinning, no-controls
 * 3D preview with the sky/skybox shown, filling its parent. While the map assets
 * load (or if they fail) it falls back to the same dark gradient the imageless
 * briefing uses, so the backdrop never flashes blank.
 */
export function MissionMapBackground({
  mapName,
  config,
}: {
  mapName: string;
  config: MapPreviewConfig;
}) {
  const assets = useMissionMapAssets(mapName);
  const wireframe = config.style === "heightmap";
  const ready = wireframe ? assets.heightReady : assets.ready;

  // A dark backing so a transparent render (a skyless wireframe, or a textured map
  // with no sky/skybox) still reads against something rather than the app chrome.
  return (
    <div className="h-full w-full bg-gradient-to-br from-slate-900 to-slate-950">
      {ready && (
        <MapPreview3D
          className="h-full w-full"
          framed={false}
          chrome={false}
          interactive={false}
          showSky
          forceWireframe={wireframe}
          autoSpin={clampSpin(config.spinSpeed)}
          initialWater={config.water}
          heightSrc={assets.heightSrc}
          textureSrc={assets.textureSrc}
          skyboxSrc={assets.skyboxSrc}
          appearance={assets.appearance}
          minHeight={assets.minHeight}
          maxHeight={assets.maxHeight}
          worldWidth={assets.worldWidth}
          worldHeight={assets.worldHeight}
        />
      )}
    </div>
  );
}

/**
 * The mission's map as the side graphic beside the briefing card: spinning, but
 * drag-to-rotate (the spin pauses while dragging), and with NO sky so the
 * transparent canvas layers over the panorama/backdrop. Renders nothing on error
 * (matching an absent still graphic); shows a soft skeleton while loading.
 */
export function MissionMapSideGraphic({
  mapName,
  config,
}: {
  mapName: string;
  config: MapPreviewConfig;
}) {
  const assets = useMissionMapAssets(mapName);
  const wireframe = config.style === "heightmap";
  const ready = wireframe ? assets.heightReady : assets.ready;

  if (assets.error) return null;
  if (!ready)
    return (
      <div className="h-full w-full animate-pulse rounded-lg bg-muted/10" />
    );

  return (
    <MapPreview3D
      className="h-full w-full"
      framed={false}
      chrome={false}
      interactive
      enableZoom={false}
      enablePan={false}
      showSky={false}
      skyboxSrc={null}
      forceWireframe={wireframe}
      autoSpin={clampSpin(config.spinSpeed)}
      initialWater={config.water}
      heightSrc={assets.heightSrc}
      textureSrc={assets.textureSrc}
      appearance={assets.appearance}
      minHeight={assets.minHeight}
      maxHeight={assets.maxHeight}
      worldWidth={assets.worldWidth}
      worldHeight={assets.worldHeight}
    />
  );
}
