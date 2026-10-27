/**
 * The controls that belong to a layout rather than to a base (issue #1416).
 *
 * A base on a map has a team, an origin, a trigger addressable id and a factory
 * queue. None of those travel with the layout, so none of them are here. What is
 * here is everything an author says about the shape itself: what it is called,
 * whether the order it is in was meant, and which of its buildings are standing
 * on ground another one wants.
 *
 * Both editors use these. That is what stops a blueprint edited on a map and one
 * edited on bare ground being two different things with two different sets of
 * rules.
 */

import { plural } from "@lingui/core/macro";
import { useLingui as useLocale } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, cn, Input } from "@picoframe/frame";
import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  ListOrdered,
  Mountain,
  Play,
} from "lucide-react";
import { useState } from "react";
import type { TerrainStep } from "@/blueprint/model";
import { OffGridNote } from "@/blueprint/OffGridNote";
import type { OffGridBuilding } from "@/blueprint/offGrid";
import { buildOrderText } from "@/blueprint/order";
import { type BuildEntry, buildSequence } from "@/blueprint/terrainEdit";
import { type UnknownBuilding, unknownUnitsWarning } from "@/blueprint/units";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useFieldText } from "@/lib/useFieldText";
import type { SceneUnchecked } from "./placements";
import { stepName } from "./TerrainControls";

/**
 * What the layout is called, which is what a picker will list it by.
 *
 * Local while it is typed and committed when the box is left, because every edit
 * either editor makes is written to disk.
 *
 * That copy follows the name when the name changes on its own, which is what an
 * undo does and both editors have one (issue #2175). Re-opening the popover this
 * sits in seeds a fresh copy and hid the problem, but an undo taken while the
 * popover is open did not: the box carried on showing the name from before the
 * step back, and the next keystroke wrote it over the restored one.
 */
export function LayoutNameField({
  id,
  name,
  onRename,
}: {
  /** Distinct per mounting, so the label points at this box and not another. */
  id: string;
  name: string;
  onRename: (name: string) => void;
}) {
  const { t } = useLingui();
  const [text, setText] = useFieldText(name);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        <Trans>Blueprint name</Trans>
      </Label>
      <Input
        id={id}
        value={text}
        placeholder={t`What this blueprint is called`}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (text.trim() ? onRename(text) : setText(name))}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 text-xs"
      />
    </div>
  );
}

/**
 * What the button that opens a layout's own controls says (issue #1484).
 *
 * The name, because that is what an author is looking for and the field behind
 * this button is the only way to change it while the editor is running. A
 * rename made here is a step in the editor's history, which is why it is not
 * also offered somewhere quieter: two fields for one name meant one of them
 * went round the way back.
 *
 * The count only for a layout with no name, so the button is never blank. It is
 * said in the corner of the surface and on the library card as well, so this is
 * the third place rather than the only one.
 */
export function layoutTriggerLabel(name: string, buildings: number): string {
  const called = name.trim();
  if (called) return called;
  return plural(buildings, { one: "# building", other: "# buildings" });
}

/** Buildings named by their place in the layout, the way an author counts
 *  them. */
function listed(at: number[]): string {
  return at.map((n) => n + 1).join(", ");
}

/**
 * Which of a layout's buildings cannot be built where they stand, which of them
 * the ground will not take, which of them name a unit this game has not got,
 * which of them nothing has judged at all, and which of its defs are not
 * buildings.
 *
 * All of it is true of the layout wherever it is drawn, so all of it is said the
 * same way in both editors.
 *
 * The unjudged ones are said in slate rather than amber, because an unknown is
 * not a failure and dressing one as a failure is its own kind of lying. Each
 * reason gets its own sentence: "unknown" on its own is nothing anybody can act
 * on, and a game whose units have not been read and a map whose heights will not
 * read are different problems (issue #1491). Those two are not said here at all:
 * they are true of everything on the surface at once, so they are said once
 * under it by {@link UncheckedNote} rather than per base (issue #1496).
 *
 * A layout the build grid disagrees with is said here too, rather than by
 * whoever mounted this, so it is said in the library and the standalone editor
 * as well as on a base (issue #1479).
 */
