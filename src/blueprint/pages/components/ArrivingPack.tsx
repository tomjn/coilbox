/**
 * A pack of somebody else's layouts, shown before any of it is kept (issue
 * #1313).
 *
 * Thirty layouts is a lot to look at, so this is built for skimming rather than
 * for studying. Every layout is drawn, because the picture is what a person
 * recognises a base by and a name like "v3 final" is not. Everything else on a
 * row is the two facts that decide whether to look closer: how big it is, and
 * whether this game can place it.
 *
 * The ones this game cannot place are the useful signal. They are somebody
 * else's game or somebody else's side, nothing in them can be built here, and
 * the fastest thing to do with them is to stop looking: they sink to the bottom
 * and they can be hidden in one go.
 *
 * Pure, and given everything: the picks, the order, what is ticked. That is what
 * makes `./ArrivingPack.test.ts` able to look at it, which matters because the
 * only other way to see this surface is to have a real gallery download and the
 * game it was made for both to hand.
 *
 * Nothing here refuses. A layout none of whose units are here is still one
 * somebody can want, so it stays tickable and only says what it is.
 *
 * The side conversion is one choice for the whole pack (issue #1492), for the
 * same reason everything else here is: thirty of the single import's row of
 * buttons is not a surface. It sits above the list because it changes what every
 * row below it says, and each row then says what the choice did to it, including
 * the rows it did nothing to.
 */

import { Button } from "@picoframe/frame";
import { Blocks, Download, Loader2, Repeat } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { ArrivalNote } from "../../arrival";
import {
  orderPack,
  type PackOrder,
  type PackPick,
  type PackSideOffer,
  packConversionNotes,
  packCounts,
} from "../../pack";
import { LayoutThumb } from "./LayoutThumb";

/** How the rows can be put in front of a reader. Fit first is the default: it
 *  is the order that puts the ones worth a look at the top. */
const ORDERS: { value: PackOrder; label: string }[] = [
  { value: "fit", label: "The ones that fit first" },
  { value: "size", label: "Biggest first" },
  { value: "name", label: "By name" },
  { value: "file", label: "As they are in the file" },
];

export interface PackView {
  order: PackOrder;
  /** Whether the ones this game cannot place at all are out of the list. */
  hideUnplaceable: boolean;
}

/** Taking every layout in the pack as one side (issue #1492). */
export interface ArrivingPackConversion {
  offer: PackSideOffer;
  /** The side they are being taken as, empty for the sides they were drawn in. */
  takingAs: string;
  onTakeAs: (side: string) => void;
}

