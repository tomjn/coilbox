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
 */

import { Button } from "@picoframe/frame";
import { Blocks, Hammer, Move, Trash2, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { UnitDatasetEntry } from "@/content/bindings";
import { UnitDefSelect } from "@/content/pages/components/UnitDefSelect";
import type { Participant } from "@/play/config";
import type { ScenarioPrefab } from "../../model";
import { buildableBy, plusQueued, strayDefs, withoutQueued } from "./prefabs";
import { TeamSelect } from "./TeamSelect";

export function PrefabControls({
  prefab,
  index,
  participants,
  units,
  unitsLoading,
  moving,
  onEdit,
  onQueue,
  onMove,
  onDelete,
}: {
  prefab: ScenarioPrefab;
  /** Which of the base's buildings is selected. */
  index: number;
  participants: Participant[];
  /** The game's units, for filling the selected building's queue. */
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  /** Whether the map is waiting for a click to move the base. */
  moving: boolean;
  /** Change the base's own fields, as {@link editPrefab} takes them. */
  onEdit: (patch: Partial<Pick<ScenarioPrefab, "team">>) => void;
  /** Replace the selected building's queue and its repeat flag. */
  onQueue: (queue: string[], repeat: boolean) => void;
  /** Ask the map for a point to put the base's origin on, or stop asking. */
  onMove: (on: boolean) => void;
  /** Delete the whole base, buildings and queues and all. */
  onDelete: () => void;
}) {
  // The selection is one of the base's buildings, so this is always one of them.
  const building = prefab.buildings[index];
  const queue = building.queue ?? [];
  const repeat = building.repeat === true;
  // Null while the dataset is unread and for a def the game has not got, which
  // is why the picker below falls back to every unit rather than to nothing.
  const buildable = buildableBy(units, building.def);
  const strays = strayDefs(units, prefab.buildings);

  return (
    <>
      <TeamSelect
        participants={participants}
        value={prefab.team}
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
                <Label htmlFor="prefab-repeat" className="text-xs font-medium">
                  Build the queue over and over
                </Label>
                <Switch
                  id="prefab-repeat"
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
            <Blocks className="size-3.5" /> {prefab.buildings.length} building
            {prefab.buildings.length === 1 ? "" : "s"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
          <p className="text-xs text-muted-foreground">
            Every building sits at an offset from the base's origin. Dragging
            one moves it within the base. Moving the base takes the lot.
          </p>

          {strays.length > 0 && (
            <p className="rounded bg-amber-950/60 px-2 py-1.5 text-[11px] text-amber-200">
              {strays.join(", ")} {strays.length === 1 ? "is" : "are"} not a
              building in this game, so {strays.length === 1 ? "it" : "they"}{" "}
              will spawn off the build grid. Mobile units belong in a group or
              as an actor.
            </p>
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
    </>
  );
}
