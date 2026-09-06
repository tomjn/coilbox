import { Button, Input } from "@picoframe/frame";
import { Loader2, MapPin } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useFieldText } from "@/lib/useFieldText";
import type { Placement } from "@/placement/placements";
import { SelectionBar } from "@/placement/SurfaceBars";
import type { ScenarioUnitsState } from "@/placement/useScenarioUnits";
import type { Point, ScenarioZone } from "../../model";
import { pointFrom } from "./mapKeyboard";
import { zoneExtent } from "./zones";

/**
 * The small presentational bars `ScenarioMapScene.tsx`'s `bars` JSX renders.
 *
 * Held apart from that file the same way its hooks are (issue #2515): each of
 * these takes plain props and reads nothing from the scene's hooks or state
 * directly, so nothing here changed in the move beyond the import paths a
 * different file needs.
 */

/**
 * What is selected, said the way this document names it.
 *
 * The bar itself is shared with the blueprint editor. What is not shared is what
 * a placement is called here: an actor, one of a group's units, or one of a
 * base's buildings.
 */
export function ScenarioSelectionBar({
  placement,
  children,
}: {
  placement: Placement;
  /** Controls for what kind of thing this is: an actor's team and its
   *  overrides, and whatever a group or a base grows later. */
  children?: ReactNode;
}) {
  return (
    <SelectionBar
      def={placement.def}
      what={
        placement.kind === "actor"
          ? "actor"
          : placement.kind === "group"
            ? `group unit ${placement.index + 1}`
            : `base building ${placement.index + 1}`
      }
    >
      {children}
    </SelectionBar>
  );
}

/**
 * How much is selected, and the way to put it all down (issue #2279).
 *
 * Its own bar under the one for the primary, because the two say different
 * things: that one names one thing and opens its panel, this one is the account
 * of what the rail's Turn and Delete are about to act on. Without it the only
 * sign that Delete is about to remove six things is that six plates are lit
 * somewhere on the map, which is not something an author reads before pressing
 * a button.
 *
 * Turning is not here. It was a Turn together button, which swung the whole
 * selection about its own middle where the primary's Turn turned each thing
 * where it stood, and two turns in two places for one selection is a choice
 * nobody asked to be given: an author who picked a cluster and pressed turn
 * meant the cluster. So the rail's Turn does that job for a selection of
 * several, and turning each where it stands is R (issue #2353's other half is
 * still on its own key).
 */
export function SelectionCountBar({
  what,
  onClear,
}: {
  /** The tally, as `countWords` reads it: "4 actors, 1 group and 2 base
   *  buildings". */
  what: string;
  onClear: () => void;
}) {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-primary/60 bg-card p-1 pl-2">
      <span className="text-[11px]">{what} selected</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={onClear}
        title="Let go of all of it (Esc)"
      >
        Clear
      </Button>
    </div>
  );
}

/**
 * The selected zone: its name and its size.
 *
 * The name is what triggers pick a zone by, so it is the one thing about a zone
 * that cannot be set by dragging and the only field here. It is committed when
 * the box is left rather than on every keystroke, because every change to the
 * document is written to disk.
 *
 * What the handles do is not said. The zone is on screen with its handles drawn
 * on it in two colours, and a sentence spelling that out was the widest thing in
 * this bar: it pushed the size off the end of a narrow window to explain a drag
 * an author works out by doing it once.
 *
 * Mounted per zone by its id, so moving the selection reseeds the box. A zone's
 * id is not its name, so renaming one does not reseed it, and the box has to
 * follow the name when the name changes on its own. That is what an undo does
 * (issue #2185): before this, the box carried on showing the name from before
 * the step back, and the next keystroke wrote it over the restored one.
 */
export function ZoneBar({
  zone,
  onRename,
}: {
  zone: ScenarioZone;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useFieldText(zone.name);
  const { halfX, halfZ } = zoneExtent(zone);
  const size =
    zone.shape === "circle"
      ? `circle · radius ${zone.radius}`
      : `box · ${Math.round(halfX * 2)} × ${Math.round(halfZ * 2)}`;

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed) onRename(trimmed);
    else setName(zone.name);
  };

  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-card/85 p-1 pl-2 backdrop-blur">
      <Input
        aria-label="Zone name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-7 w-40 text-xs"
      />
      <span className="font-mono text-[11px] text-muted-foreground">
        {size}
      </span>
    </div>
  );
}

