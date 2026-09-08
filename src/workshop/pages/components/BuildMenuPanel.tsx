/**
 * One builder's build menu, in the order the game draws it (issue #1274).
 *
 * A unit nothing builds is not in the game, so this is where a mod is actually
 * made: the roster of what a factory or a construction unit offers, with the
 * order it offers them in. Adding, removing and reordering are all here, and
 * the order is a real edit rather than a cosmetic one, because it is the order
 * of the buttons a player looks at.
 *
 * Taking a unit out of this list is not disabling it. The unit still exists,
 * other builders may still build it, and a mission or a battle preset can still
 * restrict it, which is a different mechanism with a different meaning
 * (issue #2649). The wording here says "remove" and never "disable" for that
 * reason.
 *
 * One button here does edit the unit's own definition, and it is the exception
 * rather than the rule (issue #2714). A unit can carry a full roster with its
 * own `builder` field off, and then the engine draws none of these buttons: the
 * menu is there and dead. Four more fields go with it, because `canAssist`,
 * `canReclaim`, `canRepair` and `canRestore` all take their default from
 * `builder`, so the unit has lost repair and reclaim as well as its menu. The
 * warning says that, and offers to switch `builder` back on, because the panel
 * knows exactly which field and which value and sending somebody off to find it
 * among a few hundred rows would be worse. It is an ordinary override: it lands
 * in the field list, it counts as a field change rather than a menu edit, and
 * the page's undo takes it back.
 *
 * So a row has three states, not two. Present is an ordinary row. Removed is
 * gone from the list and offered back under it. Disabled keeps its row and its
 * place, struck through and marked, because the unit is switched off on its own
 * page and not by anything done here: the placement is intact, and switching
 * the unit back on is all it takes to have it again. Showing it as missing
 * would be the conflation the issue is about, and taking the row away would
 * lose the order somebody chose.
 *
 * Cross faction entries get the attention the issue asks for, because giving one
 * side another side's unit is the most common thing anyone does here. The add
 * button opens the picker over the whole game rather than over this builder's
 * own faction, so another side's units are one search away, and a row whose unit
 * belongs to a different faction from the builder says which one.
 *
 * Each row carries the unit's build picture, the same one the add picker beside
 * it has always drawn (issue #2692). This is a list of the buttons a player will
 * look at, and a player finds them by their pictures, so a roster of text was
 * the one place on the page where what the author sees and what the player sees
 * had nothing in common.
 *
 * Reordering is a drag handle on the left of every row (issue #2714). A build
 * menu is the order of the buttons a player looks at, and dragging is how
 * anybody expects to change the order of a short list. It used to be a pair of
 * arrow buttons, which was one move per press and four controls on a row that
 * already had three.
 *
 * The handle answers the keyboard as well as the pointer, because a handle that
 * only takes a mouse takes the feature away from anyone who has not got one.
 * Focus it and the arrow keys move the row one place, Home takes it to the top
 * and End to the bottom. That is the unit list's own set of keys next door
 * (issue #2709), where they move the focus rather than the row, which is the
 * only thing those two lists could sensibly mean by them.
 *
 * Dragging is hand rolled on pointer events rather than a dependency. The
 * `@picoframe` registry has no drag and drop component, this is one short list
 * on one axis, and the whole of it is the geometry below: measure the rows once
 * when the drag starts, count how many of them the pointer has passed, and that
 * count is the position. A library would be more code than the problem.
 *
 * Every reorder, dragged or typed, comes out as one anchor: put this unit before
 * that one, or on the end. That is what `buildMenus.ts` stores, and a drop
 * between two rows is the row below the gap.
 *
 * The panel is a {@link SectionPanel}, the card the field sections under it and
 * the scenario editor's panels already are (issue #2700). It arrives shut unless
 * the project has edited the menu, because it is the one panel on the page whose
 * height is the builder's roster: a commander's is twenty rows the reader
 * scrolls past on the way to the numbers, and the summary says how many there
 * are without opening it. An edited menu arrives open, so somebody's own work is
 * not folded away from them.
 *
 * That is where it starts and not a rule it enforces. The card is uncontrolled,
 * and moving from one builder to the next does not remount it, so whichever way
 * an author left it is the way the next builder's menu opens. Somebody going
 * down a list of factories comparing rosters opens it once, which is worth more
 * than making every unit obey the default again.
 */
