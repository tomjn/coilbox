/**
 * A set of your own layouts, shown before any of it is written (issue #1474).
 *
 * The mirror of `./ArrivingPack.tsx`. That one is built for skimming somebody
 * else's thirty layouts, and this one is built for picking a handful of your
 * own, so it is the same row with the same drawing and none of the "can this
 * game place it" reasoning: these are your layouts, and you know.
 *
 * Two destinations, and they are not the same thing. A game's own
 * `blueprints.json` is what makes a set usable in game, and a file somewhere
 * else is what you post for somebody to open. Both are the same write through
 * the same care in `../../gameFile.ts`: the file is copied first, nothing is
 * written into a file a running game will write back over, and everything the
 * file already held is kept.
 *
 * Which is where the two destinations stop being interchangeable (issue #1488).
 * A running game rewrites its own file and no other, so it stops the write into
 * a game's file and leaves the one being posted alone. That needs a directory to
 * compare a destination against, and without one there is nothing to reason with
 * and both are stopped, which is what both did before.
 *
 * Pure, and given everything, which is what makes `./LeavingPack.test.ts` able
 * to look at it without a library, a game or a file dialog to hand.
 */

import { Button } from "@picoframe/frame";
import { Blocks, Download, FileUp, Loader2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { recordGameName, type StoredBlueprint } from "../../library";
import { LayoutThumb } from "./LayoutThumb";

export function LeavingPack({
  records,
  taking,
  strips,
  gameFile,
  gameRunning,
  keepsProvenance,
  busy,
  onToggle,
  onAll,
  onClear,
  onWriteToGame,
  onWriteToFile,
}: {
  /** Every layout in the library, newest edit first. */
  records: readonly StoredBlueprint[];
  /** The ids ticked. */
  taking: ReadonlySet<string>;
  /** What writing the ticked ones leaves behind, from `packStrips`. */
  strips: string[];
  /** Where this engine's game keeps its own file, when coilbox knows. Knowing it
   *  is also what lets a running game stop only the write that goes there. */
  gameFile?: string;
  /** Whether a game is running right now, which is a refusal. */
  gameRunning: boolean;
  /** Whether any ticked layout records where your copy came from, which is the
   *  one thing worth saying stays behind rather than being lost. */
  keepsProvenance: boolean;
  busy: boolean;
  onToggle: (id: string) => void;
  onAll: () => void;
  onClear: () => void;
  onWriteToGame: () => void;
  onWriteToFile: () => void;
}) {
  const ticked = records.filter((record) => taking.has(record.id));
  const count = ticked.length;
  const games = new Set(ticked.map(recordGameName).filter(Boolean));
  // A file being posted is one no game reads, so a running game is no reason to
  // stop it. Only once there is a directory to tell one destination from the
  // other: without one every write is the game's own as far as anything here can
  // say (issue #1488).
  const sharingStopped = gameRunning && !gameFile;

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs text-muted-foreground">
        Pick the layouts to put in one file. Coilbox writes them into a game's
        own blueprints file, where the game's own widget reads them, or out to a
        file you can post for somebody else to open. A layout the file already
        holds under the same name replaces that entry where it stands, and the
        file is copied before anything is written to it.
      </p>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {count} of {records.length} ticked
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onAll}>
            Tick every one
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={count === 0}
            onClick={onClear}
          >
            Clear
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {records.map((record) => {
          const buildings = record.layout.buildings.length;
          const game = recordGameName(record);
          const id = `write-pack-${record.id}`;
          return (
            <li
              key={record.id}
              className="flex items-center gap-2 rounded border border-border/40 px-2 py-1.5"
            >
              <Checkbox
                id={id}
                checked={taking.has(record.id)}
                onCheckedChange={() => onToggle(record.id)}
              />
              <span className="flex size-10 shrink-0 items-center justify-center">
                {buildings > 0 ? (
                  <LayoutThumb layout={record.layout} />
                ) : (
                  <Blocks className="size-4 text-muted-foreground" />
                )}
              </span>
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                <span className="block truncate text-sm">
                  {record.layout.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {buildings} building{buildings === 1 ? "" : "s"}
                  {record.layout.ordered ? " · build order" : ""}
                  {game ? ` · ${game}` : ""}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {strips.length > 0 && (
        // The same promise a single layout's export already keeps: an export is
        // a conversion, so it says what it drops before it drops it.
        <p className="text-[11px] text-amber-200/80">
          Writing these leaves behind {strips.join(", ")}. A game's file holds a
          shape, a name and a build order, and works the rest out from the units
          it has. Somebody opening the file without that game installed draws
          each building as one square.
        </p>
      )}

      {keepsProvenance && (
        <p className="text-[11px] text-muted-foreground">
          Where your copy of each of these came from stays here. It is a note
          about your library rather than part of a layout, so it never goes out
          in a file.
        </p>
      )}

      {games.size > 1 && (
        <p className="text-[11px] text-muted-foreground">
          These are for {games.size} different games. A blueprints file says
          nothing about which game it is for, so one file holding all of them is
          exactly what a player who plays both ends up with anyway.
        </p>
      )}

      {gameRunning && (
        <p className="rounded bg-amber-950/60 px-2 py-1.5 text-[11px] text-amber-200">
          A game is running. It writes its whole blueprints file back when it
          saves or exits, so anything written into that file now could be thrown
          away without a word.{" "}
          {sharingStopped
            ? "Coilbox does not know where this engine writes, so it cannot tell that file from any other. Close the game and come back."
            : "Saving a file somewhere else is fine, because no game reads it. Close the game to write into a game's own file."}
        </p>
      )}

      {gameFile && (
        <p className="break-all text-[11px] text-muted-foreground">
          A game's file opens on <span className="font-mono">{gameFile}</span>,
          where your engine writes. Pick another if you keep your games
          somewhere else.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Button
          disabled={busy || count === 0 || gameRunning}
          onClick={onWriteToGame}
        >
          {busy ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
          ) : (
            <Download className="mr-1.5 size-4" aria-hidden />
          )}
          Write{" "}
          {count === 0 ? "them" : count === 1 ? "1 layout" : `${count} layouts`}{" "}
          into a game's file
        </Button>
        <Button
          variant="outline"
          disabled={busy || count === 0 || sharingStopped}
          onClick={onWriteToFile}
        >
          <FileUp className="mr-1.5 size-4" aria-hidden />
          Save {count === 1 ? "it" : "them"} as a file to share
        </Button>
      </div>
    </div>
  );
}