/**
 * A question the map is waiting for an answer to: a path being drawn, a base
 * being moved, or a point a trigger asked for.
 *
 * Its own bar rather than a line in the panel that asked, because while one of
 * these is outstanding the click that answers it is also the click that would
 * otherwise place something, and that is worth saying where it cannot be missed.
 *
 * It also carries the answer that needs no map at all: two numbers typed in
 * (issue #2269). A trigger's point is often one an author already knows, copied
 * off another trigger or read out of a start position, and aiming a 3D view at a
 * number you already have is work nobody should have to do. It is also the one
 * way of answering that asks nothing of eyesight or of a steady hand.
 */
export function ClickMapBar({
  message,
  onDone,
  onAt,
  worldWidth,
  worldHeight,
}: {
  message: ReactNode;
  onDone: () => void;
  /** Answer with a point, exactly as a click on the map would. Left out when
   *  the map has nothing to answer with, which is a question whose asker has
   *  gone. */
  onAt?: ((pos: Point) => void) | null;
  worldWidth: number;
  worldHeight: number;
}) {
  return (
    <div className="flex w-fit flex-wrap items-center gap-1.5 rounded-md border border-lime-400/60 bg-card/85 p-1 pl-2 backdrop-blur">
      <MapPin className="size-3.5 text-lime-300" />
      <span className="text-[11px]">{message}</span>
      {onAt && (
        <PointFields
          onAt={onAt}
          worldWidth={worldWidth}
          worldHeight={worldHeight}
        />
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={onDone}
      >
        Done
      </Button>
    </div>
  );
}

/**
 * Two numbers and a button, as the answer to a point the map is waiting for.
 *
 * Held to the map, because a point off it is a point the mission cannot use, and
 * cleared after each answer so a question that takes several points is several
 * pairs of numbers rather than an editing job.
 */
function PointFields({
  onAt,
  worldWidth,
  worldHeight,
}: {
  onAt: (pos: Point) => void;
  worldWidth: number;
  worldHeight: number;
}) {
  const [x, setX] = useState("");
  const [z, setZ] = useState("");
  const at = pointFrom(x, z, worldWidth, worldHeight);

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (!at) return;
        onAt(at);
        setX("");
        setZ("");
      }}
    >
      <Input
        aria-label="X in elmos"
        inputMode="numeric"
        placeholder="x"
        value={x}
        onChange={(event) => setX(event.target.value)}
        className="h-7 w-16 text-xs"
      />
      <Input
        aria-label="Z in elmos"
        inputMode="numeric"
        placeholder="z"
        value={z}
        onChange={(event) => setZ(event.target.value)}
        className="h-7 w-16 text-xs"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={!at}
        className="h-7 px-2 text-xs"
      >
        Use
      </Button>
    </form>
  );
}

/**
 * The selected waypoint: which order's path it belongs to, the group's own
 * controls, and the way to take the point out. Dragging it is what moves it, so
 * there is nothing else here.
 *
 * The group's controls are here because a point on a path is one of the two ways
 * of working on a group, and the other one used to be the only one that reached
 * them (#842).
 */
export function PathBar({
  what,
  hint,
  children,
}: {
  what: string;
  hint: string;
  /** The group's controls: its team, its units and its orders. */
  children?: ReactNode;
}) {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-card p-1 pl-2">
      <span className="font-mono text-[11px]">{what}</span>
      {children}
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </div>
  );
}

/**
 * What was drawn, and what could not be.
 *
 * A scenario can name a unit its game does not have, either because it was
 * written for a different game or because the def was renamed. Those are drawn
 * as marker boxes, which look deliberate enough to be mistaken for a feature, so
 * the count says plainly that they are not units.
 */
export function UnitsNote({
  units,
  gameName,
  drawing,
}: {
  units: ScenarioUnitsState;
  gameName: string;
  drawing: boolean;
}) {
  if (units.placed === 0) return null;
  // Said while the game's units or their models are still being read, in
  // place of a verdict on what could not be drawn: nothing is missing until
  // the read has finished.
  const reading =
    units.load.unitDefs === "loading" || units.load.models.state === "loading";

  const problem = units.gameMissing
    ? `${gameName || "The scenario's game"} is not installed, so nothing can be drawn with its models.`
    : units.missing.length > 0
      ? `${units.missing.length} unit type${units.missing.length === 1 ? "" : "s"} not in ${gameName}, drawn as boxes: ${units.missing.join(", ")}`
      : null;

  return (
    // The corner is the surface's, which stacks this above the view controls.
    <>
      {problem && !reading && (
        <p className="rounded bg-amber-950/70 px-2 py-1 text-[11px] text-amber-200 backdrop-blur">
          {problem}
        </p>
      )}
      <p className="flex items-center gap-1 rounded bg-card/70 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
        {reading || drawing ? (
          <>
            <Loader2 className="size-3 animate-spin" />
            Reading units
          </>
        ) : (
          `${units.placed} unit${units.placed === 1 ? "" : "s"}`
        )}
      </p>
    </>
  );
}
