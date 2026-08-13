/**
 * Saying a layout in another side's buildings (issue #1314).
 *
 * Pure, and given everything it needs: the layout, the game's units and whatever
 * the game's own naming says about its sides. That is what makes it renderable in
 * a test, which matters more here than anywhere else in the library, because the
 * thing worth being sure of is that a swap which moves the layout says so before
 * it is applied rather than after.
 *
 * The whole surface is one list, one row per unit type the layout names, and the
 * row is the same row whether coilbox suggested the substitute or the person
 * picked it. A game whose sides coilbox cannot tell apart gets the same list with
 * nothing filled in, which is the manual route and is still far quicker than
 * drawing the layout again.
 *
 * Nothing refuses. A conversion that moves buildings or leaves two of them
 * fighting over ground is still one somebody may want, so the warnings are said
 * plainly and the button stays.
 */

import { Button } from "@picoframe/frame";
import { ArrowRight, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Label } from "@/components/ui/label";
import type { UnitDatasetEntry } from "@/content/bindings";
import { UnitDefSelect } from "@/content/pages/components/UnitDefSelect";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { ArrivalNote } from "../../arrival";
import { buildingFootprints } from "../../footprint";
import type { BaseBlueprint } from "../../model";
import {
  layoutDefs,
  planForSide,
  revertSubstitution,
  type SideUnits,
  type SubstitutionPlan,
  sideOfDef,
  substituteBlueprint,
  substitutedCount,
  substitutionNotes,
} from "../../substitution";
import { knownUnits } from "../../units";

