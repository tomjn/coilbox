import { useLingui } from "@lingui/react/macro";
import {
  type ComponentProps,
  type CSSProperties,
  useMemo,
  useRef,
  useState,
} from "react";
import { HEAT_KIND_OF_LAYER } from "@/lib/heatRamp";
import type { MapScene3D } from "@/lib/mapScene";
import { useHeatmapLayer } from "@/lib/useHeatmapLayer";
import { fieldFromGrid } from "@/placement/terrain";
import { useHeightGrid } from "@/placement/useHeightGrid";
import { MapPreview3D } from "../../../mapconv/pages/components/MapPreview3D";
import type { ExpandBounds } from "../../../mapconv/pages/components/useExpandedFrame";
import type { DemoInfo } from "../../bindings";
import { useUnitsyncHeightField, useUnitsyncMapSkybox } from "../../config";
import type { ReplayTrackHandle } from "../../replayTrack";
import { useUnitMapExplosions } from "../../unitMapExplosions";
import { useReplayMapLayers } from "../../useReplayMapLayers";
import { useUnitDots3d } from "../../useUnitDots3d";
import { useUnitMapIcons } from "../../useUnitMapIcons";
import { useUnitMapStyles } from "../../useUnitMapStyles";
import { EventLayerNotes } from "./ReplayEventLayers";
import {
  HeatLegends,
  LayerSwitches,
  LayersHelp,
  MAP_VIEW_HEIGHT,
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

/** Set by `ReplayDetailPage` on its content area and by `ReplayTimelineDock`
 *  on the dock. */
const REPLAY_CONTENT_ATTRIBUTE = "data-replay-content";
const REPLAY_DOCK_ATTRIBUTE = "data-replay-dock";

const NO_TEAMS: ReplayTrackHandle["header"]["teams"] = [];
const NO_UNIT_DEFS: readonly string[] = [];

/**
 * The 3D mode of the replay's map card: the map as terrain, with the 3D view's
 * own options (water, wireframe, fullscreen) on the view itself. The layers
 * that paint on the ground, the two densities and deaths or damage, have their
 * switches and legends in the rail, and read through the time window.
 *
 * The recorded units stand on the terrain as the game's map icons in their
 * team's colour, at the page's match clock, and as dots where there is none. They are drawn from `track`, the handle the card
 * holds open for the flat map too.
 */
export function ReplayMap3D({
  info,
  replayPath,
  mapName,
  enginePath,
  dataDir,
  heightmap,
  preview,
  track,
}: {
  info: DemoInfo;
  replayPath: string | undefined;
  mapName: string;
  enginePath: string | undefined;
  dataDir: string | undefined;
  heightmap: { width?: number; height?: number } | null | undefined;
  preview: Preview3D;
  /** The open track once the match clock has its range, else null and no units
   *  are drawn. */
  track: ReplayTrackHandle | null;
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

  // Maximised, the view fills the page's content area above the timeline dock,
  // so the app's bars stay and the clock can still be played and scrubbed.
  const frameRef = useRef<HTMLDivElement | null>(null);
  const expandBounds = useMemo<ExpandBounds>(() => {
    const content = () =>
      frameRef.current?.closest(`[${REPLAY_CONTENT_ATTRIBUTE}]`) ?? null;
    return {
      content,
      below: () =>
        content()?.querySelector(`[${REPLAY_DOCK_ATTRIBUTE}]`) ?? null,
    };
  }, []);
  // One 3D layer for each density, so two on at once are both on the terrain,
  // each in its own ramp. Layers at one depth are drawn in the order they were
  // made, so orders go first and the sparser buildings sit on top of them.
  useHeatmapLayer(handle, orderField, HEAT_KIND_OF_LAYER.orderDensity);
  useHeatmapLayer(handle, field, HEAT_KIND_OF_LAYER.density);
  useHeatmapLayer(handle, ev.field, HEAT_KIND_OF_LAYER.deaths);
  useHeatmapLayer(handle, ev.damageField, HEAT_KIND_OF_LAYER.damage);

  // The dots stand on the map's own 16 bit heights, which the terrain's
  // displacement picture only approximates. Without them there are no dots,
  // because a dot at a guessed height would sit inside a hill.
  const heightField = useUnitsyncHeightField(enginePath, dataDir, mapName);
  const heights = useHeightGrid(
    heightField.url ?? undefined,
    heightField.data?.width,
    heightField.data?.height,
  );
  const ground = useMemo(
    () =>
      heights.grid && world.worldWidth > 0 && world.worldHeight > 0
        ? {
            field: fieldFromGrid(heights.grid),
            worldWidth: world.worldWidth,
            worldHeight: world.worldHeight,
            minHeight: preview.minHeight,
            maxHeight: preview.maxHeight,
          }
        : null,
    [
      heights.grid,
      world.worldWidth,
      world.worldHeight,
      preview.minHeight,
      preview.maxHeight,
    ],
  );
  const teams = useUnitMapStyles(
    info,
    replayPath,
    track?.header.teams ?? NO_TEAMS,
  );
  const icons = useUnitMapIcons(
    info,
    track?.header.unitDefs ?? NO_UNIT_DEFS,
    track !== null,
  );
  // The flat map's Explosions switch, so a choice there holds here too.
  const [explosions] = useUnitMapExplosions();
  useUnitDots3d(handle, track, teams, ground, icons, explosions);

  return (
    <ReplayMapLayout
      shape={null}
      map={
        <div
          ref={frameRef}
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
            expandBounds={expandBounds}
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
