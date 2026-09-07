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
 * Cross faction entries get the attention the issue asks for, because giving one
 * side another side's unit is the most common thing anyone does here. The add
 * button opens the picker over the whole game rather than over this builder's
 * own faction, so another side's units are one search away, and a row whose unit
 * belongs to a different faction from the builder says which one.
 *
 * Reordering is arrow buttons rather than dragging. A build menu is a short
 * list, one press is one move, and it works from the keyboard, which a drag
 * does not.
 */
import { Button } from "@picoframe/frame";
import { ArrowDown, ArrowUp, RotateCcw, Undo2, X } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import type { UnitDatasetEntry } from "@/content/bindings";
import { useUnitsyncGameInfo } from "@/content/config";
import { UnitPickerButton } from "@/content/pages/components/UnitPicker";
import { buildTechForest } from "@/content/techForest";
import type { UnitClones } from "../../clones";

export function BuildMenuPanel({
  builderKey,
  builderName,
  inherited,
  menu,
  edited,
  units,
  clones,
  nameOf,
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
  /** What to call a unit, resolved by the page against the curated dataset. */
  nameOf: (key: string) => string;
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
  // Which faction reaches each unit, which is the game's answer rather than
  // ours: it comes out of the same build graph the picker groups by, over the
  // game's own sides. Only used to say when a row crosses a faction line.
  const { info } = useUnitsyncGameInfo(enginePath, dataDir, gameArchive);
  const sides = useMemo(
    () => (info?.sides ?? []).filter((s) => !!s.startUnit),
    [info],
  );
  const forest = useMemo(
    () =>
      buildTechForest(
        units,
        sides.map((s) => s.startUnit as string),
      ),
    [units, sides],
  );
  const factionName = (unit: string): string | undefined => {
    const own = forest.factionOf.get(builderKey);
    const root = forest.factionOf.get(unit);
    if (!root || root === own) return undefined;
    const side = sides.find((s) => s.startUnit?.toLowerCase() === root);
    return side?.name ?? root;
  };

  const known = useMemo(
    () => new Set(units.map((u) => u.name.toLowerCase())),
    [units],
  );
  const removed = inherited.filter((unit) => !menu.includes(unit));

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border/50 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Build menu</h3>
          <span className="text-xs text-muted-foreground">
            {menu.length === 0
              ? "Builds nothing"
              : `${menu.length} unit${menu.length === 1 ? "" : "s"}, in order`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <UnitPickerButton
            units={units}
            gameName={gameName}
            gameArchive={gameArchive}
            enginePath={enginePath}
            dataDir={dataDir}
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
      </div>

      <p className="text-xs text-muted-foreground">
        What {builderName} offers, in the order the buttons appear. The picker
        covers the whole game, so another side's units go in here the same way
        this side's do. Taking a unit out of this menu does not remove it from
        the game.
      </p>

      {menu.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This builder has nothing on its menu. Add a unit to give it one.
        </p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {menu.map((unit, index) => {
            const faction = factionName(unit);
            const label = nameOf(unit);
            return (
              <li
                key={unit}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50"
              >
                <span className="text-right font-mono text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm">{label}</span>
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
                  title={`Put ${nameOf(unit)} back on this menu`}
                >
                  <Undo2 className="size-3" />
                  {nameOf(unit)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