export function SubstitutionPanel({
  layout,
  sides,
  units,
  unitsLoading = false,
  onApply,
}: {
  layout: BaseBlueprint;
  /** The game's sides and what its units are named, or empty when the game's own
   *  names say nothing coilbox can read a mapping out of. */
  sides: readonly SideUnits[];
  /** The game's units. Empty until they have been read, which is when nothing
   *  can be checked and nothing can be suggested. */
  units: UnitDatasetEntry[];
  unitsLoading?: boolean;
  /** The converted layout, for whoever owns it to keep. */
  onApply: (layout: BaseBlueprint) => void;
}) {
  const defs = useMemo(() => layoutDefs(layout), [layout]);
  const known = useMemo(() => knownUnits(units), [units]);
  const footprintOf = useMemo(
    () => (units.length > 0 ? buildingFootprints(units) : undefined),
    [units],
  );

  // The side the layout is not already in, so the panel opens on the conversion
  // somebody came here for rather than on an empty form.
  const [toSide, setToSide] = useState(() => otherSide(defs, sides));
  /** What the person said, over what the game's naming suggested. An empty
   *  string is a def they have decided to leave alone. */
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const suggested = useMemo(
    () => planForSide(defs, toSide, sides, known),
    [defs, toSide, sides, known],
  );

  const plan: SubstitutionPlan = {};
  for (const def of defs) {
    const key = def.toLowerCase();
    const pick = Object.hasOwn(chosen, key) ? chosen[key] : suggested[key];
    if (pick) plan[key] = pick;
  }

  const preview = substituteBlueprint(layout, plan, footprintOf);
  const notes = substitutionNotes(preview.report);
  const swapping = preview.report.substituted.length;
  const already = substitutedCount(layout);

  return (
    <div className="flex flex-col gap-4 p-4">
      {units.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {unitsLoading
            ? "Reading this game's units."
            : "Coilbox has not read this game's units, so it cannot offer substitutes or check that they fit. Install the game and open this again."}
        </p>
      ) : sides.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor="substitute-side" className="text-xs font-medium">
            Say this layout in
          </Label>
          <OptionSelect
            value={toSide}
            onValueChange={(side) => {
              setToSide(side);
              setChosen({});
            }}
            options={sides.map((side) => ({
              value: side.side,
              label: side.side,
              description: `${side.prefix}…`,
            }))}
            placeholder="Pick a side"
            size="sm"
          />
          <p className="text-xs text-muted-foreground">
            Suggested from what this game calls each side's units, and only
            where the game has the unit. Change any of them.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          This game says nothing about which of its buildings are each side's
          version of the same thing, so there is nothing to suggest. Pick a
          substitute for each one and the rest of the layout, its spacing and
          its build order, is kept.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {defs.map((def) => (
          <SubstituteRow
            key={def.toLowerCase()}
            def={def}
            count={
              layout.buildings.filter(
                (one) => one.def.toLowerCase() === def.toLowerCase(),
              ).length
            }
            to={plan[def.toLowerCase()] ?? ""}
            units={units}
            unitsLoading={unitsLoading}
            footprint={footprintOf}
            onPick={(pick) =>
              setChosen((was) => ({ ...was, [def.toLowerCase()]: pick }))
            }
          />
        ))}
      </ul>

      {notes.map((note) => (
        <NoteLine key={note.text} note={note} />
      ))}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="flex-1 gap-1.5"
          disabled={swapping === 0}
          onClick={() => onApply(preview.layout)}
        >
          <ArrowRight className="size-4" aria-hidden />
          {swapping === 0
            ? "Nothing to convert"
            : `Convert ${swapping} of ${layout.buildings.length} buildings${toSide ? ` to ${toSide}` : ""}`}
        </Button>
        {already > 0 && (
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              onApply(revertSubstitution(layout, footprintOf).layout)
            }
          >
            <Undo2 className="size-4" aria-hidden />
            Put {already === 1 ? "it" : "them"} back
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * One unit type of the layout and what it is being swapped for.
 *
 * The footprints are on the row rather than in a summary, because the size is
 * the reason a substitution moves a layout and this is where somebody is looking
 * when they choose one.
 */
function SubstituteRow({
  def,
  count,
  to,
  units,
  unitsLoading,
  footprint,
  onPick,
}: {
  def: string;
  count: number;
  to: string;
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  /** What each def stands on, or nothing while the game's units are unread,
   *  which is a row that says no size rather than one that guesses at it. */
  footprint?: (def: string) => { x: number; z: number };
  onPick: (def: string) => void;
}) {
  const from = footprint?.(def);
  const into = to ? footprint?.(to) : undefined;
  const resized =
    from !== undefined &&
    into !== undefined &&
    (into.x !== from.x || into.z !== from.z);

  return (
    <li className="flex flex-col gap-1.5 rounded border border-border/50 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-xs">{def}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {count === 1 ? "1 building" : `${count} buildings`}
          {from ? ` · ${from.x} by ${from.z}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <UnitDefSelect
          units={units}
          value={to}
          onValueChange={onPick}
          loading={unitsLoading}
          placeholder="Leave as it is"
          size="sm"
          className="min-w-0 flex-1"
        />
        {to && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="size-8 shrink-0 p-0"
            aria-label={`Leave ${def} as it is`}
            onClick={() => onPick("")}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      {resized && into && from && (
        <p data-tone="resized" className="text-[11px] text-amber-200">
          {to} stands on {into.x} by {into.z} build squares rather than {from.x}{" "}
          by {from.z}, so it will not stand where {def} does.
        </p>
      )}
    </li>
  );
}

/** One thing worth knowing before the layout changes, in the weight the rest of
 *  the app gives it: a warning is a banner and a note is not. */
function NoteLine({ note }: { note: ArrivalNote }) {
  return (
    <p
      data-tone={note.tone}
      className={
        note.tone === "warn"
          ? "rounded bg-amber-950/60 px-2 py-1.5 text-xs text-amber-200"
          : "text-xs text-muted-foreground"
      }
    >
      {note.text}
    </p>
  );
}

/**
 * The side to open on: the first one the layout is not already written in.
 *
 * A layout is normally all one side's, so this is the conversion somebody opened
 * the panel to do. Empty when the game offers no sides to read, which is the
 * manual route.
 */
function otherSide(
  defs: readonly string[],
  sides: readonly SideUnits[],
): string {
  if (sides.length === 0) return "";
  const mine = new Set(
    defs
      .map((def) => sideOfDef(def, sides))
      .filter((side) => side !== undefined)
      .map((side) => side.side),
  );
  return (sides.find((side) => !mine.has(side.side)) ?? sides[0]).side;
}
