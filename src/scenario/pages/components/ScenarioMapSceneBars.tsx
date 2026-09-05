import type { Dispatch, ReactNode, SetStateAction } from "react";
import { buildingFootprints, type FootprintMark } from "@/blueprint/footprint";
import type { BlueprintBuilding } from "@/blueprint/model";
import { onBuildGrid } from "@/blueprint/offGrid";
import type { SideUnits } from "@/blueprint/substitution";
import type { UnitDatasetEntry } from "@/content/bindings";
import {
  editBase,
  editBaseLayout,
  type LayoutEdit,
  moveBuilding,
  removeBase,
  renameBlueprint,
  setBlueprintOrdered,
  setQueue,
  sharingLayout,
  substituteQueues,
} from "@/lib/scenarioEditing/bases";
import { editActor, setActorState } from "@/lib/scenarioEditing/editing";
import {
  absentIn,
  noSlopeIn,
  overlappingIn,
  type Placement,
  tooDeepIn,
  tooShallowIn,
  unstableIn,
} from "@/placement/placements";
import type { PreviewNote } from "@/placement/preview";
import { PlaybackBar } from "@/placement/SurfaceBars";
import {
  baseBuildings,
  type Point,
  type Scenario,
  type ScenarioGroup,
} from "../../model";
import type { MissionIssue } from "../../validate";
import { ActorControls } from "./ActorControls";
import { BaseControls } from "./BaseControls";
import type { ScenarioEdit } from "./edits";
import { groupLabel } from "./groups";
import {
  ClickMapBar,
  ScenarioSelectionBar,
  SelectionCountBar,
} from "./ScenarioMapBars";
import { countWords } from "./selection";

/**
 * The bars `ScenarioMapScene.tsx`'s `bars` JSX composes, one component per bar
 * family (issue #2515's second boundary).
 *
 * Unlike `ScenarioMapBars.tsx`'s leaves, these call `onChange`: the issue's own
 * words for this boundary are "each taking the reads and `onChange` calls it
 * needs as props", which is a different rule from the hooks these components sit
 * beside. A hook never calls `onChange` (#2512 onward), but a component wiring a
 * bar to the document is exactly what one is for.
 *
 * The path bar, the zone bar and the two `PathBar` renders stay in
 * `ScenarioMapScene.tsx`. The issue's five named groupings do not mention them,
 * and each is small enough, under 20 lines, that lifting it would be scope the
 * boundary did not ask for.
 */

/** The mode's own controls, and the sentence over the terrain about the spot
 *  under the pointer. Grouped together because both are about what the current
 *  mode's placement is doing, and both sit at the top of the bars column for
 *  that reason. */
export function ModeStatusBar({
  controls,
  spot,
}: {
  controls: ReactNode | undefined;
  spot: PreviewNote | null;
}) {
  return (
    <>
      {controls && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-card p-1">
          {controls}
        </div>
      )}
      {spot && (
        <p
          className={`w-fit rounded px-2 py-1 text-[11px] backdrop-blur ${
            spot.trouble
              ? "bg-amber-950/80 text-amber-200"
              : "bg-card/70 text-muted-foreground"
          }`}
        >
          {spot.text}
        </p>
      )}
    </>
  );
}

/**
 * What is selected, named and given its per-kind panel: an actor's controls, a
 * group's own controls, or a base's, with every prop on `BaseControls` that
 * calls `onChange`.
 *
 * `pickedActor`, `pickedBase` and `pickedLayout` are derived here rather than
 * passed in, since nothing outside this bar in `ScenarioMapScene.tsx` reads
 * them.
 */
