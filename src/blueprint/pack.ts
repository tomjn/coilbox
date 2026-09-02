/**
 * A file holding somebody else's whole collection of layouts (issue #1313).
 *
 * The community gallery is a closed site behind a Discord login, so the only way
 * out of it is the `blueprints.json` it hands you, and what that file holds is
 * thirty other people's bases. Reading it as one blob and dropping all thirty
 * into the library is not useful: most of a pack is not for you, some of it is
 * for another game entirely, and two of them are called the same thing.
 *
 * So a pack is read the way a person reads one. Every layout is a row that can
 * be looked at and ticked, the rows can be put in an order that makes skimming
 * fast, and the ones this game cannot place say so and sink rather than being
 * studied. Nothing is kept until it is ticked.
 *
 * Everything here is pure, and none of it is a new file format: the reading is
 * `./format.ts`, which already parses the game's own file, preserves what it
 * cannot read and reports what conversion changed. What this adds is the bulk:
 * where each layout stood, what taking it would be called, whether this game can
 * place it, and one sentence about the file rather than one per layout.
 *
 * The surface is `./pages/components/ArrivingPack.tsx`, and where a taken layout
 * says it came from is `BlueprintSource` in `./library.ts`.
 *
 * The other half of reading a pack is making one (issue #1474), and it is at
 * the bottom of this file. Making one is not a second format or a second way to
 * write a file: it is `./gameFile.ts` given several layouts instead of one, so
 * the copy before the write, the refusal while a game is running and everything
 * the file already held hold for the set exactly as they do for one. What is
 * here is the same thing the reading half adds, in the other direction: what a
 * whole set loses on the way out, and what the write did to the file.
 */

import type { InstalledGameInfo } from "../container/gameIdentity";
import type { Facing } from "../scenario/model";
import {
  type ArrivalNote,
  type BlueprintArrival,
  blueprintArrival,
} from "./arrival";
import { type EquivalenceTable, NO_EQUIVALENTS } from "./equivalents";
import type { Footprint, SnapBuilding } from "./footprint";
import type { BlueprintFormat } from "./format";
import type { MergeOutcome } from "./gameFile";
import type { StoredBlueprint } from "./library";
import type { BaseBlueprint } from "./model";
import type { BlueprintPayload } from "./payload";
import {
  distinctDefs,
  gameSideNames,
  layoutSide,
  planForSide,
  type SideUnits,
  type SubstitutionReport,
  substitutePayload,
} from "./substitution";
import { blueprintPayload } from "./transfer";
import { type KnownUnits, unknownBuildings } from "./units";

/**
 * One layout out of a pack: the shape, where it stood in the file, and what
 * reading it changed.
 *
 * `index` is the only thing telling two entries of one name apart, and a pack
 * really does hold two entries of one name, so it is the key a row is drawn and
 * ticked by rather than the name.
 */
export interface PackEntry extends Omit<BaseBlueprint, "id"> {
  /** Where it stands among the layouts read, counting from zero. Not quite
   *  where it stands in the file, which also counts the entries no reader here
   *  can make a layout of. */
  index: number;
  /** Quarter turns the file's own facing was worth, already applied to the
   *  buildings. Zero for most. */
  turned: Facing;
  /** How many of its buildings the build grid moved. Zero when the file's
   *  positions were already where the engine would put them, and when there
   *  were no footprints to judge by. */
  snapped: number;
  /** What the file said about it that a layout has nowhere to keep. */
  dropped: string[];
}

/** Everything one pack file holds. */
export interface BlueprintPack {
  entries: PackEntry[];
  /** Entries the file holds that no reader here can make a layout of. They are
   *  still the file's, and nothing here writes to the file. */
  unreadable: number;
}

/**
 * Every layout a pack file holds.
 *
 * `snap` puts each building where the engine would build it, and comes from the
 * game's units. Without it the file's own numbers come through untouched, which
 * is the right answer for a machine that cannot read the game rather than a
 * confident guess.
 *
 * The unit check is deliberately not done here. Which game a pack is for is a
 * choice a person makes after opening it, because the game's own file names no
 * game, and re-reading the file each time they change their mind would throw
 * away the answer to "which of these fit?" they are trying to find.
 */