export function LayoutNotes({
  overlaps,
  unstable,
  tooDeep,
  tooShallow,
  noSlope,
  absent,
  buildings,
  designedFor,
  onMap,
  strays,
  offGrid,
  onSnapToGrid,
}: {
  /** Buildings standing on ground another building wants, by their place in the
   *  layout. Drawn in red on the surface as well. */
  overlaps: number[];
  /** Buildings the map's terrain will not take, by their place in the layout.
   *  Drawn in amber on the surface as well. Empty where there is no map to
   *  check against, which is not the same as everything being fine. */
  unstable?: number[];
  /** Buildings with more water over them than they allow, by their place in the
   *  layout (issue #1459). Drawn in cyan on the surface as well. */
  tooDeep?: number[];
  /** Buildings wanting more water than there is under them (issue #1552). The
   *  same cyan as {@link tooDeep} on the surface, because both are the water
   *  refusing the building. Which way to move it is said here instead. */
  tooShallow?: number[];
  /**
   * Buildings this game gives no slope to check against, by their place in the
   * layout. Drawn as empty dashed squares on the surface as well.
   *
   * Left out while the reads the check depends on are still in flight, so a
   * session that has only just opened is not a wall of warnings that clears
   * itself two seconds later.
   */
  noSlope?: number[];
  /** Buildings whose unit this game has not got, by their place in the layout
   *  (issue #1445). Drawn in violet on the surface as well. Empty before the
   *  game's units have been read, which is not the same as all of them being
   *  units it has. */
  absent?: UnknownBuilding[];
  /** How many buildings the layout has, so a layout the game has none of the
   *  units of can be told from one with a unit missing. */
  buildings?: number;
  /** The map this layout was drawn on, when it says. */
  designedFor?: string;
  /** The map it is standing on now, when it is standing on one. */
  onMap?: string;
  /** Defs in the layout the game does not call buildings. */
  strays: string[];
  /** Buildings the engine will not build where the layout says (issue #1479).
   *  Left out where the game's units have not been read, because without them
   *  every even footprint would be accused. */
  offGrid?: OffGridBuilding[];
  /** Write the drawn positions into the layout, which is what the note above
   *  offers. Given together with `offGrid`: a note nobody can act on would be a
   *  worse thing than the silence it replaces. */
  onSnapToGrid?: () => void;
}) {
  useLocale();
  const elsewhere =
    designedFor !== undefined &&
    designedFor !== "" &&
    onMap !== undefined &&
    onMap !== "" &&
    designedFor !== onMap;
  const overlapList = listed(overlaps);
  const overlapCount = overlaps.length;
  const unstableCount = unstable?.length ?? 0;
  const tooDeepCount = tooDeep?.length ?? 0;
  const tooShallowCount = tooShallow?.length ?? 0;
  const absentCount = absent?.length ?? 0;
  const noSlopeCount = noSlope?.length ?? 0;
  const strayCount = strays.length;
  const unstableList = unstable ? listed(unstable) : "";
  const tooDeepList = tooDeep ? listed(tooDeep) : "";
  const tooShallowList = tooShallow ? listed(tooShallow) : "";
  const absentList = absent ? listed(absent.map((one) => one.index)) : "";
  const noSlopeList = noSlope ? listed(noSlope) : "";
  const strayList = strays.join(", ");

  return (
    <>
      {overlaps.length > 0 && (
        <p className="rounded bg-red-950/60 px-2 py-1.5 text-[11px] text-red-200">
          {plural(overlapCount, {
            one: `Building ${overlapList} stands on ground another building wants, marked in red. The engine builds one of them and refuses the rest.`,
            other: `Buildings ${overlapList} stand on ground another building wants, marked in red. The engine builds one of them and refuses the rest.`,
          })}
        </p>
      )}

      {unstable !== undefined && unstable.length > 0 && (
        <p className="rounded bg-amber-950/60 px-2 py-1.5 text-[11px] text-amber-200">
          {plural(unstableCount, {
            one: `Building ${unstableList} stands on ground too steep for it, marked in amber. The engine refuses to build on a slope past what the unit allows.`,
            other: `Buildings ${unstableList} stand on ground too steep for them, marked in amber. The engine refuses to build on a slope past what the unit allows.`,
          })}
        </p>
      )}

      {/* Both ends of the engine's band are cyan on the surface, so these two
          sentences are what says which way a building has to move (issue
          #1552). */}
      {tooDeep !== undefined && tooDeep.length > 0 && (
        <p className="rounded bg-cyan-950/60 px-2 py-1.5 text-[11px] text-cyan-200">
          {plural(tooDeepCount, {
            one: `Building ${tooDeepList} stands in water too deep for it, marked in cyan. The engine refuses a building with more water over it than its def allows, so it wants shallower water, or dry land.`,
            other: `Buildings ${tooDeepList} stand in water too deep for them, marked in cyan. The engine refuses a building with more water over it than its def allows, so they want shallower water, or dry land.`,
          })}
        </p>
      )}

      {tooShallow !== undefined && tooShallow.length > 0 && (
        <p className="rounded bg-cyan-950/60 px-2 py-1.5 text-[11px] text-cyan-200">
          {plural(tooShallowCount, {
            one: `Building ${tooShallowList} is not in deep enough water, marked in cyan. The engine refuses a naval building out of the sea, so it wants deeper water.`,
            other: `Buildings ${tooShallowList} are not in deep enough water, marked in cyan. The engine refuses a naval building out of the sea, so they want deeper water.`,
          })}
        </p>
      )}

      {absent !== undefined && absent.length > 0 && buildings !== undefined && (
        <p className="rounded bg-violet-950/60 px-2 py-1.5 text-[11px] text-violet-200">
          {absent.length < buildings && (
            <>
              {plural(absentCount, {
                one: `Building ${absentList} is marked in violet.`,
                other: `Buildings ${absentList} are marked in violet.`,
              })}{" "}
            </>
          )}
          {unknownUnitsWarning(absent, buildings)}
          {absent.length >= buildings && (
            <>
              {" "}
              <Trans>Every one of them is marked in violet.</Trans>
            </>
          )}
        </p>
      )}

      {noSlope !== undefined && noSlope.length > 0 && (
        <p className="rounded bg-slate-800/70 px-2 py-1.5 text-[11px] text-slate-300">
          {plural(noSlopeCount, {
            one: `Building ${noSlopeList} is dashed because this game gives it no slope to check against, so nothing can say whether the ground will take it.`,
            other: `Buildings ${noSlopeList} are dashed because this game gives them no slope to check against, so nothing can say whether the ground will take them.`,
          })}
        </p>
      )}

      {elsewhere && (
        <p className="rounded bg-slate-800/70 px-2 py-1.5 text-[11px] text-slate-300">
          <Trans>
            Drawn for {designedFor}. A blueprint shaped around one map's terrain
            does not always fit another's.
          </Trans>
        </p>
      )}

      {strays.length > 0 && (
        <p className="rounded bg-amber-950/60 px-2 py-1.5 text-[11px] text-amber-200">
          {plural(strayCount, {
            one: `${strayList} is not a building in this game, so it will spawn off the build grid. Mobile units belong in a group or as an actor.`,
            other: `${strayList} are not a building in this game, so they will spawn off the build grid. Mobile units belong in a group or as an actor.`,
          })}
        </p>
      )}

      {offGrid !== undefined && onSnapToGrid !== undefined && (
        <OffGridNote offGrid={offGrid} onSnap={onSnapToGrid} />
      )}
    </>
  );
}