export function ArrivingPack({
  file,
  picks,
  view,
  onView,
  games,
  game,
  onGame,
  unreadable,
  changes,
  checked,
  conversion,
  busy,
  onToggle,
  onTakeAll,
  onClear,
  onKeep,
}: {
  /** The file these came out of, which is also what a taken layout records. */
  file: string;
  /** Every layout in the pack, in the file's own order. */
  picks: PackPick[];
  view: PackView;
  onView: (view: PackView) => void;
  /** The games on this machine, because the file names none and the choice
   *  decides both what fits and how each layout is drawn. */
  games: string[];
  game: string;
  onGame: (game: string) => void;
  /** Entries in the file no reader here understands. */
  unreadable: number;
  /** What reading the file changed, said once for the file. */
  changes: string | null;
  /** Whether the game's units have been read. Without them nothing has been
   *  checked, which is not the same as everything fitting. */
  checked: boolean;
  /** Absent whenever no side would change anything, which includes every pack
   *  whose game is not installed. Nothing said beats a choice that does nothing. */
  conversion?: ArrivingPackConversion;
  busy: boolean;
  onToggle: (index: number) => void;
  onTakeAll: () => void;
  onClear: () => void;
  onKeep: () => void;
}) {
  const counts = packCounts(picks);
  const shown = orderPack(
    view.hideUnplaceable ? picks.filter((pick) => pick.fit !== "none") : picks,
    view.order,
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="break-all font-mono text-[11px] text-muted-foreground">
        {file}
      </p>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Read them against</span>
        <OptionSelect
          size="sm"
          value={game}
          onValueChange={onGame}
          placeholder="Pick a game"
          disabled={games.length === 0}
          options={games.map((name) => ({ value: name, label: name }))}
        />
        <p className="text-xs text-muted-foreground">
          A game's blueprint file says nothing about which game it is for, so
          pick the one these were drawn in.{" "}
          {checked
            ? `${counts.placeable} of ${counts.total} can be placed in it.`
            : "Its units have not been read, so nothing here has been checked against them."}
        </p>
      </div>

      {conversion && <PackSideChoiceList conversion={conversion} />}

      <div className="flex flex-wrap items-center gap-2">
        <OptionSelect
          className="w-56"
          size="sm"
          value={view.order}
          onValueChange={(order) =>
            onView({ ...view, order: order as PackOrder })
          }
          options={ORDERS}
        />
        <Button size="sm" variant="outline" onClick={onTakeAll}>
          Tick the {counts.placeable} that fit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={counts.taking === 0}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>

      {counts.unplaceable > 0 && (
        <div className="flex items-center gap-2">
          <Switch
            id="pack-hide-unplaceable"
            checked={view.hideUnplaceable}
            onCheckedChange={(on) => onView({ ...view, hideUnplaceable: on })}
          />
          <label
            htmlFor="pack-hide-unplaceable"
            className="text-xs text-muted-foreground"
          >
            Hide the {counts.unplaceable} this game cannot place at all
          </label>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {shown.map((pick) => (
          <PackRow
            key={pick.entry.index}
            pick={pick}
            takingAs={conversion?.takingAs ?? ""}
            onToggle={onToggle}
          />
        ))}
      </ul>

      {changes && (
        <p className="text-[11px] text-muted-foreground">{changes}</p>
      )}

      {unreadable > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {unreadable} other entr{unreadable === 1 ? "y is" : "ies are"} in this
          file that coilbox cannot read. Nothing here writes to the file, so{" "}
          {unreadable === 1 ? "it stays" : "they stay"} exactly as{" "}
          {unreadable === 1 ? "it is" : "they are"}.
        </p>
      )}

      <Button
        disabled={busy || counts.taking === 0}
        aria-busy={busy}
        onClick={onKeep}
      >
        {busy ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
        ) : (
          <Download className="mr-1.5 size-4" aria-hidden />
        )}
        {counts.taking === 0
          ? "Tick the ones you want"
          : `Add ${counts.taking} to my library`}
      </Button>
    </div>
  );
}

/**
 * Which side's buildings to take the whole pack in (issue #1492).
 *
 * One choice for the pack rather than one per layout, because a pack is thirty
 * layouts and thirty forms is not a surface anybody would use. It is also
 * usually one player's collection, so one side is usually the right answer for
 * all of it at once.
 *
 * What the choice does not cover is said here as a number and on each row as a
 * line, which is the half that keeps it honest: "24 of your 30" is the fact
 * somebody needs before they tick anything, and a row a choice did nothing to
 * has to say so rather than look converted.
 */
