/**
 * What a decoded blueprint is, shown before it is kept (issue #1439).
 *
 * Its own component, and a pure one: the whole point of the import surface is
 * that a person sees what they are taking and what is wrong with it before
 * anything lands, so it is worth being able to render that and read it back.
 * `./ArrivingBlueprint.test.ts` is that evidence, and it is the only way to
 * look at this without the hub, somebody's published layout and the game it
 * names all being present at once.
 *
 * Nothing here refuses. A layout for a game this machine has not got, or one
 * naming units it has not got, is still a layout somebody can want, so the
 * warning changes the button's words rather than taking it away.
 *
 * The side conversion is offered here rather than only afterwards (issue
 * #1467), because a layout shared by an Armada player is the moment a Cortex
 * player wants it in their own buildings. It is not the same question as the
 * rest of the screen: both sides live in one game, so an Armada layout has
 * nothing missing for a Cortex player and every check above it passes. What can
 * be said is whose buildings it is made of, and only where that can be worked
 * out at all, which is `sideOffer` in `../../substitution.ts`.
 */

import { Button } from "@picoframe/frame";
import { Blocks, Download, Loader2, Repeat } from "lucide-react";

import type { ArrivalNote, BlueprintArrival } from "../../arrival";
import type { BlueprintPayload } from "../../payload";
import type { SideOffer } from "../../substitution";
import { LayoutThumb } from "./LayoutThumb";

/** Taking the layout as a side other than the one it was drawn in. */
export interface ArrivingConversion {
  offer: SideOffer;
  /** The side it is being taken as, empty for the one it was drawn in. */
  takingAs: string;
  /** What the swap does to the layout, from `substitutionNotes`. Empty while
   *  nothing is being swapped. */
  notes: ArrivalNote[];
  /** Take it as that side, or as the side it was drawn in for an empty one. */
  onTakeAs: (side: string) => void;
}

export function ArrivingBlueprint({
  payload,
  arrival,
  busy,
  onTake,
  conversion,
}: {
  payload: BlueprintPayload;
  arrival: BlueprintArrival;
  busy: boolean;
  onTake: () => void;
  /** Absent whenever the layout's side could not be told, which includes every
   *  layout whose game is not installed. Nothing said beats a guess. */
  conversion?: ArrivingConversion;
}) {
  const buildings = payload.buildings.length;

  return (
    <div className="flex flex-col gap-3 border-t p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded border border-border/50 bg-muted/20">
          {buildings > 0 ? (
            <LayoutThumb layout={payload} />
          ) : (
            <Blocks className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{arrival.name}</span>
          <span className="text-xs text-muted-foreground">
            {buildings} building{buildings === 1 ? "" : "s"}
            {payload.ordered ? " · build order" : ""}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {payload.game?.name ?? "No game named"}
          </span>
        </div>
      </div>

      {arrival.notes.map((note) => (
        <ArrivalLine key={note.text} note={note} />
      ))}

      {conversion && <SideChoice conversion={conversion} />}

      <Button onClick={onTake} disabled={busy} aria-busy={busy}>
        {busy ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
        ) : (
          <Download className="mr-1.5 size-4" aria-hidden />
        )}
        {arrival.foreign ? "Keep it anyway" : "Add to my library"}
      </Button>
    </div>
  );
}

/**
 * Which side's buildings to take the layout in (issue #1467).
 *
 * One button per side rather than a form, because the whole choice is which
 * side, and the mapping under it is the game's own naming with every candidate
 * already checked against the game's units. Anybody wanting to pick the
 * substitutes one at a time can convert the kept layout, where that form lives.
 *
 * The wording claims only what was worked out. Coilbox knows whose buildings the
 * layout names and cannot know which side the person plays, so this offers
 * rather than warns, and the layout is kept as it arrived until somebody says
 * otherwise.
 */
function SideChoice({ conversion }: { conversion: ArrivingConversion }) {
  const { offer, takingAs, notes, onTakeAs } = conversion;

  return (
    <div className="flex flex-col gap-2 rounded border border-border/50 p-2">
      <p className="text-xs text-muted-foreground">
        Every building of this layout is {offer.from}'s, and this game has{" "}
        {offer.to.length === 1 ? `${offer.to[0]}'s` : "the other sides'"}{" "}
        version of it. Coilbox does not know which side you play, so it is kept
        as {offer.from} unless you say otherwise.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={takingAs === "" ? "default" : "outline"}
          className="gap-1.5"
          onClick={() => onTakeAs("")}
        >
          Keep it as {offer.from}
        </Button>
        {offer.to.map((side) => (
          <Button
            key={side}
            type="button"
            size="sm"
            variant={takingAs === side ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => onTakeAs(side)}
          >
            <Repeat className="size-3.5" aria-hidden />
            Take it as {side}
          </Button>
        ))}
      </div>
      {notes.map((note) => (
        <ArrivalLine key={note.text} note={note} />
      ))}
    </div>
  );
}

/** One thing worth knowing before taking the layout. A warning is given the
 *  weight of a banner and a note is not, because a layout for a game you have
 *  not got and a layout renamed to avoid a twin are not the same news. */
function ArrivalLine({ note }: { note: ArrivalNote }) {
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