export function readBlueprintPack(
  format: BlueprintFormat,
  text: string,
  snap?: SnapBuilding,
): BlueprintPack {
  const report = format.read(text, snap);
  return {
    entries: report.blueprints.map((imported, at) => ({
      ...imported.layout,
      index: at,
      turned: imported.turned,
      snapped: imported.snapped.length,
      dropped: imported.dropped,
    })),
    unreadable: report.unreadable,
  };
}

/** How much of a layout this game can place. */
export type PackFit =
  /** Every unit in it is here. */
  | "all"
  /** Some of it is here, so it is still most of a base. */
  | "some"
  /** None of it is here, so it belongs to another game or another side. */
  | "none"
  /** The game's units have not been read, so nothing has been looked at. */
  | "unchecked";

/** One layout of a pack, as the person choosing sees it. */
export interface PackPick {
  entry: PackEntry;
  /** Ready to keep or to draw, with this game's footprints on it. Converted
   *  already where a side was picked for the pack, because the converted layout
   *  is the one that would be kept. */
  payload: BlueprintPayload;
  /** What taking it would be called, and what is worth knowing first. */
  arrival: BlueprintArrival;
  fit: PackFit;
  /** Whether it is ticked. */
  taking: boolean;
  /** What the pack's side did to this one, or nothing when no side was picked. */
  converted?: PackConverted;
}

/* -------------------------------------------------------------------------- *
 * Taking a whole pack as one side (issue #1492).
 *
 * The conversion was deliberately left out when packs were built, because the
 * single-layout form is a row of buttons and thirty of those is not a surface.
 * The shape that does work is one choice for the pack, since a pack is normally
 * one player's layouts and so one player's side.
 *
 * Two things follow, and both are what make it honest rather than convenient.
 * The choice is a target side rather than a swap, so a pack that turns out to
 * hold two players' layouts still converts: each one is read for its own side
 * and moved towards the one picked. And every layout says what the choice did to
 * it, including the ones it did nothing to, because "this applies to 24 of your
 * 30" is the fact somebody needs and a silent row is a layout they will find out
 * about later.
 *
 * Both sides of a game live in one game, so none of this is a fault being
 * reported. An Armada layout has nothing missing for a Cortex player and every
 * check the pack surface makes passes. What can be said is whose buildings they
 * are made of.
 * -------------------------------------------------------------------------- */

/** What the pack's chosen side did to one layout. */
export interface PackConverted {
  state: /** Some or all of it is now said in the chosen side's buildings. */
    | "converted"
    /** It was already that side's, so there was nothing to say. */
    | "already"
    /** Nothing in it could be, so it is kept exactly as it arrived. */
    | "cannot";
  report: SubstitutionReport;
}

/** How a whole pack is being taken. */
export interface PackConversion {
  /** The side to say every layout in. Empty takes them as they are. */
  toSide: string;
  /** The game's sides, from its own unit naming. */
  sides: readonly SideUnits[];
  /** What this game has already been told (issue #1468). */
  table?: EquivalenceTable;
  /** How much ground each def stands on, for re-snapping a swapped building.
   *  Absent where the game's units have not been read, which is when nothing is
   *  checked after a swap. */
  footprintOf?: (def: string) => Footprint;
}

/** One side a whole pack could be taken as. */
export interface PackSideChoice {
  side: string;
  /** Layouts it would change. */
  converts: number;
  /** Layouts already drawn in it, which it leaves exactly as they are. */
  already: number;
  /** Layouts it can do nothing for, whether because nothing in them belongs to
   *  a side or because this game has no version of what is in them. */
  untouched: number;
}

/** Which sides a pack is worth offering to be taken as. */
export interface PackSideOffer {
  /** The sides its layouts are drawn in, in the game's own order. Usually one. */
  from: string[];
  /** Layouts no side could be read off at all, which a choice cannot help. */
  sideUnknown: number;
  /** Every side that would change at least one layout, in the game's own order.
   *  Never empty. */
  choices: PackSideChoice[];
}

/**
 * What taking this pack as each side would do.
 *
 * Nothing at all unless some side would change something, so a pack already all
 * one side's, or one for a game whose sides cannot be told apart and that
 * nobody has answered anything about, gets no offer rather than a choice that
 * does nothing.
 *
 * A layout whose own side cannot be told still counts as one a side would
 * change, because a target side is a target rather than a swap: whatever in it
 * belongs to another side moves and the rest stays. How many of those there are
 * is said on its own, so a pack somebody has mixed two sides into is a thing the
 * reader can see rather than a number quietly folded into the rest.
 */