/**
 * What is true of everything on the surface at once, said once under it (issue
 * #1496).
 *
 * The dashed squares are the at-a-glance signal, and they work by contrast: a
 * square with no verdict reads as one because there is a plain square beside it.
 * On a surface where nothing has been checked there is no contrast to read, and
 * the reason was two clicks away in a popover, per base. This is that reason
 * said once, in the open, and it is the only place either sentence lives now.
 *
 * The map's heights carry a second fact, which is the drawing rather than the
 * check: the models are standing on the flat because there was no relief to
 * stand them on (issue #1497). Both are said in one breath, so "this map's
 * heights could not be read" is not on screen twice.
 */
export function UncheckedNote({
  unchecked,
  flattened,
}: {
  /** Why nothing drawn has a verdict, from `sceneUnchecked`. Null once anything
   *  has been checked, and while the reads are still in flight. */
  unchecked: SceneUnchecked;
  /** Whether the units are drawn on flat ground because the map's heights would
   *  not read. True with no map involved never happens: flat ground with no map
   *  is level on purpose and is known exactly. */
  flattened?: boolean;
}) {
  if (unchecked === null && flattened !== true) return null;

  return (
    <p className="w-fit rounded bg-slate-800/80 px-2 py-1 text-[11px] text-slate-300 backdrop-blur">
      {flattened === true && (
        <>
          <Trans>
            This map's heights could not be read, so every unit here is drawn on
            flat ground rather than at the height the engine will stand it at.
          </Trans>{" "}
        </>
      )}
      {unchecked === "no-units" && (
        <Trans>
          Coilbox has not read this game's units. Nothing here has been checked
          against the ground, so every square is dashed rather than clean.
        </Trans>
      )}
      {unchecked === "no-ground" &&
        (flattened === true ? (
          <Trans>
            Nothing here has been checked against the ground either, for want of
            a height to check it against.
          </Trans>
        ) : (
          <Trans>
            This map's heights could not be read. Nothing here has been checked
            against the ground, so every square is dashed rather than clean.
          </Trans>
        ))}
    </p>
  );
}

