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
 * reason, and nothing on this panel touches a unit's own definition.
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
 * Reordering is arrow buttons rather than dragging. A build menu is a short
 * list, one press is one move, and it works from the keyboard, which a drag
 * does not.
 *
 * The panel is a {@link SectionPanel}, the card the field sections under it and
 * the scenario editor's panels already are (issue #2700). It starts shut unless
 * the project has edited the menu, because it is the one panel on the page whose
 * height is the builder's roster: a commander's is twenty rows the reader
 * scrolls past on the way to the numbers, and the summary says how many there
 * are without opening it. An edited menu opens, so somebody's own work is not
 * folded away from them.
 */
import { Button, cn } from "@picoframe/frame";
import { ArrowDown, ArrowUp, Hammer, RotateCcw, Undo2, X } from "lucide-react";
import { useMemo } from "react";
import { SectionPanel } from "@/components/SectionPanel";
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
  onMove,
  onReset,
}: {
  /** The builder whose menu this is, as a lowercased def key. */
  builderKey: string;
  builderName: string;
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
  /** Move one place along the list, -1 for up and 1 for down. */
  onMove: (unit: string, delta: number) => void;
  onReset: () => void;
}) {
  // Which faction reaches each unit is the game's answer rather than ours, out
  // of the build graph the picker groups by. Only used here to say when a row
  // crosses a faction line, so a row on the builder's own side says nothing.
  const ownFaction = factionOf(builderKey);
  const crossFaction = (unit: string): string | undefined => {
    const side = factionOf(unit);
    return side === undefined || side === ownFaction ? undefined : side;
  };

  const known = useMemo(
    () => new Set(units.map((u) => u.name.toLowerCase())),
    [units],
  );
  const removed = inherited.filter((unit) => !menu.includes(unit));
  const off = menu.filter((unit) => isUnitDisabled(disabled, unit));

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
      <div className="flex flex-wrap items-center gap-2">
        <UnitPickerButton
          units={units}
          gameName={gameName}
          gameArchive={gameArchive}
          enginePath={enginePath}
          dataDir={dataDir}
          buildpics={buildpics}
          size="sm"
          className="w-64"
          value=""
          placeholder="Add a unit to this menu"
          onValueChange={onAdd}
        />
        {edited && (
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="size-3.5" />
            Reset menu
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        What {builderName} offers, in the order the buttons appear. The picker
        covers the whole game, so another side's units go in here the same way
        this side's do. Taking a unit out of this menu does not remove it from
        the game. A unit switched off on its own page keeps its place here and
        is marked disabled instead of disappearing.
      </p>

      {menu.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This builder has nothing on its menu. Add a unit to give it one.
        </p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {menu.map((unit, index) => {
            const faction = crossFaction(unit);
            const label = nameOf(unit);
            const switchedOff = isUnitDisabled(disabled, unit);
            return (
              <li
                key={unit}
                className="grid grid-cols-[2rem_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50"
              >
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
                    disabled={index === 0}
                    onClick={() => onMove(unit, -1)}
                    aria-label={`Move ${label} up`}
                    title={`Move ${label} up`}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={index === menu.length - 1}
                    onClick={() => onMove(unit, 1)}
                    aria-label={`Move ${label} down`}
                    title={`Move ${label} down`}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
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
    </SectionPanel>
  );
}