function PackSideChoiceList({
  conversion,
}: {
  conversion: ArrivingPackConversion;
}) {
  const { offer, takingAs, onTakeAs } = conversion;
  const chosen = offer.choices.find((one) => one.side === takingAs);

  return (
    <div className="flex flex-col gap-2 rounded border border-border/50 p-2">
      <p className="text-xs text-muted-foreground">
        {offer.from.length === 1
          ? `These are ${offer.from[0]}'s layouts, and this game has another side's version of what is in them.`
          : `These layouts are ${offer.from.join(" and ")}'s.`}{" "}
        Coilbox does not know which side you play, so they are kept as they are
        unless you say otherwise.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={takingAs === "" ? "default" : "outline"}
          onClick={() => onTakeAs("")}
        >
          Keep them as they are
        </Button>
        {offer.choices.map((choice) => (
          <Button
            key={choice.side}
            type="button"
            size="sm"
            variant={takingAs === choice.side ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => onTakeAs(choice.side)}
          >
            <Repeat className="size-3.5" aria-hidden />
            Take them all as {choice.side}
          </Button>
        ))}
      </div>
      {chosen && (
        <p className="text-xs text-muted-foreground">
          {chosen.converts} of these are said in {chosen.side} now.
          {chosen.already > 0
            ? ` ${chosen.already} already ${chosen.already === 1 ? "was" : "were"}.`
            : ""}
          {chosen.untouched > 0
            ? ` ${chosen.untouched} ${chosen.untouched === 1 ? "has" : "have"} nothing in ${chosen.side} to be said in, so ${chosen.untouched === 1 ? "it stays" : "they stay"} exactly as ${chosen.untouched === 1 ? "it is" : "they are"}.`
            : ""}
          {offer.sideUnknown > 0
            ? ` ${offer.sideUnknown} of them ${offer.sideUnknown === 1 ? "is" : "are"} made of more than one side's buildings, so what ${offer.sideUnknown === 1 ? "it was" : "they were"} cannot be told.`
            : ""}
        </p>
      )}
    </div>
  );
}

/** One layout of the pack: the picture, what it is, and what is wrong with it. */
function PackRow({
  pick,
  takingAs,
  onToggle,
}: {
  pick: PackPick;
  /** The side the whole pack is being taken as, empty for none. */
  takingAs: string;
  onToggle: (index: number) => void;
}) {
  const { entry, payload, arrival, fit, taking } = pick;
  const buildings = entry.buildings.length;
  const id = `pack-layout-${entry.index}`;
  // Only the warnings. The rename note is on the row already, in the name it
  // would be kept under, and thirty rows repeating it is thirty lines nobody
  // reads.
  const warnings = arrival.notes.filter((note) => note.tone === "warn");
  // What the pack's side did to this one, including nothing, because a row a
  // choice passed over has to say so rather than look converted.
  const converted =
    pick.converted && takingAs
      ? packConversionNotes(pick.converted, takingAs, buildings)
      : [];

  return (
    <li
      data-fit={fit}
      className="flex items-start gap-2.5 rounded border border-border/40 bg-card px-2 py-2"
    >
      <Checkbox
        id={id}
        className="mt-1 shrink-0"
        checked={taking}
        onCheckedChange={() => onToggle(entry.index)}
      />
      <div className="flex h-14 w-16 shrink-0 items-center justify-center rounded border border-border/40 bg-muted/20">
        {buildings > 0 ? (
          <LayoutThumb layout={payload} />
        ) : (
          <Blocks className="size-4 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="truncate text-sm font-medium">
          {entry.name}
        </label>
        <span className="text-[11px] text-muted-foreground">
          {buildings} building{buildings === 1 ? "" : "s"}
          {entry.ordered ? " · build order" : ""}
          {arrival.wasCalled ? ` · kept as "${arrival.name}"` : ""}
        </span>
        {warnings.map((note) => (
          <p
            key={note.text}
            data-tone="warn"
            className={
              fit === "none"
                ? "rounded bg-amber-950/60 px-2 py-1 text-[11px] text-amber-200"
                : "text-[11px] text-amber-200/80"
            }
          >
            {note.text}
          </p>
        ))}
        {converted.map((note) => (
          <ConversionLine key={note.text} note={note} />
        ))}
      </div>
    </li>
  );
}

/** What the pack's side did to one layout. A swap that moves a base is a
 *  warning, because that is the way a conversion quietly breaks one. */
function ConversionLine({ note }: { note: ArrivalNote }) {
  return (
    <p
      data-conversion={note.tone}
      className={
        note.tone === "warn"
          ? "text-[11px] text-amber-200/80"
          : "text-[11px] text-muted-foreground"
      }
    >
      {note.text}
    </p>
  );
}