/**
 * A map with no water on it, said once for the whole surface (issue #1536).
 *
 * The other half of {@link UncheckedNote}'s job. A layout of naval buildings on
 * a landlocked map is refused wherever it stands, so the surface fills with cyan
 * squares and the note under the base names all twenty of them and repeats the
 * general rule. Neither says the thing an author can act on, which is that this
 * map has no sea and no amount of moving the base will find one.
 *
 * So it is said here, once, about the map, and the per base sentence is left out
 * where this one is showing. Cyan, like the squares it is explaining, because a
 * statement about a mark that is not in the mark's colour is one more thing to
 * work out.
 */
export function WaterlessNote({
  floor,
}: {
  /** The map's lowest ground in elmos, from `sceneWaterless`. Null where there
   *  is water on the map, or where nothing has been refused for want of it. */
  floor: number | null;
}) {
  if (floor === null) return null;
  const lowest = Math.round(floor);

  return (
    <p className="w-fit rounded bg-cyan-950/80 px-2 py-1 text-[11px] text-cyan-200 backdrop-blur">
      <Trans>
        This map has no water on it: nothing on it is below the waterline, and
        its lowest ground is {lowest} elmos. Every building here that needs
        water is refused wherever it stands, marked in cyan. This blueprint
        wants a map with a coast rather than a different spot on this one.
      </Trans>
    </p>
  );
}

/**
 * What this layout is built in, and whether that is a claim or an accident.
 *
 * The list is the layout's own array, so moving a building up the list is the
 * whole of changing a build order. There is nothing else holding a sequence that
 * this could be out of step with.
 *
 * Off, the list is not shown at all. A layout whose order nobody meant has an
 * order all the same, and drawing it as steps would invite an author to read one
 * into what is only the order they happened to click in.
 */
