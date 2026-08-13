/**
 * What a selected base is, beyond the one building that was clicked: whose it
 * is, what the clicked building is told to build, and what can be done to the
 * cluster as a whole.
 *
 * Team is on the bar because it is the one an author changes while looking at
 * the map. The queue and the base's own actions are behind popovers: a factory's
 * queue is a list that grows, and a bar wide enough for one would cover the base
 * it describes.
 *
 * Moving the whole base is a click on the map rather than a drag, because
 * dragging a building already means moving that building within the cluster.
 * Arming it is this panel's job, obeying it is the surface's.
 *
 * Mount this keyed by the base and the building, so moving the selection reseeds
 * the popovers with what is now selected.
 *
 * The layout's name and who else is using it are in the buildings popover
 * because both belong to the layout rather than to this base (issue #1414). An
 * author who never places a layout twice never sees the sharing half of it.
 *
 * The build order gets a popover of its own (issue #1418), because the order is
 * a claim about the layout rather than a fact about it: a layout is a build
 * order once somebody says the sequence was meant, and until then the list is
 * the order things happened to be clicked in and is not worth showing as one.
 *
 * Converting the base to another side's buildings (issue #1466) is in the
 * buildings popover for the same reason the layout's name is: it is a thing done
 * to the layout rather than to this placement. The panel it opens is the one the
 * library uses, and what it hands back goes through the same layout edit as a
 * drag, so converting one of a pair of bases converts one of them.
 *
 * The factory queues go into that panel too (issue #1493). They are the one
 * mission-only field a conversion has to reach, because a converted factory told
 * to build the side it used to be builds nothing, and the panel is where they
 * come back out as a plan the base's own queues are then said in.
 *
 * The panel is opened through `./SubstituteBaseForm.tsx` rather than directly,
 * which is what puts this game's own answers in it (issue #1531). Without them
 * a queued unit converts only where the game's naming happens to reach it, and
 * every answer given here was thrown away when the drawer closed.
 */

