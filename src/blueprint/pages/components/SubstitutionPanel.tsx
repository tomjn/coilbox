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
 *
 * A base placed in a mission also hands over the units its factories are told to
 * build (issue #1493), which get the same row and the same rule. They are a
 * second list rather than more of the first because they are a different kind of
 * thing: a queue holds no ground, so nothing on those rows is about size, and
 * the naming route reaches far fewer of them, so expect to pick most of them by
 * hand. A layout on its own has no queues and none of this shows.
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
  distinctDefs,
  layoutDefs,
  planForSide,
  queueNote,
  queueReport,
  revertSubstitution,
  type SideUnits,
  type SubstitutionPlan,
  sideOfDef,
  substituteBlueprint,
  substitutedCount,
  substitutionNotes,
} from "../../substitution";
import { knownUnits } from "../../units";

const NO_QUEUE: readonly string[] = [];

export function SubstitutionPanel({
  layout,
  queued = NO_QUEUE,
  sides,
  units,
  unitsLoading = false,
  onApply,
}: {
  layout: BaseBlueprint;
  /** Every unit this base's factories are told to build, in the order they are
   *  queued and repeats and all. Empty for a layout on its own, which has no
   *  queues: a queue is the mission's half of a placement (issue #1493). */
  queued?: readonly string[];
  /** The game's sides and what its units are named, or empty when the game's own
   *  names say nothing coilbox can read a mapping out of. */
  sides: readonly SideUnits[];
  /** The game's units. Empty until they have been read, which is when nothing
   *  can be checked and nothing can be suggested. */
  units: UnitDatasetEntry[];
  unitsLoading?: boolean;
  /** The converted layout and the plan that converted it, for whoever owns them
   *  to keep. The plan comes back rather than being worked out again, because a
   *  substitute somebody picked by hand is in it and a fresh derivation would
   *  lose it. Empty for a revert, which changes no queue. */
  onApply: (layout: BaseBlueprint, plan: SubstitutionPlan) => void;
}) {
  const defs = useMemo(() => layoutDefs(layout), [layout]);
  const queuedDefs = useMemo(() => distinctDefs(queued), [queued]);
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
    () => planForSide([...defs, ...queuedDefs], toSide, sides, known),
    [defs, queuedDefs, toSide, sides, known],
  );

  const plan: SubstitutionPlan = {};
  for (const def of [...defs, ...queuedDefs]) {
    const key = def.toLowerCase();
    const pick = Object.hasOwn(chosen, key) ? chosen[key] : suggested[key];
    if (pick) plan[key] = pick;
  }

  const preview = substituteBlueprint(layout, plan, footprintOf);
  const notes = substitutionNotes(preview.report);
  const queues = queueReport(queued, plan, sides, toSide);
  const stranded = queueNote(queues, toSide);
  const swapping = preview.report.substituted.length;
  const already = substitutedCount(layout);
  const converting = [
    swapping > 0
      ? `${swapping} of ${layout.buildings.length} buildings`
      : undefined,
    queues.swapped > 0
      ? `${queues.swapped} queued unit${queues.swapped === 1 ? "" : "s"}`
      : undefined,
  ].filter((one) => one !== undefined);

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
            what={countOf(
              layout.buildings.filter(
                (one) => one.def.toLowerCase() === def.toLowerCase(),
              ).length,
              "building",
            )}
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

      {queuedDefs.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">Queued on this base's factories</p>
          <p className="text-xs text-muted-foreground">
            A queue belongs to the base rather than to the layout, so it is
            converted here and nowhere else. A game names its two sides'
            buildings alike far more often than it names their units alike, so
            expect to pick most of these yourself.
          </p>
          <ul className="flex flex-col gap-2">
            {queuedDefs.map((def) => (
              <SubstituteRow
                key={`queued-${def.toLowerCase()}`}
                def={def}
                what={countOf(
                  queued.filter(
                    (one) => one.toLowerCase() === def.toLowerCase(),
                  ).length,
                  "queued",
                )}
                to={plan[def.toLowerCase()] ?? ""}
                units={units}
                unitsLoading={unitsLoading}
                onPick={(pick) =>
                  setChosen((was) => ({ ...was, [def.toLowerCase()]: pick }))
                }
              />
            ))}
          </ul>
        </div>
      )}

      {notes.map((note) => (
        <NoteLine key={note.text} note={note} />
      ))}

      {stranded && <NoteLine note={stranded} />}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="flex-1 gap-1.5"
          disabled={converting.length === 0}
          onClick={() => onApply(preview.layout, plan)}
        >
          <ArrowRight className="size-4" aria-hidden />
          {converting.length === 0
            ? "Nothing to convert"
            : `Convert ${converting.join(" and ")}${toSide ? ` to ${toSide}` : ""}`}
        </Button>
        {already > 0 && (
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              onApply(revertSubstitution(layout, footprintOf).layout, {})
            }
          >
            <Undo2 className="size-4" aria-hidden />
            Put {already === 1 ? "it" : "them"} back
          </Button>
        )}
      </div>

      {already > 0 && queuedDefs.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Putting the buildings back leaves the queues as they are. A building
          remembers what it was drawn as and a queue does not, so convert to the
          side they came from to put those back.
        </p>
      )}
    </div>
  );
}

/** How many of a thing a row covers, in the words that thing is counted in. */
function countOf(count: number, what: "building" | "queued"): string {
  if (what === "building")
    return count === 1 ? "1 building" : `${count} buildings`;
  if (count === 1) return "queued once";
  return count === 2 ? "queued twice" : `queued ${count} times`;
}

/**
 * One unit type this base names and what it is being swapped for.
 *
 * The footprints are on the row rather than in a summary, because the size is
 * the reason a substitution moves a layout and this is where somebody is looking
 * when they choose one. A queued unit's row has none: a queue holds no ground,
 * so a size on it would be a fact about nothing.
 */
function SubstituteRow({
  def,
  what,
  to,
  units,
  unitsLoading,
  footprint,
  onPick,
}: {
  def: string;
  /** How much of this base the row covers, already counted. */
  what: string;
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
          {what}
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