export function BuildOrderPopover({
  buildings,
  index,
  ordered,
  onOrdered,
  onMoveBuilding,
  onPlay,
  terrain,
  selectedStep = -1,
  onMoveEntry,
}: {
  buildings: { def: string }[];
  /** Which building is selected, shown in green so a step can be found on the
   *  surface. -1 when nothing is. */
  index: number;
  ordered: boolean;
  onOrdered: (on: boolean) => void;
  onMoveBuilding: (index: number, delta: number) => void;
  onPlay: () => void;
  /**
   * The layout's terrain steps, listed among the buildings where they come in
   * the order, by an editor that offers the terrain tools (issue #4793). Left
   * out, the list is the buildings alone, as it always was.
   */
  terrain?: readonly TerrainStep[];
  /** Which step is selected, in green like a building. -1 when none is. */
  selectedStep?: number;
  /** A place in the order moved, when `terrain` is given. */
  onMoveEntry?: (entry: BuildEntry, delta: 1 | -1) => void;
}) {
  const { t } = useLingui();
  const entries = terrain
    ? buildSequence(buildings.length, terrain)
    : buildings.map((_, at): BuildEntry => ({ kind: "building", index: at }));
  const stepCount = entries.length;
  const move = (entry: BuildEntry, delta: 1 | -1) =>
    onMoveEntry
      ? onMoveEntry(entry, delta)
      : onMoveBuilding(entry.index, delta);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        buildOrderText({ ordered, buildings }),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard may be unavailable. Nothing is lost: the order is on
      // screen and the document holds it.
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs">
          <ListOrdered className="size-3.5" />
          {ordered
            ? plural(stepCount, {
                one: "Build order · # step",
                other: "Build order · # steps",
              })
            : t`Build order`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="layout-ordered" className="text-xs font-medium">
            <Trans>Build these in this order</Trans>
          </Label>
          <Switch
            id="layout-ordered"
            checked={ordered}
            onCheckedChange={onOrdered}
          />
        </div>

        {ordered ? (
          <>
            <ol className="max-h-56 space-y-1.5 overflow-y-auto">
              {entries.map((entry, at) => {
                const step =
                  entry.kind === "step" ? terrain?.[entry.index] : undefined;
                const def = step
                  ? stepName(step)
                  : (buildings[entry.index]?.def ?? "");
                const picked = step
                  ? entry.index === selectedStep
                  : entry.index === index;
                return (
                  <li
                    key={`${entry.kind}-${entry.index}`}
                    className="flex items-center gap-2"
                  >
                    <span className="w-4 shrink-0 text-right text-[11px] text-muted-foreground">
                      {at + 1}
                    </span>
                    {step && (
                      <Mountain className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-xs",
                        !step && "font-mono",
                        picked && "text-lime-300",
                      )}
                    >
                      {def}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-7 p-0"
                      aria-label={t`Build ${{ def }} sooner`}
                      disabled={at === 0}
                      onClick={() => move(entry, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-7 p-0"
                      aria-label={t`Build ${{ def }} later`}
                      disabled={at === entries.length - 1}
                      onClick={() => move(entry, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ol>

            <p className="text-[11px] text-muted-foreground">
              <Trans>
                The selected building is the one in green. The order is the
                blueprint itself, so a base placed from it anywhere is built the
                same way.
              </Trans>
            </p>

            <div className="flex items-center gap-1.5 border-t border-border/60 pt-3">
              <Button
                size="sm"
                variant="outline"
                className="h-7 flex-1 gap-1.5 px-2 text-xs"
                onClick={onPlay}
                disabled={entries.length < 2}
              >
                <Play className="size-3.5" /> <Trans>Watch it go up</Trans>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 flex-1 gap-1.5 px-2 text-xs"
                onClick={copy}
              >
                <ClipboardCopy className="size-3.5" />
                {copied ? t`Copied` : t`Copy as a build order`}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            <Trans>
              These buildings are in the order they were clicked, which is not
              an opening. Turn this on to say what gets built first, and the
              blueprint becomes a build order that can be followed, watched and
              shared.
            </Trans>
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