export function PlacementSelectionBar({
  scenario,
  picked,
  groupControls,
  issues,
  onChange,
  layoutEdit,
  placements,
  footprints,
  waterless,
  settled,
  mapName,
  gameUnits,
  gameSides,
  moving,
  sharedBase,
  reduceMotion,
  setPlayback,
  setSharedBase,
  setMovingBase,
  setSelected,
}: {
  scenario: Scenario;
  picked: Placement;
  /** A group's own controls, built by the caller because a point on a path
   *  reaches the same controls (issue #842). */
  groupControls: ReactNode;
  issues: MissionIssue[];
  onChange: (edit: ScenarioEdit) => void;
  layoutEdit: (id: string | null | undefined) => LayoutEdit;
  placements: Placement[];
  footprints: FootprintMark[];
  waterless: number | null;
  settled: boolean;
  mapName: string;
  gameUnits: {
    units: UnitDatasetEntry[];
    loading: boolean;
    archive?: string;
  };
  gameSides: readonly SideUnits[];
  moving: string | null;
  sharedBase: string | null;
  reduceMotion: boolean;
  setPlayback: Dispatch<
    SetStateAction<{ base: string; step: number; playing: boolean } | null>
  >;
  setSharedBase: (id: string | null) => void;
  setMovingBase: (id: string | null) => void;
  setSelected: (key: string | null, add?: boolean) => void;
}) {
  const pickedActor =
    (picked.kind === "actor" &&
      scenario.actors.find((a) => a.id === picked.id)) ||
    null;
  const pickedBase =
    (picked.kind === "base" &&
      scenario.bases.find((b) => b.id === picked.id)) ||
    null;
  const pickedLayout = pickedBase
    ? scenario.blueprints.find((b) => b.id === pickedBase.blueprint)
    : undefined;

  return (
    // Turning and deleting are the rail's now. What is left here is what the
    // bar was always for: naming what is selected, and the controls for
    // whatever kind of thing it turned out to be.
    <ScenarioSelectionBar placement={picked}>
      {pickedActor && (
        <ActorControls
          key={pickedActor.id}
          actor={pickedActor}
          participants={scenario.setup.participants}
          issues={issues}
          onEdit={(patch) =>
            onChange((doc) => editActor(doc, pickedActor.id, patch))
          }
          onState={(state) =>
            onChange((doc) => setActorState(doc, pickedActor.id, state))
          }
        />
      )}
      {picked.kind === "group" && groupControls}
      {picked.kind === "base" && pickedBase && (
        <BaseControls
          key={`${pickedBase.id}#${picked.index}`}
          base={pickedBase}
          buildings={baseBuildings(scenario.blueprints, pickedBase)}
          index={picked.index}
          layout={pickedLayout}
          layoutName={pickedLayout?.name ?? ""}
          ordered={pickedLayout?.ordered === true}
          sharedWith={sharingLayout(scenario, pickedBase.id).length}
          sharedEdit={sharedBase === pickedBase.id}
          overlaps={overlappingIn(placements, footprints, pickedBase.id)}
          unstable={unstableIn(placements, footprints, pickedBase.id)}
          tooDeep={tooDeepIn(placements, footprints, pickedBase.id)}
          // Nothing on a map with no water, where every one of these is refused
          // for the same reason and the surface says that reason once (issue
          // #1536). Only this half: a map with no sea is why a building wants
          // water it cannot find, and never why one is under too much (#1552).
          tooShallow={
            waterless === null
              ? tooShallowIn(placements, footprints, pickedBase.id)
              : []
          }
          // Only once the reads are in, so an editor opening does not greet
          // anybody with a warning that clears itself (issue #1491).
          noSlope={
            settled
              ? noSlopeIn(placements, footprints, pickedBase.id)
              : undefined
          }
          absent={absentIn(placements, footprints, pickedBase.id)}
          designedFor={pickedLayout?.designedFor}
          onMap={mapName}
          participants={scenario.setup.participants}
          units={gameUnits.units}
          unitsLoading={gameUnits.loading}
          sides={gameSides}
          gameArchive={gameUnits.archive}
          moving={moving === pickedBase.id}
          issues={issues}
          onEdit={(patch) =>
            onChange((doc) => editBase(doc, pickedBase.id, patch))
          }
          onRename={(name) =>
            onChange((doc) =>
              renameBlueprint(
                doc,
                pickedBase.id,
                name,
                layoutEdit(pickedBase.id),
              ),
            )
          }
          onOrdered={(on) =>
            onChange((doc) =>
              setBlueprintOrdered(
                doc,
                pickedBase.id,
                on,
                layoutEdit(pickedBase.id),
              ),
            )
          }
          // The selection stays where it is rather than following the building
          // that moved, because what is selected here is a place in the base:
          // the bar above calls it "base building 3".
          onMoveBuilding={(at, delta) =>
            onChange((doc) =>
              moveBuilding(
                doc,
                pickedBase.id,
                at,
                delta,
                layoutEdit(pickedBase.id),
              ),
            )
          }
          onPlay={() =>
            setPlayback({
              base: pickedBase.id,
              step: 0,
              playing: !reduceMotion,
            })
          }
          onSharedEdit={(on) => setSharedBase(on ? pickedBase.id : null)}
          onQueue={(queue, repeat) =>
            onChange((doc) =>
              setQueue(doc, pickedBase.id, picked.index, queue, repeat),
            )
          }
          onMove={(on) => setMovingBase(on ? pickedBase.id : null)}
          // A layout edit, so it copies a shared layout rather than moving
          // every base placed from it, and the history holds it like any other
          // (#1427).
          onSnapToGrid={() =>
            onChange((doc) =>
              editBaseLayout(
                doc,
                pickedBase.id,
                layoutEdit(pickedBase.id),
                (buildings) =>
                  onBuildGrid(
                    buildings,
                    buildingFootprints(gameUnits.units),
                    pickedBase.origin,
                  ),
              ),
            )
          }
          // A layout edit like the snap above, so converting one of two bases
          // placed from a layout converts one of them (#1466). The queues are
          // the base's rather than the layout's, so they go through the plan
          // first, while the bases sharing the layout are still the bases
          // sharing it (#1493).
          onSubstitute={(next, plan) =>
            onChange((doc) => {
              const how = layoutEdit(pickedBase.id);
              return editBaseLayout(
                substituteQueues(doc, pickedBase.id, plan, how),
                pickedBase.id,
                how,
                () => next.buildings,
              );
            })
          }
          onDelete={() => {
            onChange((doc) => removeBase(doc, pickedBase.id));
            setSelected(null);
          }}
        />
      )}
    </ScenarioSelectionBar>
  );
}

