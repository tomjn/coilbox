/**
 * A layout stood on a real map, to see what the terrain would refuse (issue
 * #1457).
 *
 * The optional step on top of the standalone editor. That editor draws on a
 * build grid and must never need a map (issue #1416): a blueprint is a shape
 * rather than a place, it is not made for one map, and reading a map is the
 * slowest thing in coilbox. So this is a separate surface, opened by asking for
 * it, and closing it puts the page back to a library that has read no map at
 * all.
 *
 * Nothing about the check is new here. The ground comes from the same
 * `useMissionMapAssets` the scenario editor's map does, the verdicts are the
 * same `standsOn` over the same raw heights, and the notes under it are the same
 * `LayoutNotes` a base on a map gets. What this adds is the pair the library
 * cannot supply: which map, and where on it.
 *
 * Read-only about the layout. Nothing here writes a building, because the
 * question being asked is what this shape does on that ground rather than what
 * shape to draw. The one thing that moves is the whole layout, to a spot the
 * author clicks or drags it to.
 *
 * The arithmetic is `mapCheck.ts`, which is tested. This file is the wiring.
 */

import { Button } from "@picoframe/frame";
import { Loader2, MapPin, MountainSnow, Unplug, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import type { BaseBlueprint } from "@/blueprint/model";
import { useMissionMapAssets } from "@/campaign/pages/components/useMissionMapAssets";
import { useUnitsyncScan, useUnitsyncThumbnails } from "@/content/config";
import { useGameUnits } from "@/content/useGameUnits";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import { usePreferredTarget } from "@/play/config";
import { MapPickerDrawer } from "@/play/pages/components/MapPickerDrawer";
import type { Point } from "@/scenario/model";
import { strayDefs } from "@/scenario/pages/components/bases";
import { BLUEPRINT_BASE_ID, blueprintDocument } from "./blueprintDocument";
import { layoutFraming } from "./ground";
import { LayoutNotes, UncheckedNote, WaterlessNote } from "./LayoutControls";
import { checkMapFor, checkSpot, spotSentence } from "./mapCheck";
import { PlacementSurface, SurfaceMessage } from "./PlacementSurface";
import {
  absentIn,
  baseFootprints,
  noSlopeIn,
  overlappingIn,
  sceneUnchecked,
  sceneWaterless,
  tooDeepIn,
  tooShallowIn,
  unstableIn,
} from "./placements";
import {
  focusCamera,
  focusDistance,
  mapSceneStatus,
  worldToScene,
} from "./scene";
import { useMapEditing } from "./useMapEditing";
import { useScenarioFootprints } from "./useScenarioFootprints";
import { useScenarioUnits } from "./useScenarioUnits";

export function BlueprintOnMap({
  blueprint,
  gameName,
  onClose,
}: {
  blueprint: BaseBlueprint;
  /** The game whose units this layout is built from, which is what its models
   *  and its footprints come out of. */
  gameName: string;
  /** Put the map away again, back to a page that has read none. */
  onClose: () => void;
}) {
  const { target, loading: enginesLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { thumbs } = useUnitsyncThumbnails(target?.enginePath, target?.dataDir);
  const maps = useMemo(() => scan.data?.maps ?? [], [scan.data]);

  // The map this layout was drawn on, when this machine has it. Null until the
  // scan has answered, so the default is worked out once rather than a choice
  // made for the author being overwritten by one they made themselves.
  const [chosen, setChosen] = useState<string | null>(null);
  const mapName = chosen ?? checkMapFor(blueprint.designedFor, maps);
  const [picking, setPicking] = useState(false);

  // The map's own 16 bit heights as well as the picture of them, because a
  // verdict is arithmetic over those exact numbers (issue #1490). Asked for
  // only once a map has been chosen: `useMissionMapAssets` reads nothing for a
  // map with no name.
  const assets = useMissionMapAssets(mapName, true);

  const [spot, setSpot] = useState<Point | null>(null);
  // Held rather than worked out per render, because everything downstream of the
  // document is rebuilt when it changes, and that means every model on the map
  // read again.
  const { worldWidth, worldHeight } = assets;
  const origin = useMemo(
    () => checkSpot(spot, worldWidth, worldHeight),
    [spot, worldWidth, worldHeight],
  );

  const [handle, setHandle] = useState<MapScene3D | null>(null);
  const doc = useMemo(
    () => blueprintDocument(blueprint, gameName, origin),
    [blueprint, gameName, origin],
  );

  const { units } = useGameUnits(gameName);
  const drawn = useScenarioUnits(handle, doc, assets);
  const footprints = useMemo(
    () => baseFootprints(drawn.placements, units, drawn.ground),
    [drawn.placements, units, drawn.ground],
  );
  useScenarioFootprints(handle, footprints, assets, drawn.groundAt);

  // Framed on the layout rather than on the map: the map is a few kilometres
  // across and the base is a few hundred elmos, so framing the map would open
  // on a speck. Read through a ref because the button is pressed long after
  // this was built.
  const framing = useRef({ placements: drawn.placements, at: origin, assets });
  framing.current = { placements: drawn.placements, at: origin, assets };
  const frame = useCallback((scene: MapScene3D) => {
    const { camera, controls, render, scale } = scene;
    const { placements, at, assets: map } = framing.current;
    const { centre, span } = layoutFraming(
      placements.map((one) => one.pos),
      at,
    );
    const to = worldToScene(centre, map.worldWidth, map.worldHeight, scale);
    const distance = Math.min(
      controls.maxDistance,
      Math.max(controls.minDistance, focusDistance(span) * scale),
    );
    const stand = focusCamera(to, distance);
    controls.target.set(to.x, 0, to.z);
    camera.position.set(stand.x, stand.y, stand.z);
    controls.update();
    render();
  }, []);

  useMapEditing({
    handle,
    layer: drawn.layer,
    placements: drawn.placements,
    worldWidth: assets.worldWidth,
    worldHeight: assets.worldHeight,
    groundAt: drawn.groundAt,
    selected: null,
    onSelect: () => {},
    // A click on bare ground stands the layout there, which is the whole of
    // choosing a spot.
    onPlace: setSpot,
    onDragGround: null,
    // A drag of any of its buildings carries the layout, because the layout is
    // the only thing on this surface and none of its buildings can be edited
    // here. The one building follows the pointer while the drag is on, and the
    // rest catch up when it lands.
    onMove: (_key, delta) =>
      setSpot({ x: origin.x + delta.x, z: origin.z + delta.z }),
  });

  const overlaps = overlappingIn(
    drawn.placements,
    footprints,
    BLUEPRINT_BASE_ID,
  );
  const waterless = sceneWaterless(footprints, drawn.ground);
  const status = mapSceneStatus({
    mapName,
    hasEngine: !!assets.enginePath && !!assets.dataDir,
    enginesLoading,
    assetsLoading: assets.loading,
    ready: assets.ready,
  });

  const stand =
    status === "no-map" ? (
      <SurfaceMessage icon={<MapPin className="size-6" />}>
        Pick a map to see which of this layout's buildings the ground would
        take. The layout is not changed by anything you do here.
      </SurfaceMessage>
    ) : status === "loading" ? (
      <SurfaceMessage
        icon={<Loader2 className="size-6 animate-spin opacity-40" />}
      >
        Reading {mapName}…
      </SurfaceMessage>
    ) : status === "no-engine" ? (
      <SurfaceMessage icon={<Unplug className="size-6" />}>
        <p>
          Coilbox reads maps through an engine, and there is no engine installed
          to read {mapName} with.
        </p>
        <Link
          to="/settings/engines"
          className="mt-1 inline-block underline underline-offset-2 hover:text-foreground"
        >
          Install an engine
        </Link>
      </SurfaceMessage>
    ) : status === "error" ? (
      <SurfaceMessage icon={<MountainSnow className="size-6" />}>
        <p>
          {mapName} could not be read. It is most likely not installed for the
          engine coilbox is using.
        </p>
        <Link
          to="/content/maps"
          className="mt-1 inline-block underline underline-offset-2 hover:text-foreground"
        >
          Manage maps
        </Link>
      </SurfaceMessage>
    ) : null;

  return (
    <>
      {/* Above the surface rather than on it, because a surface with no map on
          it yet shows a stand-in instead of its chrome, and the two ways out of
          that state are the two buttons here. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={scan.loading && maps.length === 0}
          onClick={() => setPicking(true)}
        >
          <MapPin className="size-4" /> {mapName || "Choose a map"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1.5"
          onClick={onClose}
        >
          <X className="size-4" /> Done with the map
        </Button>
      </div>

      <PlacementSurface
        ground={{
          kind: "map",
          heightSrc: assets.heightSrc,
          textureSrc: assets.textureSrc,
          skyboxSrc: assets.skyboxSrc,
          appearance: assets.appearance,
          minHeight: assets.minHeight,
          maxHeight: assets.maxHeight,
          worldWidth: assets.worldWidth,
          worldHeight: assets.worldHeight,
        }}
        onScene={setHandle}
        frame={frame}
        frameLabel="Frame layout"
        stand={stand}
        bars={
          <>
            <div className="w-fit max-w-full space-y-1.5 rounded-md border border-border/60 bg-card/85 p-2 backdrop-blur">
              <LayoutNotes
                overlaps={overlaps}
                unstable={unstableIn(
                  drawn.placements,
                  footprints,
                  BLUEPRINT_BASE_ID,
                )}
                tooDeep={tooDeepIn(
                  drawn.placements,
                  footprints,
                  BLUEPRINT_BASE_ID,
                )}
                // Nothing on a map with no water at all, where every one of
                // these is refused for the same reason and the surface says
                // that reason once (issue #1536).
                tooShallow={
                  waterless === null
                    ? tooShallowIn(
                        drawn.placements,
                        footprints,
                        BLUEPRINT_BASE_ID,
                      )
                    : []
                }
                // Only once the reads have settled, so opening on a map is not
                // a wall of warnings that clears itself (issue #1491).
                noSlope={
                  drawn.settled
                    ? noSlopeIn(drawn.placements, footprints, BLUEPRINT_BASE_ID)
                    : undefined
                }
                absent={absentIn(
                  drawn.placements,
                  footprints,
                  BLUEPRINT_BASE_ID,
                )}
                buildings={blueprint.buildings.length}
                designedFor={blueprint.designedFor}
                onMap={mapName}
                strays={strayDefs(units, blueprint.buildings)}
              />
              <p className="text-[11px] text-muted-foreground">
                {spotSentence(origin)} Click the ground to stand it somewhere
                else.
              </p>
            </div>

            <UncheckedNote
              unchecked={drawn.settled ? sceneUnchecked(footprints) : null}
              flattened={drawn.heightsUnread}
            />
            <WaterlessNote floor={waterless} />
          </>
        }
        footer={
          <>
            {mapName} · click or drag to stand the layout somewhere else · this
            changes the layout in no way · right-drag to turn · scroll to zoom
          </>
        }
      />

      <MapPickerDrawer
        open={picking}
        onOpenChange={setPicking}
        maps={maps}
        thumbs={thumbs}
        selectedName={mapName}
        onSelect={(name) => {
          setChosen(name);
          // A spot on one map is not a spot on another, and the middle is the
          // one point every map has.
          setSpot(null);
        }}
        mapsLoading={scan.loading && maps.length === 0}
      />
    </>
  );
}