export function packSideOffer(
  entries: readonly { buildings: readonly { def: string }[] }[],
  sides: readonly SideUnits[],
  known: KnownUnits,
  table: EquivalenceTable = NO_EQUIVALENTS,
): PackSideOffer | undefined {
  const each = entries.map((entry) => {
    const defs = distinctDefs(entry.buildings.map((one) => one.def));
    return { defs, side: layoutSide(defs, sides, table) };
  });
  const all = gameSideNames(sides, table);

  const choices = all
    .map((side) => {
      let converts = 0;
      let already = 0;
      let untouched = 0;
      for (const one of each) {
        if (one.side === side) already += 1;
        else if (
          Object.keys(planForSide(one.defs, side, sides, known, table)).length >
          0
        ) {
          converts += 1;
        } else untouched += 1;
      }
      return { side, converts, already, untouched };
    })
    .filter((choice) => choice.converts > 0);
  if (choices.length === 0) return undefined;

  return {
    from: all.filter((side) => each.some((one) => one.side === side)),
    sideUnknown: each.filter((one) => one.side === undefined).length,
    choices,
  };
}

/**
 * What the pack's side did to one layout, said on its row.
 *
 * Short, because it is said thirty times. A row that changed says how much of it
 * changed, a row that did not says why not, and a swap that moved the layout or
 * left it fighting over ground says so as a warning: the whole reason a
 * conversion is shown before it is kept is that it can quietly break a base.
 */
export function packConversionNotes(
  converted: PackConverted,
  toSide: string,
  buildings: number,
): ArrivalNote[] {
  if (converted.state === "already") {
    return [{ tone: "note", text: `Already ${toSide}'s.` }];
  }
  if (converted.state === "cannot") {
    return [
      {
        tone: "note",
        text: `Nothing in it could be said in ${toSide}, so it is kept as it is.`,
      },
    ];
  }

  const { substituted, moved, overlapping } = converted.report;
  const notes: ArrivalNote[] = [
    {
      tone: "note",
      text: `${substituted.length} of ${buildings} building${buildings === 1 ? "" : "s"} said in ${toSide}.`,
    },
  ];

  const wrong: string[] = [];
  if (overlapping.length > 0) {
    wrong.push(
      `${overlapping.length} will stand on ground another building wants`,
    );
  }
  if (moved.length > 0) {
    wrong.push(`${moved.length} will not stand where they do now`);
  }
  if (wrong.length > 0) {
    notes.push({
      tone: "warn",
      text: `${wrong.join(", and ")}, because the substitutes cover different ground.`,
    });
  }
  return notes;
}

export interface PackPlanInput {
  entries: readonly PackEntry[];
  /** The indexes ticked. */
  taking: ReadonlySet<number>;
  /** The names already in the library. */
  taken: Iterable<string>;
  /** This machine's games, or null while they are still being read. */
  installed: readonly InstalledGameInfo[] | null;
  /** The units of the game the pack is being read against. Absent means the
   *  units have not been read, which is not the same as nothing fitting. */
  known?: KnownUnits;
  /** How much ground each def stands on, from the same game's units. Nothing
   *  for a def that game has not got, and absent where the units have not been
   *  read at all: both mean the layout is kept without a footprint for it. */
  footprintOf?: (def: string) => Footprint | undefined;
  /** The archive name of the game the pack is being read against. */
  gameName?: string;
  /** The side the whole pack is being taken as (issue #1492). Absent, or with
   *  no side named, leaves every layout as it arrived. Nothing is converted
   *  without `known` either, because a substitute nothing has checked is a guess
   *  and this offers none. */
  conversion?: PackConversion;
}

/**
 * What taking each layout of a pack would mean, in the file's own order.
 *
 * Names are threaded through the ticked ones in order: a pack holding two
 * layouts called "Opening solars" taken into a library that already has one
 * gives "Opening solars 2" and "Opening solars 3". Only a ticked layout claims a
 * name, so unticking the first frees the name for the second, and every row's
 * name is the one it would really be kept under right now.
 */
