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
 * Every row a person fills in is then remembered for that game and used first
 * next time (issue #1468), which is why the manual route is a route rather than
 * a punishment: the tenth layout of a game costs nothing because the first nine
 * answered the questions. That is the only reason a queued unit ever converts,
 * since no reading of `armpw` reaches `corak`. Correcting a row is how a wrong
 * answer is corrected, here and for every later layout.
 *
 * A row also asks which side the building is, where nothing else can say (issue
 * #1527). That is what a game whose unit names say nothing about its sides needs
 * before its table can start, and it is asked on the rows that need it and
 * nowhere else, because being asked to classify a game's whole unit list before
 * anything works is not a feature.
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
import { ArrowRight, BookOpen, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Label } from "@/components/ui/label";
import type { UnitDatasetEntry } from "@/content/bindings";
import { UnitDefSelect } from "@/content/pages/components/UnitDefSelect";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { ArrivalNote } from "../../arrival";
import {
  coveredDefsBySource,
  type DefsBySource,
  type EquivalenceTable,
  NO_EQUIVALENTS,
} from "../../equivalents";
import { buildingFootprints } from "../../footprint";
import type { BaseBlueprint } from "../../model";
import {
  defsNeedingSide,
  distinctDefs,
  gameSideNames,
  layoutDefs,
  planForSide,
  queueNote,
  queueReport,
  revertSubstitution,
  type SaidSides,
  type SideUnits,
  type SubstitutionPlan,
  sideNameOfDef,
  substituteBlueprint,
  substitutedCount,
  substitutionNotes,
  substitutionPairs,
} from "../../substitution";
import { knownUnits } from "../../units";

const NO_QUEUE: readonly string[] = [];

export function SubstitutionPanel({
  layout,
  queued = NO_QUEUE,
  sides,
  table = NO_EQUIVALENTS,
  units,
  unitsLoading = false,
  onApply,
  onRemember,
  onReadShipped,
  readingShipped = false,
  shippedNote,
}: {
  layout: BaseBlueprint;
  /** Every unit this base's factories are told to build, in the order they are
   *  queued and repeats and all. Empty for a layout on its own, which has no
   *  queues: a queue is the mission's half of a placement (issue #1493). */
  queued?: readonly string[];
  /** The game's sides and what its units are named. A side with no prefix is one
   *  whose units are not named after it, which is a side to pick and nothing to
   *  read off a def. Empty for a game with no sides at all. */
  sides: readonly SideUnits[];
  /** What this game has already been told, which beats any name (issue #1468).
   *  Empty for a game nobody has answered anything about yet, and for a caller
   *  that has no game to key one by. */
  table?: EquivalenceTable;
  /** The game's units. Empty until they have been read, which is when nothing
   *  can be checked and nothing can be suggested. */
  units: UnitDatasetEntry[];
  unitsLoading?: boolean;
  /** The converted layout and the plan that converted it, for whoever owns them
   *  to keep. The plan comes back rather than being worked out again, because a
   *  substitute somebody picked by hand is in it and a fresh derivation would
   *  lose it. Empty for a revert, which changes no queue. */
  onApply: (layout: BaseBlueprint, plan: SubstitutionPlan) => void;
  /** Hold onto one thing this conversion said about the game, for the next
   *  layout of it. Absent for a caller with no game to key a table by, which is
   *  a panel that suggests from names alone and teaches nothing. */
  onRemember?: (
    fromSide: string,
    fromDef: string,
    toSide: string,
    toDef: string,
  ) => void;
  /** Go and read the table this game publishes, if it publishes one (issue
   *  #1526). Absent for a caller with no game to go and read, which is every
   *  caller that cannot reach unitsync. */
  onReadShipped?: () => void;
  readingShipped?: boolean;
  /** What the last read found, or nothing before one. */
  shippedNote?: string;
}) {
  const defs = useMemo(() => layoutDefs(layout), [layout]);
  const queuedDefs = useMemo(() => distinctDefs(queued), [queued]);
  const known = useMemo(() => knownUnits(units), [units]);
  const footprintOf = useMemo(
    () => (units.length > 0 ? buildingFootprints(units) : undefined),
    [units],
  );
  const sideNames = useMemo(() => gameSideNames(sides, table), [sides, table]);

  // The side the layout is not already in, so the panel opens on the conversion
  // somebody came here for rather than on an empty form.
  const [toSide, setToSide] = useState(() => otherSide(defs, sides, table));
  /** What the person said, over what the game's naming suggested. An empty
   *  string is a def they have decided to leave alone. */
  const [chosen, setChosen] = useState<Record<string, string>>({});
  /** Which side the person said a building is, for the ones nothing else can
   *  say (issue #1527). Kept across a change of side, because whose a building
   *  is does not depend on what it is being converted to. */
  const [said, setSaid] = useState<SaidSides>({});

  const suggested = useMemo(
    () => planForSide([...defs, ...queuedDefs], toSide, sides, known, table),
    [defs, queuedDefs, toSide, sides, known, table],
  );

  const plan: SubstitutionPlan = {};
  for (const def of [...defs, ...queuedDefs]) {
    const key = def.toLowerCase();
    const pick = Object.hasOwn(chosen, key) ? chosen[key] : suggested[key];
    if (pick) plan[key] = pick;
  }

  // The buildings being swapped that nothing can file under a side, and the
  // sides they could be. A def cannot be the side it is being converted to, so
  // that one is not offered (issue #1527).
  const needsSide = defsNeedingSide(plan, sides, table);
  const sideChoices = sideNames.filter((side) => side !== toSide);

  const preview = substituteBlueprint(layout, plan, footprintOf);
  const notes = substitutionNotes(preview.report);
  const queues = queueReport(queued, plan, sides, toSide, table);
  const stranded = queueNote(queues, toSide);
  const swapping = preview.report.substituted.length;
  const already = substitutedCount(layout);
  const learned = coveredDefsBySource(table);

  /**
   * Convert, and hold onto what converting said about this game (issue #1468).
   *
   * Every pair, not only the ones picked by hand: a suggestion somebody looked
   * at and applied is an answer too, and holding onto it is what makes the
   * naming route's right answers survive into a game release that renames the
   * units it was reading.
   *
   * Including the sides the person said, which are the only thing that gets a
   * pair filed at all for a game whose names say nothing (issue #1527).
   */
  const apply = () => {
    for (const pair of substitutionPairs(plan, toSide, sides, table, said)) {
      onRemember?.(pair.fromSide, pair.fromDef, pair.toSide, pair.toDef);
    }
    onApply(preview.layout, plan);
  };
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
      ) : sideNames.length > 0 ? (
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
            options={sideNames.map((side) => ({
              value: side,
              label: side,
              description: sides.find((one) => one.side === side)?.prefix
                ? `${sides.find((one) => one.side === side)?.prefix}…`
                : undefined,
            }))}
            placeholder="Pick a side"
            size="sm"
          />
          <p className="text-xs text-muted-foreground">
            Suggested from what this game calls each side's units, and only
            where the game has the unit. Change any of them.
          </p>
          {learned.all > 0 && (
            <p className="text-xs text-muted-foreground">
              {heldNote(learned)} Correcting one here corrects it for the next
              layout as well. All of them are listed on this game's page under
              Content, where one can be dropped without converting anything.
            </p>
          )}
          {onReadShipped && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              disabled={readingShipped}
              onClick={onReadShipped}
            >
              <BookOpen className="size-3.5" aria-hidden />
              {readingShipped
                ? "Reading this game's own pairings"
                : "Read this game's own pairings"}
            </Button>
          )}
          {shippedNote && (
            <p className="text-xs text-muted-foreground">{shippedNote}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          This game says nothing about which of its buildings are each side's
          version of the same thing, so there is nothing to suggest. Pick a
          substitute for each one and the rest of the layout, its spacing and
          its build order, is kept.
        </p>
      )}

      {needsSide.length > 0 && sideChoices.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Coilbox cannot tell which side{" "}
          {needsSide.length === 1 ? "one" : "some"} of these belong to, so it
          cannot remember the swap for next time. Say which side and it will.
          Converting works either way.
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
            side={said[def.toLowerCase()] ?? ""}
            sideChoices={
              needsSide.includes(def.toLowerCase()) ? sideChoices : undefined
            }
            onSide={(side) =>
              setSaid((was) => ({ ...was, [def.toLowerCase()]: side }))
            }
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
                side={said[def.toLowerCase()] ?? ""}
                sideChoices={
                  needsSide.includes(def.toLowerCase())
                    ? sideChoices
                    : undefined
                }
                onSide={(side) =>
                  setSaid((was) => ({ ...was, [def.toLowerCase()]: side }))
                }
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
          onClick={apply}
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

/**
 * What this game has already been told, and by whom (issue #1544).
 *
 * Whose is the point. Counting the lot as what this person converted was true
 * when converting was the only way into the table, and stopped being true when
 * coilbox learned to read a game's own published one: Beyond All Reason's
 * brings 87 answers in one go, so the sentence would tell somebody they picked
 * answers nobody here gave. It reads worst for the person who suspects one is
 * wrong, which is the person the table is for.
 *
 * A kind coilbox holds none of is not mentioned, so a table that came entirely
 * from converting still reads as one sentence about that.
 */
function heldNote(held: DefsBySource): string {
  const kinds: { alone: string; among: string }[] = [];
  if (held.you > 0)
    kinds.push({
      alone: "all of them ones you picked while converting",
      among: `${held.you} you picked while converting`,
    });
  if (held.game > 0)
    kinds.push({
      alone: "all of them brought by this game's own published table",
      among: `${held.game} brought by this game's own published table`,
    });
  if (held.unsaid > 0)
    kinds.push({
      alone:
        "all of them from before coilbox recorded where an answer came from",
      among: `${held.unsaid} from before coilbox recorded where an answer came from`,
    });

  const answers = `Coilbox also has answers for ${held.all} of this game's unit${held.all === 1 ? "" : "s"} and uses those first`;
  if (kinds.length === 1) return `${answers}, ${kinds[0].alone}.`;

  const among = kinds.map((kind) => kind.among);
  const last = among[among.length - 1];
  return `${answers}: ${among.slice(0, -1).join(", ")} and ${last}.`;
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
 *
 * Which side the building is, on the row too, and only on the rows where nothing
 * can say (issue #1527). That is the least this can be asked: never for a game
 * that names its sides' units after them, never for a building being left alone,
 * never for one this game has already been told about, and never twice, because
 * answering is what puts it in the table.
 */
function SubstituteRow({
  def,
  what,
  to,
  units,
  unitsLoading,
  footprint,
  side,
  sideChoices,
  onSide,
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
  /** Which side the person has said this building is, or empty for one they
   *  have not been asked about or not answered. */
  side: string;
  /** The sides this building could be said to be, or nothing at all for a row
   *  whose side is not in question. */
  sideChoices?: string[];
  onSide: (side: string) => void;
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
      {sideChoices && sideChoices.length > 0 && (
        <OptionSelect
          value={side}
          onValueChange={onSide}
          options={sideChoices.map((one) => ({ value: one, label: one }))}
          placeholder={`Say which side it is, so ${def} is remembered`}
          size="sm"
        />
      )}
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
 * the panel to do. Empty when neither the game's naming nor its table offers a
 * side to read, which is the manual route.
 */
function otherSide(
  defs: readonly string[],
  sides: readonly SideUnits[],
  table: EquivalenceTable,
): string {
  const all = gameSideNames(sides, table);
  if (all.length === 0) return "";
  const mine = new Set(
    defs
      .map((def) => sideNameOfDef(def, sides, table))
      .filter((side) => side !== undefined),
  );
  return all.find((side) => !mine.has(side)) ?? all[0];
}