import { Button, cn } from "@picoframe/frame";
import {
  GripVertical,
  Hammer,
  Plus,
  RotateCcw,
  TriangleAlert,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SectionPanel } from "@/components/SectionPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type {
  UnitBuildpicsResult,
  UnitDatasetEntry,
  UnitDisplay,
} from "@/content/bindings";
import { UnitIcon } from "@/content/pages/components/UnitIcon";
import { UnitPickerButton } from "@/content/pages/components/UnitPicker";
import type { UnitClones } from "../../clones";
import { type DisabledUnits, isUnitDisabled } from "../../disabled";

export function BuildMenuPanel({
  builderKey,
  builderName,
  builderFlag,
  inherited,
  menu,
  edited,
  units,
  clones,
  disabled,
  nameOf,
  picOf,
  picsPending,
  buildpics,
  factionOf,
  gameName,
  gameArchive,
  enginePath,
  dataDir,
  onAdd,
  onRemove,
  onMoveBefore,
  onEnableBuilder,
  onReset,
}: {
  /** The builder whose menu this is, as a lowercased def key. */
  builderKey: string;
  builderName: string;
  /** Whether the unit's own `builder` field is on, after the project's edits.
   *  Off with a roster present is the dead menu the warning is about. */
  builderFlag: boolean;
  /** What the game's own definition builds, before the project's edits. */
  inherited: string[];
  /** What it builds now, which is what the list draws. */
  menu: string[];
  /**
   * Whether the project changes this menu at all, which the page knows and this
   * cannot: a pure reorder adds and removes nothing, so comparing the two lists
   * by membership would say a menu somebody has just reordered is untouched.
   */
  edited: boolean;
  /** Every unit that can be added: the game's, with the project's among them. */
  units: UnitDatasetEntry[];
  clones: UnitClones;
  /** The units the project switches off, which is not a menu edit (#2649). */
  disabled: DisabledUnits;
  /** What to call a unit, resolved by the page against the curated dataset. */
  nameOf: (key: string) => string;
  /** This unit's build picture, from `unitPics.ts` (issue #2692). */
  picOf: (key: string) => UnitDisplay | undefined;
  /** The pictures are still being read, so a row claims nothing about them. */
  picsPending: boolean;
  /** The same read, handed to the picker so opening it does not mount the
   *  game's archives and decode every build picture a second time. */
  buildpics: UnitBuildpicsResult | null;
  /** Which side reaches a unit, over the game's own build graph. Resolved by
   *  the page, which asks it of the left-hand list too. */
  factionOf: (key: string) => string | undefined;
  gameName?: string;
  gameArchive?: string;
  enginePath?: string;
  dataDir?: string;
  onAdd: (unit: string) => void;
  onRemove: (unit: string) => void;
  /** Put `unit` immediately before `before`, or on the end when it is null.
   *  The one shape a reorder takes, which is the shape the store holds. */
  onMoveBefore: (unit: string, before: string | null) => void;
  /** Switch the unit's own `builder` field back on, as an ordinary override. */
  onEnableBuilder: () => void;
  onReset: () => void;
}) {
  // Which faction reaches each unit is the game's answer rather than ours, out
  // of the build graph the picker groups by. Only used here to say when a row
  // crosses a faction line, so a row on the builder's own side says nothing.
  //
  // A builder no side's build graph reaches has no faction, and that is "cannot
  // say" rather than "differs from everything" (issue #2699). Compared against
  // nothing, every row on the menu crosses a line and the whole list is badged,
  // which says exactly as much as badging none of it. Beyond All Reason's
  // underwater Advanced Aircraft Plants are the real case: neither commander
  // builds one, so neither has a side of its own to be compared with.
  const ownFaction = factionOf(builderKey);
  const crossFaction = (unit: string): string | undefined => {
    if (ownFaction === undefined) return undefined;
    const side = factionOf(unit);
    return side === undefined || side === ownFaction ? undefined : side;
  };

  const known = useMemo(
    () => new Set(units.map((u) => u.name.toLowerCase())),
    [units],
  );
  const removed = inherited.filter((unit) => !menu.includes(unit));
  const off = menu.filter((unit) => isUnitDisabled(disabled, unit));

  /**
   * The drag in progress: which unit is held, and where it would land.
   *
   * `to` is an index into the list with the held unit taken out of it, which is
   * the position the anchor is read from. One number rather than a pair,
   * because "before this row" is the only thing a drop means here.
   */
  const [drag, setDrag] = useState<{ unit: string; to: number } | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  /**
   * Every row's vertical middle, measured once when the drag starts.
   *
   * Frozen on purpose. The rows below re-order under the pointer to show where
   * the row would land, and re-measuring them would move the boundary the
   * pointer has just crossed, which is how a list ends up flickering between
   * two positions while the pointer sits still.
   */
  const midpoints = useRef<number[]>([]);

  /** Record a landing position as the anchor the store keeps: the unit this one
   *  goes before, or the end of the list. */
  const moveTo = (unit: string, to: number) => {
    const rest = menu.filter((other) => other !== unit);
    const at = Math.min(Math.max(to, 0), rest.length);
    onMoveBefore(unit, rest[at] ?? null);
  };

  /** The order to draw: the real one, or the one the drag is proposing. */
  const shown = useMemo(() => {
    if (!drag) return menu;
    const rest = menu.filter((unit) => unit !== drag.unit);
    return [...rest.slice(0, drag.to), drag.unit, ...rest.slice(drag.to)];
  }, [menu, drag]);

  // Escape puts a drag back, which is what every other drag anywhere does and
  // the only way out once the pointer is captured.
  useEffect(() => {
    if (!drag) return;
    const cancel = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setDrag(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [drag]);

  const startDrag =
    (unit: string) => (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const list = listRef.current;
      if (!list) return;
      midpoints.current = Array.from(list.children).map((row) => {
        const box = row.getBoundingClientRect();
        return (box.top + box.bottom) / 2;
      });
      // Captured on the list rather than on the handle, because the handle is
      // inside the row and the row moves while the drag is on.
      list.setPointerCapture?.(e.pointerId);
      setDrag({ unit, to: menu.indexOf(unit) });
      // Focused by hand, because the `preventDefault` below is what stops a
      // drag selecting the text it passes over and it takes the click's own
      // focus with it. Somebody who has just dragged a row is the likeliest
      // person to want the arrow keys next.
      e.currentTarget.focus();
      e.preventDefault();
    };

  const onDragMove = (e: ReactPointerEvent<HTMLOListElement>) => {
    if (!drag) return;
    // Count the rows the pointer has passed, skipping the held one. That count
    // is the position in the list without it, which is the anchor's index.
    const from = menu.indexOf(drag.unit);
    let to = 0;
    midpoints.current.forEach((mid, i) => {
      if (i !== from && mid < e.clientY) to += 1;
    });
    if (to !== drag.to) setDrag({ unit: drag.unit, to });
  };

  const endDrag = (e: ReactPointerEvent<HTMLOListElement>) => {
    listRef.current?.releasePointerCapture?.(e.pointerId);
    if (!drag) return;
    setDrag(null);
    moveTo(drag.unit, drag.to);
  };

  /**
   * The same four keys the unit list next door uses, moving the row rather than
   * the focus, which is the only thing they can mean on a handle.
   */
  const onHandleKeyDown =
    (unit: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
      const last = menu.length - 1;
      // Off the real list rather than off the row's drawn position, which is
      // the drag's proposal while one is in progress.
      const index = menu.indexOf(unit);
      const to =
        e.key === "ArrowUp"
          ? index - 1
          : e.key === "ArrowDown"
            ? index + 1
            : e.key === "Home"
              ? 0
              : e.key === "End"
                ? last
                : null;
      if (to === null) return;
      e.preventDefault();
      if (to < 0 || to > last) return;
      moveTo(unit, to);
    };

  return (
    <SectionPanel
      title="Build menu"
      icon={Hammer}
      headingLevel={3}
      defaultOpen={edited}
      contentClassName="flex flex-col gap-2 p-3"
      summary={
        <>
          <span className="truncate">
            {menu.length === 0
              ? "Builds nothing"
              : `${menu.length} unit${menu.length === 1 ? "" : "s"}, in order${
                  off.length > 0 ? `, ${off.length} disabled` : ""
                }`}
          </span>
          {edited && (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-primary">
              changed
            </span>
          )}
        </>
      }
    >
      {!builderFlag && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle className="line-clamp-none">
            {builderName} cannot build, so none of this menu reaches the game
          </AlertTitle>
          <AlertDescription>
            <p>
              Its own <code>builder</code> field is off, so the engine gives it
              none of these buttons. Four more abilities go with it:{" "}
              <code>canAssist</code>, <code>canReclaim</code>,{" "}
              <code>canRepair</code> and <code>canRestore</code> all default to
              whatever <code>builder</code> says, so as things stand this unit
              cannot help build, reclaim, repair or restore either.
            </p>
            <Button variant="outline" size="sm" onClick={onEnableBuilder}>
              <Wrench className="size-3.5" />
              Switch builder on
            </Button>
            <p>
              That one is a change to the unit's own definition rather than to
              this menu, so it lands in the field list and counts as a field
              change. Leave it off if that is what you meant, for a unit whose
              menu is there for something else to turn on.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {menu.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This builder has nothing on its menu. Add a unit to give it one.
        </p>
      ) : (
        <ol
          ref={listRef}
          className="flex flex-col gap-0.5"
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={() => setDrag(null)}
        >
          {shown.map((unit, index) => {
            const faction = crossFaction(unit);
            const label = nameOf(unit);
            const switchedOff = isUnitDisabled(disabled, unit);
            const held = drag?.unit === unit;
            return (
              <li
                key={unit}
                className={cn(
                  "grid grid-cols-[1.5rem_2rem_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1",
                  held
                    ? "bg-accent ring-1 ring-primary/40"
                    : "hover:bg-accent/50",
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 cursor-grab touch-none active:cursor-grabbing"
                  onPointerDown={startDrag(unit)}
                  onKeyDown={onHandleKeyDown(unit)}
                  aria-label={`Reorder ${label}, ${index + 1} of ${menu.length}`}
                  title={`Drag ${label} to move it along the menu, or use the arrow keys. Home sends it to the top and End to the bottom.`}
                >
                  <GripVertical className="size-3.5" />
                </Button>
                <span className="text-right font-mono text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <UnitIcon display={picOf(unit)} pending={picsPending} />
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "truncate text-sm",
                        switchedOff &&
                          "text-muted-foreground line-through decoration-muted-foreground/60",
                      )}
                    >
                      {label}
                    </span>
                    {switchedOff && (
                      <Badge
                        variant="outline"
                        className="shrink-0 text-[10px]"
                        title="This unit is switched off, so it comes off every build menu in the game when this is compiled. Its place here is kept, and switching it back on restores it."
                      >
                        disabled
                      </Badge>
                    )}
                    {faction && (
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-[10px]"
                      >
                        {faction}
                      </Badge>
                    )}
                    {clones[unit] && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        yours
                      </Badge>
                    )}
                    {!known.has(unit) && (
                      <Badge
                        variant="destructive"
                        className="shrink-0 text-[10px]"
                        title="This game has no unit of that name, so the button would do nothing."
                      >
                        not in this game
                      </Badge>
                    )}
                    {!inherited.includes(unit) && (
                      <Badge className="shrink-0 text-[10px]">added</Badge>
                    )}
                  </span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {unit}
                  </span>
                </span>
                <span className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => onRemove(unit)}
                    aria-label={`Remove ${label} from this build menu`}
                    title={`Remove ${label} from this build menu`}
                  >
                    <X className="size-3.5" />
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {/* The last row of the menu rather than a control above it, because
        "and one more" belongs at the end of a list you are editing (issue
        #2714). Lined up on the same grid as the rows, with a dashed box
        where a build picture would be, so it reads as the next row. */}
      <div className="grid grid-cols-[1.5rem_2rem_auto_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1">
        <span aria-hidden />
        <span aria-hidden />
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded border border-dashed border-border text-muted-foreground"
        >
          <Plus className="size-3.5" />
        </span>
        <UnitPickerButton
          units={units}
          gameName={gameName}
          gameArchive={gameArchive}
          enginePath={enginePath}
          dataDir={dataDir}
          buildpics={buildpics}
          size="sm"
          className="w-full"
          value=""
          placeholder="Add a unit to this menu"
          onValueChange={onAdd}
        />
      </div>

      {removed.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border/50 pt-2">
          <span className="text-xs text-muted-foreground">
            Taken off this menu ({removed.length}). Still in the game, and still
            built by anything else that builds it.
          </span>
          <ul className="flex flex-wrap gap-1.5">
            {removed.map((unit) => (
              <li key={unit}>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => onAdd(unit)}
                  title={
                    isUnitDisabled(disabled, unit)
                      ? `Put ${nameOf(unit)} back on this menu. It is switched off as well, so it would come back marked disabled.`
                      : `Put ${nameOf(unit)} back on this menu`
                  }
                >
                  <Undo2 className="size-3" />
                  <span
                    className={cn(
                      isUnitDisabled(disabled, unit) && "line-through",
                    )}
                  >
                    {nameOf(unit)}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Last, under everything it explains (issue #2714). Above the list it
        was read once and then in the way every time after that, on the one
        panel whose height is somebody's roster. */}
      <div className="flex flex-col items-start gap-2 border-t border-border/50 pt-2">
        <p className="text-xs text-muted-foreground">
          What {builderName} offers, in the order the buttons appear. Drag a row
          by its handle to move it, or focus the handle and use the arrow keys.
          The picker covers the whole game, so another side's units go in here
          the same way this side's do. Taking a unit out of this menu does not
          remove it from the game. A unit switched off on its own page keeps its
          place here and is marked disabled instead of disappearing.
        </p>
        {edited && (
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="size-3.5" />
            Reset menu
          </Button>
        )}
      </div>
    </SectionPanel>
  );
}