/** A question the map is waiting for an answer to, whichever of the three it
 *  is: a path being drawn, a base being moved, or a point a panel asked for.
 *  Exactly one of the three is ever outstanding at once, which is what the
 *  guards on `moving` and `drawingPath` below preserve. */
export function ClickAnswerBars({
  drawingPath,
  pickedGroup,
  groups,
  onDrawingDone,
  moving,
  onMovingDone,
  picking,
  onPlace,
  worldWidth,
  worldHeight,
}: {
  drawingPath: { groupId: string; order: number } | null;
  pickedGroup: ScenarioGroup | null;
  groups: ScenarioGroup[];
  onDrawingDone: () => void;
  moving: string | null;
  onMovingDone: () => void;
  picking?: { message: ReactNode; onDone: () => void } | null;
  onPlace: ((pos: Point) => void) | null;
  worldWidth: number;
  worldHeight: number;
}) {
  return (
    <>
      {drawingPath && pickedGroup && (
        <ClickMapBar
          message={
            <>
              Click the map to add points to{" "}
              <span className="font-mono">
                {groupLabel(groups, pickedGroup.id)} ·{" "}
                {pickedGroup.orders[drawingPath.order].kind}
              </span>
            </>
          }
          onDone={onDrawingDone}
          onAt={onPlace}
          worldWidth={worldWidth}
          worldHeight={worldHeight}
        />
      )}
      {moving && (
        <ClickMapBar
          message="Click the map to put this base's origin there, buildings and all"
          onDone={onMovingDone}
          onAt={onPlace}
          worldWidth={worldWidth}
          worldHeight={worldHeight}
        />
      )}
      {picking && !drawingPath && !moving && (
        <ClickMapBar
          message={picking.message}
          onDone={picking.onDone}
          onAt={onPlace}
          worldWidth={worldWidth}
          worldHeight={worldHeight}
        />
      )}
    </>
  );
}

/** The base being watched go up, stepping through its build order one
 *  building at a time (issue #1418). */
export function ScenarioPlaybackBar({
  playing,
  total,
  steps,
  setPlayback,
}: {
  playing: { base: string; step: number; playing: boolean };
  total: number;
  steps: BlueprintBuilding[];
  setPlayback: Dispatch<
    SetStateAction<{ base: string; step: number; playing: boolean } | null>
  >;
}) {
  return (
    <PlaybackBar
      step={playing.step}
      total={total}
      def={steps[playing.step - 1]?.def ?? ""}
      playing={playing.playing}
      onStep={(step) =>
        setPlayback((at) => at && { ...at, step, playing: false })
      }
      onPlaying={(on) =>
        setPlayback(
          (at) =>
            at && {
              ...at,
              playing: on,
              // Playing from the end starts again, so the button is never one
              // that does nothing.
              step: on && at.step >= total ? 0 : at.step,
            },
        )
      }
      onDone={() => setPlayback(null)}
    />
  );
}

/** How much is in hand, and the way to put it all down (issue #2279). */
export function TallyBar({
  selection,
  onClear,
}: {
  selection: readonly string[];
  onClear: () => void;
}) {
  return <SelectionCountBar what={countWords(selection)} onClear={onClear} />;
}
