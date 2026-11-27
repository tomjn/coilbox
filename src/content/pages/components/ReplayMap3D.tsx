import { useLingui } from "@lingui/react/macro";
import { type ComponentProps, type CSSProperties, useState } from "react";
import { HEAT_KIND_OF_LAYER } from "@/lib/heatRamp";
import type { MapScene3D } from "@/lib/mapScene";
import { useHeatmapLayer } from "@/lib/useHeatmapLayer";
import { MapPreview3D } from "../../../mapconv/pages/components/MapPreview3D";
import type { DemoInfo } from "../../bindings";
import { useUnitsyncMapSkybox } from "../../config";
import { useReplayMapLayers } from "../../useReplayMapLayers";
import { EventLayerNotes } from "./ReplayEventLayers";
import {
  HeatLegends,
  MAP_VIEW_HEIGHT,
  LayerSwitches,
  LayersHelp,
  MapHelp,
  ReadNotes,
  ReplayMapLayout,
  SCENE_LAYERS,
} from "./ReplayMapRail";

/** What `MapPreview3D` needs besides the scene hook and the sky. */
export type Preview3D = Omit<
  ComponentProps<typeof MapPreview3D>,
  "onScene" | "worldWidth" | "worldHeight" | "className" | "skyboxSrc"
>;

/**
 * The 3D mode of the replay's map card: the map as terrain, with the 3D view's
 * own options (water, wireframe, fullscreen) on the view itself. The layers
 * that paint on the ground, the two densities and deaths or damage, have their
 * switches and legends in the rail, and read through the time window.
 */
export function ReplayMap3D({
  info,
  replayPath,
  mapName,
  enginePath,
  dataDir,
  heightmap,
  preview,
}: {
  info: DemoInfo;
  replayPath: string | undefined;
  mapName: string;
  enginePath: string | undefined;
  dataDir: string | undefined;
  heightmap: { width?: number; height?: number } | null | undefined;
  preview: Preview3D;
}) {
  const { t } = useLingui();
  const layers = useReplayMapLayers({
    info,
    replayPath,
    heightmap,
    shown: SCENE_LAYERS,
  });
  const { ev, field, orderField, world } = layers;
  const skybox = useUnitsyncMapSkybox(enginePath, dataDir, mapName);

  const [handle, setHandle] = useState<MapScene3D | null>(null);
  // One 3D layer for each density, so two on at once are both on the terrain,
  // each in its own ramp. Layers at one depth are drawn in the order they were
  // made, so orders go first and the sparser buildings sit on top of them.
  useHeatmapLayer(handle, orderField, HEAT_KIND_OF_LAYER.orderDensity);
  useHeatmapLayer(handle, field, HEAT_KIND_OF_LAYER.density);
  useHeatmapLayer(handle, ev.field, HEAT_KIND_OF_LAYER.deaths);
  useHeatmapLayer(handle, ev.damageField, HEAT_KIND_OF_LAYER.damage);

  return (
    <ReplayMapLayout
      shape={null}
      map={
        <div
          data-map-3d
          style={{ "--map-view-height": MAP_VIEW_HEIGHT } as CSSProperties}
          className="relative h-(--map-view-height) w-full overflow-hidden rounded-md border border-border bg-gradient-to-b from-muted/20 to-muted/40"
        >
          <MapPreview3D
            {...preview}
            framed={false}
            skyboxSrc={skybox.dataUrl}
            worldWidth={world.worldWidth || 1}
            worldHeight={world.worldHeight || 1}
            onScene={setHandle}
          />
        </div>
      }
      rail={
        <>
          <MapHelp
            section={t`the 3D map`}
            source="stream"
            detail={t`The terrain comes from the map's own height data.`}
          >
            <LayersHelp layers={layers} info={info} flat={false} />
          </MapHelp>
          <div data-map-controls className="flex flex-col gap-3">
            <LayerSwitches layers={layers} only={SCENE_LAYERS} />
            <div data-map-notes className="flex flex-col gap-2">
              <EventLayerNotes ev={ev} />
              <ReadNotes layers={layers} />
              <HeatLegends layers={layers} />
            </div>
          </div>
        </>
      }
    />
  );
}