import { Button, useDrawer } from "@picoframe/frame";
import {
  ArrowDown,
  ArrowUp,
  Blocks,
  Hammer,
  Move,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import { buildingFootprints } from "@/blueprint/footprint";
import type { BaseBlueprint } from "@/blueprint/model";
import { offGridBuildings } from "@/blueprint/offGrid";
import type { SideUnits, SubstitutionPlan } from "@/blueprint/substitution";
import type { UnknownBuilding } from "@/blueprint/units";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { UnitDatasetEntry } from "@/content/bindings";
import { UnitDefSelect } from "@/content/pages/components/UnitDefSelect";
import { nextDrawerKey } from "@/general/drawerKey";
import {
  BuildOrderPopover,
  LayoutNameField,
  LayoutNotes,
} from "@/placement/LayoutControls";
import type { Participant } from "@/play/config";
import type { PlacedBuilding, ScenarioBase } from "../../model";
import {
  buildableBy,
  movedQueued,
  plusQueued,
  strayDefs,
  withoutQueued,
} from "./bases";
import { SubstituteBaseForm } from "./SubstituteBaseForm";
import { TeamSelect } from "./TeamSelect";

export function BaseControls({
  base,
  buildings,
  index,
  layout,
  layoutName,
  ordered,
  sharedWith,
  sharedEdit,
  overlaps,
  unstable,
  wrongDepth,
  noSlope,
  absent,
  designedFor,
  onMap,
  participants,
  units,
  unitsLoading,
  sides,
  gameArchive,
  moving,
  onEdit,
  onRename,
  onOrdered,
  onMoveBuilding,
  onPlay,
  onSharedEdit,
  onQueue,
  onMove,
  onSnapToGrid,
  onSubstitute,
  onDelete,
}: {
  base: ScenarioBase;
  /** The base's buildings, its blueprint's layout and its own per-building
   *  fields read together. */
  buildings: PlacedBuilding[];
  /** Which of the base's buildings is selected. */
  index: number;
  /** The layout this base is placed from, as the conversion panel works on it:
   *  the geometry with no mission-only field on it. Absent for a base whose
   *  layout the document has lost, which has nothing to convert. */
  layout?: BaseBlueprint;
  /** What the layout this base is placed from is called. */
  layoutName: string;
  /** Whether the order the buildings are in is the build order. */
  ordered: boolean;
  /** How many other bases are placed from that layout. */
  sharedWith: number;
  /** Whether an edit here changes the layout all of them use, rather than
   *  giving this base a copy of its own. */
  sharedEdit: boolean;
  /** Which of them are standing on ground another building wants, by their
   *  place in the base. Drawn in red on the map as well. */
  overlaps: number[];
  /** Which of them this map's terrain will not take, by their place in the
   *  base. Drawn in amber on the map as well, and empty where the terrain
   *  could not be checked at all. */
  unstable: number[];
  /** Which of them are in the wrong depth of water for them, by their place in
   *  the base. Drawn in cyan on the map as well (issue #1459). */
  wrongDepth: number[];
  /** Which of them this game gives no slope to check against, by their place in
   *  the base. Undefined while the reads are still in flight, when nothing is
   *  worth saying yet (issue #1491). */
  noSlope?: number[];
  /** Which of them name a unit this game has not got, by their place in the
   *  base. Drawn in violet on the map as well (issue #1445). */
  absent: UnknownBuilding[];
  /** The map the layout was drawn on, when it says (issue #1315). */
  designedFor?: string;
  /** The map the mission is on, which is the one the base is standing on. */
  onMap: string;
  participants: Participant[];
  /** The game's units, for filling the selected building's queue. */
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  /** What this game calls each side's units, or empty when its own naming says
   *  nothing a conversion can be suggested from. */
  sides: readonly SideUnits[];
  /** The archive this mission's game was read out of, which is what a
   *  conversion keys this game's answers by (issue #1525). Undefined for a game
   *  that is not installed, which converts nothing anyway. */
  gameArchive: string | undefined;
  /** Whether the map is waiting for a click to move the base. */
  moving: boolean;
  /** Change the base's own fields, as {@link editBase} takes them. */
  onEdit: (patch: Partial<Pick<ScenarioBase, "team">>) => void;
  /** Rename the layout, which names a copy when it is shared and `sharedEdit`
   *  is off. */
  onRename: (name: string) => void;
  /** Say that the order the buildings are in is the build order, or that it is
   *  not. A layout edit like a rename. */
  onOrdered: (on: boolean) => void;
  /** Move one building along the build order, which is to say along the
   *  layout's own array. */
  onMoveBuilding: (index: number, delta: number) => void;
  /** Watch the base go up in that order. */
  onPlay: () => void;
  /** Ask for edits here to go to the shared layout, or stop asking. */
  onSharedEdit: (on: boolean) => void;
  /** Replace the selected building's queue and its repeat flag. */
  onQueue: (queue: string[], repeat: boolean) => void;
  /** Ask the map for a point to put the base's origin on, or stop asking. */
  onMove: (on: boolean) => void;
  /** Write the positions the buildings are drawn on into the layout, which is
   *  the offer the layout's own notes carry. A layout edit like a drag, so a
   *  shared layout is copied or written through the same way. */
  onSnapToGrid: () => void;
  /** Put the converted layout into the document (issue #1466). A layout edit
   *  like a drag, so a shared layout is copied or written through the same
   *  way. The plan comes with it because the queues are converted by it and
   *  they are on the base rather than in the layout (issue #1493). */
  onSubstitute: (layout: BaseBlueprint, plan: SubstitutionPlan) => void;
  /** Delete the whole base, buildings and queues and all. */
  onDelete: () => void;
}) {
  const drawer = useDrawer();
  // The selection is one of the base's buildings, so this is always one of them.
  const building = buildings[index];
  const queue = building.queue ?? [];
  const repeat = building.repeat === true;
  // Null while the dataset is unread and for a def the game has not got, which
  // is why the picker below falls back to every unit rather than to nothing.
  const buildable = buildableBy(units, building.def);
  const strays = strayDefs(units, buildings);
  // Which of them the engine will not build where the layout says (#1427).
  // Only once the game's units have been read: without them every building
  // looks like one square, and half of a layout that is perfectly fine would be
  // accused of being off the grid.
  const offGrid =
    units.length > 0
      ? offGridBuildings(buildings, buildingFootprints(units), base.origin)
      : [];

  return (
    <>
      <TeamSelect
        participants={participants}
        value={base.team}
        onValueChange={(team) => onEdit({ team })}
        className="w-32"
      />

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Hammer className="size-3.5" />
            {queue.length === 0
              ? "Queue"
              : `${queue.length} queued${repeat ? " · loops" : ""}`}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
          {buildable !== null && buildable.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{building.def}</span> builds nothing
              in this game, so a queue on it would never be started.
            </p>
          ) : (
            <>
              {buildable === null && (
                <p className="text-xs text-muted-foreground">
                  The game's units could not be read, so this list is every unit
                  rather than the ones this building can make.
                </p>
              )}

              {queue.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Units this factory builds once the base is on the map, in
                  order.
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {queue.map((def, at) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: a queue is a list of build orders, so the same def appears more than once and its place in the queue is the only thing naming it
                      key={`${at}-${def}`}
                      className="flex items-center gap-2"
                    >
                      <span className="w-4 shrink-0 text-right text-[11px] text-muted-foreground">
                        {at + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {def}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-7 p-0"
                        aria-label={`Move ${def} up`}
                        disabled={at === 0}
                        onClick={() =>
                          onQueue(movedQueued(queue, at, -1), repeat)
                        }
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-7 p-0"
                        aria-label={`Move ${def} down`}
                        disabled={at === queue.length - 1}
                        onClick={() =>
                          onQueue(movedQueued(queue, at, 1), repeat)
                        }
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-7 p-0 text-destructive hover:text-destructive"
                        aria-label={`Take ${def} out of the queue`}
                        onClick={() =>
                          onQueue(withoutQueued(queue, at), repeat)
                        }
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ol>
              )}

              <UnitDefSelect
                units={buildable ?? units}
                value=""
                loading={unitsLoading}
                placeholder="Add to the queue"
                size="sm"
                onValueChange={(def) => onQueue(plusQueued(queue, def), repeat)}
              />

              <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                <Label htmlFor="base-repeat" className="text-xs font-medium">
                  Build the queue over and over
                </Label>
                <Switch
                  id="base-repeat"
                  checked={repeat}
                  disabled={queue.length === 0}
                  onCheckedChange={(on) => onQueue(queue, on)}
                />
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={moving ? "default" : "ghost"}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Blocks className="size-3.5" /> {buildings.length} building
            {buildings.length === 1 ? "" : "s"}
            {sharedWith > 0 && (sharedEdit ? " · editing shared" : " · shared")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
          <LayoutNameField
            id="base-layout-name"
            name={layoutName}
            onRename={onRename}
          />

          {sharedWith > 0 && (
            <div className="space-y-2 rounded bg-sky-950/60 px-2 py-1.5 text-[11px] text-sky-100">
              <p>
                {sharedWith === 1
                  ? "One other base is"
                  : `${sharedWith} other bases are`}{" "}
                placed from this layout.{" "}
                {sharedEdit
                  ? "Adding, moving, turning, converting or deleting a building here changes it for all of them."
                  : "Adding, moving, turning, converting or deleting a building here gives this base a copy of its own and leaves the rest where they stand."}
              </p>
              <div className="flex items-center justify-between gap-3">
                <Label
                  htmlFor="base-shared-layout"
                  className="text-[11px] font-medium"
                >
                  Edit the layout they all use
                </Label>
                <Switch
                  id="base-shared-layout"
                  checked={sharedEdit}
                  onCheckedChange={onSharedEdit}
                />
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Every building sits at an offset from the base's origin. Dragging
            one moves it within the base. Moving the base takes the lot.
          </p>

          <LayoutNotes
            overlaps={overlaps}
            unstable={unstable}
            wrongDepth={wrongDepth}
            noSlope={noSlope}
            absent={absent}
            buildings={buildings.length}
            designedFor={designedFor}
            onMap={onMap}
            strays={strays}
            offGrid={offGrid}
            onSnapToGrid={onSnapToGrid}
          />

          {layout && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full gap-1.5 px-2 text-xs"
              onClick={() =>
                drawer.open({
                  title: `Convert ${layoutName}`,
                  width: "32rem",
                  content: (
                    <div key={nextDrawerKey()} className="flex flex-col">
                      <SubstituteBaseForm
                        layout={layout}
                        queued={buildings.flatMap((one) => one.queue ?? [])}
                        gameArchive={gameArchive}
                        sides={sides}
                        units={units}
                        unitsLoading={unitsLoading}
                        onApply={(next, plan) => {
                          onSubstitute(next, plan);
                          drawer.close();
                        }}
                      />
                    </div>
                  ),
                })
              }
            >
              <Repeat className="size-3.5" /> Say it in another side's buildings
            </Button>
          )}

          <Button
            size="sm"
            variant={moving ? "default" : "outline"}
            className="h-7 w-full gap-1.5 px-2 text-xs"
            onClick={() => onMove(!moving)}
          >
            <Move className="size-3.5" />
            {moving ? "Click the map" : "Move the whole base"}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-full gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" /> Delete the whole base
          </Button>
        </PopoverContent>
      </Popover>

      <BuildOrderPopover
        buildings={buildings}
        index={index}
        ordered={ordered}
        onOrdered={onOrdered}
        onMoveBuilding={onMoveBuilding}
        onPlay={onPlay}
      />
    </>
  );
}
