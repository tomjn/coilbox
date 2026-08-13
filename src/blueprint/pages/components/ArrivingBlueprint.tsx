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
 */

import { Button } from "@picoframe/frame";
import { Blocks, Download, Loader2 } from "lucide-react";

import type { ArrivalNote, BlueprintArrival } from "../../arrival";
import type { BlueprintPayload } from "../../payload";
import { LayoutThumb } from "./LayoutThumb";

export function ArrivingBlueprint({
  payload,
  arrival,
  busy,
  onTake,
}: {
  payload: BlueprintPayload;
  arrival: BlueprintArrival;
  busy: boolean;
  onTake: () => void;
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