export function packPlan(input: PackPlanInput): PackPick[] {
  const {
    entries,
    taking,
    taken,
    installed,
    known,
    footprintOf,
    gameName,
    conversion,
  } = input;
  const claimed = [...taken];
  return entries.map((entry) => {
    const layout: BaseBlueprint = {
      id: "",
      name: entry.name,
      ...(entry.designedFor ? { designedFor: entry.designedFor } : {}),
      ...(entry.ordered ? { ordered: true } : {}),
      buildings: entry.buildings,
    };
    const drawn = blueprintPayload(layout, {
      footprintOf,
      gameName,
      installed: installed ?? [],
    });

    // The converted layout is the one that would be kept, so everything below
    // reads it: what it would be called, whether this game can place it, and
    // what is drawn on the row.
    const said = convert(entry, drawn, known, conversion);
    const payload = said?.payload ?? drawn;

    const arrival = blueprintArrival({
      payload,
      taken: claimed,
      installed,
      known,
    });
    const isTaking = taking.has(entry.index);
    if (isTaking) claimed.push(arrival.name);
    return {
      entry,
      payload,
      arrival,
      fit: fitOf(payload, arrival, known),
      taking: isTaking,
      ...(said ? { converted: said.converted } : {}),
    };
  });
}

/** One layout of a pack said in the pack's side, or nothing when no side was
 *  picked and nothing when the game's units have not been read. */
function convert(
  entry: PackEntry,
  payload: BlueprintPayload,
  known: KnownUnits | undefined,
  conversion: PackConversion | undefined,
): { payload: BlueprintPayload; converted: PackConverted } | undefined {
  if (!conversion || conversion.toSide === "" || !known) return undefined;
  const { toSide, sides, table, footprintOf } = conversion;

  const defs = distinctDefs(entry.buildings.map((one) => one.def));
  const mine = layoutSide(defs, sides, table);
  const plan = planForSide(defs, toSide, sides, known, table);
  const done = substitutePayload(payload, plan, footprintOf);

  return {
    payload: done.payload,
    converted: {
      state:
        done.report.substituted.length > 0
          ? "converted"
          : mine === toSide
            ? "already"
            : "cannot",
      report: done.report,
    },
  };
}

function fitOf(
  payload: BlueprintPayload,
  arrival: BlueprintArrival,
  known?: KnownUnits,
): PackFit {
  if (!known) return "unchecked";
  if (arrival.foreign) return "none";
  return unknownBuildings(payload.buildings, known).length > 0 ? "some" : "all";
}

/** How the rows are put in front of a reader. */
export type PackOrder =
  /** The ones that fit first, which is the order to skim in. */
  | "fit"
  /** As the file has them, which is the order their author left them in. */
  | "file"
  /** Biggest first, because a pack's real bases are its big ones and its
   *  two building scraps are not worth a look. */
  | "size"
  | "name";

/**
 * The rows in an order, always by the file's own facts.
 *
 * Never by the name a layout would be kept under, which changes as rows are
 * ticked: a list that reorders itself under the cursor is a list nobody can
 * skim.
 */
export function orderPack(picks: PackPick[], order: PackOrder): PackPick[] {
  const sorted = [...picks];
  switch (order) {
    case "fit":
      // Only the ones nothing of which can be placed sink. A layout missing one
      // unit is still most of a base and belongs where its author left it.
      return sorted.sort(
        (a, b) =>
          Number(a.fit === "none") - Number(b.fit === "none") ||
          a.entry.index - b.entry.index,
      );
    case "size":
      return sorted.sort(
        (a, b) =>
          b.entry.buildings.length - a.entry.buildings.length ||
          a.entry.index - b.entry.index,
      );
    case "name":
      return sorted.sort(
        (a, b) =>
          a.entry.name.localeCompare(b.entry.name) ||
          a.entry.index - b.entry.index,
      );
    default:
      return sorted.sort((a, b) => a.entry.index - b.entry.index);
  }
}

export interface PackCounts {
  total: number;
  /** Layouts this game has at least some of the units of. */
  placeable: number;
  /** Layouts this game has none of the units of, which are the ones to skip. */
  unplaceable: number;
  taking: number;
}

export function packCounts(picks: readonly PackPick[]): PackCounts {
  const unplaceable = picks.filter((pick) => pick.fit === "none").length;
  return {
    total: picks.length,
    placeable: picks.length - unplaceable,
    unplaceable,
    taking: picks.filter((pick) => pick.taking).length,
  };
}

/** The indexes of every layout worth taking, for the button that ticks them
 *  all at once. */
