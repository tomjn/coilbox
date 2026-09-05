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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { buildGridSnap, type FootprintMark } from "@/blueprint/footprint";
import type { BaseBlueprint } from "@/blueprint/model";
import { useMissionMapAssets } from "@/campaign/pages/components/useMissionMapAssets";
import { useUnitsyncScan, useUnitsyncThumbnails } from "@/content/config";
import { useGameUnits } from "@/content/useGameUnits";
import type { MapScene3D } from "@/lib/mapScene";
import { strayDefs } from "@/lib/scenarioEditing/bases";
import { usePreferredTarget } from "@/play/config";
import { MapPickerDrawer } from "@/play/pages/components/MapPickerDrawer";
import type { Point } from "@/scenario/model";
import { isTypingTarget } from "@/scenario/pages/components/history";
import { BLUEPRINT_BASE_ID, blueprintDocument } from "./blueprintDocument";
import { layoutFraming } from "./ground";
import { LayoutNotes, UncheckedNote, WaterlessNote } from "./LayoutControls";
import {
  checkMapFor,
  checkSpot,
  spotLayout,
  spotNudge,
  spotSentence,
} from "./mapCheck";
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
  nudgedPreview,
  nudgeSentence,
  previewChecks,
  previewSentence,
  previewTrouble,
} from "./preview";
import {
  focusCamera,
  focusDistance,
  mapSceneStatus,
  worldToScene,
} from "./scene";
import { useLayoutPreview } from "./useLayoutPreview";
import { useMapEditing } from "./useMapEditing";
import { useScenarioFootprints } from "./useScenarioFootprints";
import { useScenarioUnits } from "./useScenarioUnits";

/** One list for every "nothing to draw", so a layer with nothing on it is not
 *  cleared and redrawn on every render. */
const NOTHING: FootprintMark[] = [];

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

  const { units } = useGameUnits(gameName);
  // Undefined until the game's units are read, which is what stops a layout of
  // even-footprint buildings being stood on the wrong half of the grid by a
  // fallback that calls every def one square.
  const snap = useMemo(
    () => (units.length > 0 ? buildGridSnap(units) : undefined),
    [units],
  );

  const [spot, setSpot] = useState<Point | null>(null);
  // Held rather than worked out per render, because everything downstream of the
  // document is rebuilt when it changes, and that means every model on the map
  // read again.
  const { worldWidth, worldHeight } = assets;
  const buildings = blueprint.buildings;
  const origin = useMemo(
    () => checkSpot(spot, worldWidth, worldHeight, buildings, snap),
    [spot, worldWidth, worldHeight, buildings, snap],
  );

  const [handle, setHandle] = useState<MapScene3D | null>(null);
  const doc = useMemo(
    () => blueprintDocument(blueprint, gameName, origin),
    [blueprint, gameName, origin],
  );

  const drawn = useScenarioUnits(handle, doc, assets);
  const footprints = useMemo(
    () => baseFootprints(drawn.placements, units, drawn.ground),
    [drawn.placements, units, drawn.ground],
  );

  // The layout as a drag carries it, drawn on the squares it will land on
  // (issue #1558). A drag here moves the whole base rather than editing one
  // building, so what follows the pointer is the whole base: showing the one
  // building that was grabbed made it look as though the layout tore apart and
  // snapped back together on the drop.
  const checks = useMemo(
    () => previewChecks(units, drawn.ground),
    [units, drawn.ground],
  );
  const preview = useLayoutPreview({
    handle,
    worldWidth: assets.worldWidth,
    worldHeight: assets.worldHeight,
    groundAt: drawn.groundAt,
    // Nothing is drawn under a pointer that is only passing over: a click
    // stands the layout where it lands, and a second copy of the base
    // following the pointer about would be one base too many on a surface that
    // has exactly one.
    ghost: null,
    carried: (drag) =>
      spotLayout(
        buildings,
        checkSpot(
          { x: origin.x + drag.delta.x, z: origin.z + drag.delta.z },
          assets.worldWidth,
          assets.worldHeight,
          buildings,
          snap,
        ),
      ),
    checks,
    // Nothing else stands on this map, and the whole layout is in the air, so
    // there is no ground here that is already spoken for.
    occupied: NOTHING,
    placements: drawn.placements,
  });

  // While it is in the air the layout is drawn where it is going, so the
  // squares it came from come down for the length of the drag.
  useScenarioFootprints(
    handle,
    preview.dragging ? NOTHING : footprints,
    assets,
    drawn.groundAt,
  );

  // Where the whole layout would stand, when the spot it is on will not do
  // (issue #1559). Worked out from where it is standing rather than from a
  // pointer, because that is the question this surface is asked: the author is
  // hunting for a spot on this map, not drawing a shape.
  const standing = useMemo(
    () => spotLayout(blueprint.buildings, origin),
    [blueprint.buildings, origin],
  );
  const offer = useMemo(
    () =>
      // Only once the reads have settled, so a map opening does not offer a
      // move away from a refusal that is about to clear itself (issue #1491).
      drawn.settled
        ? spotNudge(standing, footprints, checks.footprintOf, checks.standingOf)
        : null,
    [drawn.settled, standing, footprints, checks],
  );
  // Outlined rather than filled, and beside the layout rather than instead of
  // it: two filled sets of squares half a build square apart read as one smear
  // (issue #1543). Nothing while a drag is on, when the layout is somewhere
  // else and the offer is about where it was.
  const offered = useMemo(
    () =>
      offer && offer !== "nowhere" && !preview.dragging
        ? nudgedPreview(
            standing,
            offer,
            checks.footprintOf,
            [],
            checks.standingOf,
          )
        : NOTHING,
    [offer, standing, checks, preview.dragging],
  );
  useScenarioFootprints(handle, offered, assets, drawn.groundAt, "offered");

  // Taking the offer, which is a plain move of the layout to the offered spot:
  // nothing about it is special, and nothing has moved until this is pressed.
  // A key rather than a button, so the same press takes the same offer here as
  // it does in the scenario editor.
  const takeOffer = useCallback(() => {
    if (!offer || offer === "nowhere") return;
    setSpot({ x: origin.x + offer.delta.x, z: origin.z + offer.delta.z });
  }, [offer, origin]);
  useEffect(() => {
    if (!offer || offer === "nowhere") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "n") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      event.preventDefault();
      takeOffer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offer, takeOffer]);

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
    // here. Every building of it follows the pointer, and the squares under
    // them are drawn by the preview above.
    carries: () => drawn.placements.map((one) => one.key),
    onDragUnit: preview.onDragUnit,
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
          heightRange: assets.heightRange,
          heightWords: assets.heightWords,
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
        frameLabel="Frame blueprint"
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
              {/* Where the whole thing would stand instead, offered rather than
                  done: a base half in a cliff is a real thing an author might
                  mean, so nothing moves until somebody asks (issue #1559). */}
              {offer && !preview.dragging && (
                <p className="text-[11px] text-muted-foreground">
                  {nudgeSentence(offer)}
                </p>
              )}
            </div>

            {/* What the squares under the layout say while it is being
                carried, in words, because a colour on its own is not a
                statement anybody can act on (issue #1558). */}
            {preview.count && (
              <p
                className={`w-fit rounded px-2 py-1 text-[11px] backdrop-blur ${
                  previewTrouble(preview.count)
                    ? "bg-amber-950/80 text-amber-200"
                    : "bg-card/70 text-muted-foreground"
                }`}
              >
                {previewSentence(preview.count)}
              </p>
            )}

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
            changes the layout in no way · right-drag to turn the view
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
