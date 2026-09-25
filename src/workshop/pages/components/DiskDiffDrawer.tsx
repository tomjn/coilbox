/**
 * The disk diff behind the edit-in-place route (issue #2636).
 *
 * A game author who has been tweaking a loose `.sdd` in coilbox commits the
 * result to git afterwards, and wants to see exactly what changed before
 * deciding to keep it, the way the other delivery routes let you read what
 * the compiler produced (`CompiledLuaDrawer`, issue #2653). Without this, the
 * only way to answer that question is to leave coilbox and run `git diff`.
 *
 * `workshop_in_place_diffs` reads a line diff of every file the edit-in-place
 * route has touched, backup against current, or the whole file as an addition
 * when coilbox created it. `diskDiff.ts` collapses a long run of unchanged
 * lines to a count either side of a change, so a one-line edit in a 300-line
 * file reads as one.
 *
 * Undo and accept live here too, over the same commands and the same confirm
 * popover `InPlaceWrite` offers, since reviewing the diff and deciding what to
 * do with it is one motion. `onDone` follows the write, undo and accept path
 * `InPlaceWrite` already uses, so the caller refreshes the same way either
 * control was pressed from.
 */
import { Button, Drawer } from "@picoframe/frame";
import { useCallback, useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { collapseContext } from "../../diskDiff";
import {
  type FileDiff,
  type LineChange,
  workshopAcceptInPlace,
  workshopInPlaceDiffs,
  workshopUndoInPlace,
} from "../../inPlace";
import type { InPlaceDone } from "../../inPlaceProject";

type Busy = "undo" | "accept" | null;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function lineClass(kind: LineChange): string {
  if (kind === "added") return "bg-emerald-500/10";
  if (kind === "removed") return "bg-destructive/10";
  return "";
}

function FileDiffView({ file }: { file: FileDiff }) {
  const items = collapseContext(file.lines);
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <h3 className="flex items-center gap-2 font-mono text-muted-foreground text-xs">
        {file.file}
        {file.created && (
          <span className="rounded border border-border/60 px-1.5 py-0.5 font-sans text-[0.65rem]">
            New file
          </span>
        )}
      </h3>
      <div className="overflow-auto rounded-lg border border-border/50 font-mono text-xs">
        {items.map((item) =>
          item.type === "gap" ? (
            <div
              key={item.id}
              className="bg-muted/40 px-3 py-1 text-muted-foreground"
            >
              … {plural(item.count, "unchanged line")}
            </div>
          ) : (
            <div
              key={item.id}
              className={`whitespace-pre px-3 ${lineClass(item.line.kind)}`}
            >
              {item.line.kind === "added"
                ? "+"
                : item.line.kind === "removed"
                  ? "-"
                  : " "}{" "}
              {item.line.text}
            </div>
          ),
        )}
      </div>
    </section>
  );
}

export function DiskDiffDrawer({
  open,
  onOpenChange,
  gameDir,
  reading,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The loose `.sdd` game's folder. */
  gameDir: string;
  /** The page is reading the game again, so undo and accept wait. */
  reading: boolean;
  /** Called after undo or accept went through, with what it did. */
  onDone: (done: InPlaceDone) => void;
}) {
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmAccept, setConfirmAccept] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDiffs(await workshopInPlaceDiffs({ gameDir }));
      setError(null);
    } catch (e) {
      setError(`Could not read the disk diff: ${message(e)}`);
    } finally {
      setLoading(false);
    }
  }, [gameDir]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  async function run(kind: Exclude<Busy, null>) {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      if (kind === "undo") {
        const undone = await workshopUndoInPlace({ gameDir });
        const count = undone.restored.length + undone.deleted.length;
        setDone(
          `Put ${plural(count, "file")} back as ${count === 1 ? "it was" : "they were"}.`,
        );
        onDone({ kind: "undo", changed: count > 0 });
      } else {
        const accepted = await workshopAcceptInPlace({ gameDir });
        setDone(
          `Kept the changes to ${plural(accepted.kept.length, "file")} and deleted the backups.`,
        );
        onDone({ kind: "accept", changed: accepted.kept.length > 0 });
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  const pending = diffs?.length ?? 0;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Disk diff"
      description="Every file coilbox has changed or created in this game's own folder, backup against what is there now."
      width="42rem"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || reading || pending === 0}
            onClick={() => void run("undo")}
          >
            {busy === "undo" ? "Undoing…" : "Undo"}
          </Button>
          <Popover open={confirmAccept} onOpenChange={setConfirmAccept}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null || reading || pending === 0}
              >
                {busy === "accept" ? "Accepting…" : "Accept"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-80 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">Keep the changes?</h3>
                <p className="text-xs text-muted-foreground">
                  This deletes the originals coilbox kept of{" "}
                  {plural(pending, "file")}. After that, undo is not possible
                  here, only through your own copy or version control.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmAccept(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setConfirmAccept(false);
                    void run("accept");
                  }}
                >
                  Accept
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
        {done && <p className="text-xs">{done}</p>}
        {loading && diffs === null && (
          <p className="text-muted-foreground text-sm">
            Reading the game's files…
          </p>
        )}
        {diffs !== null && diffs.length === 0 && !loading && (
          <p className="text-muted-foreground text-sm">
            Nothing to review: no file here holds a change from coilbox.
          </p>
        )}
        {diffs?.map((file) => (
          <FileDiffView key={file.file} file={file} />
        ))}
      </div>
    </Drawer>
  );
}