export function placeableIndexes(picks: readonly PackPick[]): Set<number> {
  return new Set(
    picks.filter((pick) => pick.fit !== "none").map((pick) => pick.entry.index),
  );
}

/** "1 building" or "3 buildings", so a sentence reads as English. */
function buildings(n: number): string {
  return `${n} building${n === 1 ? "" : "s"}`;
}

/** "1 blueprint" or "3 blueprints", for the same reason. */
function layouts(n: number): string {
  return `${n} blueprint${n === 1 ? "" : "s"}`;
}

/**
 * What reading the whole file changed, in one sentence, or null when it changed
 * nothing.
 *
 * Once for the file rather than once per layout. An import is a conversion and
 * has to say what it did, but thirty rows each admitting to a quarter turn is
 * thirty lines of noise in the middle of the thing a person is trying to skim.
 */
export function packChanges(pack: BlueprintPack): string | null {
  const turned = pack.entries.filter((entry) => entry.turned > 0).length;
  const moved = pack.entries.reduce((sum, entry) => sum + entry.snapped, 0);
  const dropped = [...new Set(pack.entries.flatMap((entry) => entry.dropped))];

  const said: string[] = [];
  if (turned > 0) {
    said.push(
      `turned ${turned} of them onto the facing the game places ${turned === 1 ? "it" : "them"} at`,
    );
  }
  if (moved > 0) said.push(`moved ${buildings(moved)} onto the build grid`);
  if (dropped.length > 0) said.push(`left behind ${dropped.join(", ")}`);
  if (said.length === 0) return null;

  const last = said.pop();
  const all = said.length > 0 ? `${said.join(", ")} and ${last}` : last;
  return `Reading this file ${all}.`;
}

/**
 * What writing a set of layouts into a game's file leaves behind (issue #1474).
 *
 * A single layout's export already names the mission-only fields it drops, and
 * this is the same promise kept for a set: an export is a conversion, so it says
 * what it did before it does it. The three here are the ones a library layout
 * carries that a game's file has nowhere for.
 *
 * The footprints are the one worth understanding. A game does not need them: it
 * reads how much ground a building stands on out of its own units. They matter
 * because a file is also the currency somebody else takes a pack in, and a
 * reader without that game installed has nothing else to draw the layout at the
 * right size with.
 *
 * Where each copy came from is not in the list. It is a fact about your disk
 * rather than about the shape, so it staying behind is the design and not a
 * loss (issue #1473).
 */
export function packStrips(records: readonly StoredBlueprint[]): string[] {
  const designed = records.filter((r) => r.layout.designedFor).length;
  const named = records.filter((r) => r.layout.game?.name).length;
  const sized = records.filter(
    (r) => Object.keys(r.layout.footprints).length > 0,
  ).length;

  const said: string[] = [];
  if (designed > 0) {
    said.push(
      `the map ${layouts(designed)} ${designed === 1 ? "was" : "were"} designed for`,
    );
  }
  if (named > 0) {
    said.push(`which game ${layouts(named)} ${named === 1 ? "is" : "are"} for`);
  }
  if (sized > 0) {
    said.push(
      `the footprints ${layouts(sized)} carr${sized === 1 ? "ies" : "y"}`,
    );
  }
  return said;
}

/**
 * What writing them did to the file, in the words the scenario panel says it
 * for one.
 *
 * Every part of it is a fact the merge reported rather than one this asked for:
 * a layout already in the file under its name replaced the entry where it
 * stood, so a set written twice does not double the file, and an entry no
 * reader here understands was carried through untouched.
 */
export function packWriteSummary(
  dest: string,
  outcome: Omit<MergeOutcome, "text">,
): string {
  const did: string[] = [];
  if (outcome.added.length > 0)
    did.push(`added ${layouts(outcome.added.length)}`);
  if (outcome.replaced.length > 0) {
    did.push(`replaced ${layouts(outcome.replaced.length)}`);
  }
  const kept = outcome.kept;
  return [
    did.length > 0
      ? `Wrote into ${dest}: ${did.join(" and ")}.`
      : `Wrote nothing into ${dest}.`,
    outcome.backup ? `The file it was is kept at ${outcome.backup}.` : null,
    kept > 0
      ? `${kept} entr${kept === 1 ? "y" : "ies"} coilbox cannot read ${kept === 1 ? "was" : "were"} left exactly as ${kept === 1 ? "it was" : "they were"}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}
