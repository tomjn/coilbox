/**
 * The edit-in-place route's actions (issue #2635): write the project's field
 * changes into the game's own files, then undo or accept.
 *
 * Undo and accept are offered whenever the game folder holds a workshop
 * backup, read from disk when this mounts, so they are there after a restart
 * as well as after a write in this session. Accept asks first, because it
 * deletes the backups and nothing can undo the write after that. Undo does
 * not, since it puts the written fields back into the project (issue #3023)
 * and writing again puts them back into the game.
 *
 * `onDone` runs after each action that went through, saying what it did, so
 * the caller can move the written fields out of the project or back in
 * (issue #3023) and refresh whatever it reads with unitsync when a file
 * changed (issue #2637). The Rust side already bumps the game folder's own
 * mtime so the next read is not served from the unitsync worker's own cache.
 *
 * `reading` holds the actions off while the page reads the game again. The
 * project follows the game's checksum from one read to the next, and a
 * second action pressed before the first one's read landed would be measured
 * against the game as it was before either.
 *
 * A field change the user sent through the mutator route because this route
 * cannot write it (issue #2633) is skipped by the write rather than refused,
 * and listed here as still needing a mutator, before anything is pressed.
 *
 * The disk diff behind a pending backup or created file, with Undo and
 * Accept offered a second way inside it, is `DiskDiffDrawer` (issue #2636).
 */
import { Button } from "@picoframe/frame";
import { useCallback, useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  describeRefusal,
  type InPlaceStatus,
  type InPlaceWriteOutcome,
  workshopAcceptInPlace,
  workshopInPlaceStatus,
  workshopUndoInPlace,
  workshopWriteInPlace,
} from "../../inPlace";
import type { InPlaceDone } from "../../inPlaceProject";
import { isMutatorOnly, mutatorOnlyChanges } from "../../mutatorOnly";
import type { ModProject } from "../../project";
import { DiskDiffDrawer } from "./DiskDiffDrawer";

type Busy = "write" | "undo" | "accept" | null;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function InPlaceWrite({
  gameDir,
  project,
  reading,
  onDone,
}: {
  /** The loose `.sdd` game's folder. */
  gameDir: string;
  project: ModProject | undefined;
  /** The page is reading the game again, so nothing can be pressed yet. */
  reading: boolean;
  /** Called after write, undo or accept went through, with what it did. */
  onDone: (done: InPlaceDone) => void;
}) {
  const [status, setStatus] = useState<InPlaceStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [outcome, setOutcome] = useState<InPlaceWriteOutcome | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await workshopInPlaceStatus({ gameDir }));
    } catch (e) {
      setError(`Could not count the backups: ${message(e)}`);
    }
  }, [gameDir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(kind: Exclude<Busy, null>) {
    setBusy(kind);
    setError(null);
    setDone(null);
    setOutcome(null);
    try {
      if (kind === "write" && project) {
        const written = await workshopWriteInPlace({ gameDir, project });
        setOutcome(written);
        if (written.refused.length === 0)
          onDone({
            kind: "write",
            carried: written.carried,
            changed: written.written.length > 0,
          });
      } else if (kind === "undo") {
        const undone = await workshopUndoInPlace({ gameDir });
        const count = undone.restored.length + undone.deleted.length;
        setDone(
          `Put ${plural(count, "file")} back as ${count === 1 ? "it was" : "they were"}.`,
        );
        onDone({ kind: "undo", changed: count > 0 });
      } else if (kind === "accept") {
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

  const pending = status ? status.backups + status.created : 0;
  // A copied unit's changes are not this route's either, and the Rust side
  // already says so after a write, so they are left out of both counts.
  const clones = project?.edits.clones ?? {};
  const routed = mutatorOnlyChanges(
    project?.mutatorOnly,
    project?.edits.overrides ?? {},
  ).filter((c) => !clones[c.unit]);
  const hasFieldChanges = Object.entries(project?.edits.overrides ?? {}).some(
    ([unit, fields]) =>
      Object.keys(fields).some(
        (field) => !isMutatorOnly(project?.mutatorOnly, unit, field),
      ),
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!project || !hasFieldChanges || busy !== null || reading}
          onClick={() => void run("write")}
        >
          {busy === "write" ? "Writing…" : "Write changes into the game"}
        </Button>
        {pending > 0 && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || reading}
              onClick={() => setReviewing(true)}
            >
              Review the disk diff
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || reading}
              onClick={() => void run("undo")}
            >
              {busy === "undo" ? "Undoing…" : "Undo"}
            </Button>
            <Popover open={confirmAccept} onOpenChange={setConfirmAccept}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || reading}
                >
                  {busy === "accept" ? "Accepting…" : "Accept"}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="flex w-80 flex-col gap-3"
              >
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
          </>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        {!project
          ? "Open a project to write its changes into the game."
          : !hasFieldChanges
            ? routed.length > 0
              ? "Every field change in this project goes through the mutator route, so there is nothing to write in place."
              : "This project has no field changes to write."
            : "Each field change is written into its unit's own file. Coilbox keeps the original of every file it changes until you undo or accept."}
      </p>
      {routed.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          <span>
            {plural(routed.length, "change")} cannot be written into the game's
            files, so you sent {routed.length === 1 ? "it" : "them"} to the
            mutator route. Writing in place skips{" "}
            {routed.length === 1 ? "it" : "them"}, and you still need a mutator
            for {routed.length === 1 ? "it" : "them"}:
          </span>
          <ul className="flex list-disc flex-col gap-0.5 pl-4 font-mono text-[11px]">
            {routed.map((c) => (
              <li key={`${c.unit}:${c.field}`}>
                {c.unit} {c.field}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pending > 0 && (
        <p className="text-xs">
          {plural(pending, "file")} in this game{" "}
          {pending === 1 ? "has" : "have"} a change from coilbox that can still
          be undone.
        </p>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
      {done && <p className="text-xs">{done}</p>}
      {outcome && <WriteResult outcome={outcome} />}
      <DiskDiffDrawer
        open={reviewing}
        onOpenChange={setReviewing}
        gameDir={gameDir}
        reading={reading}
        onDone={(drawerDone) => {
          onDone(drawerDone);
          void refresh();
        }}
      />
    </div>
  );
}

function WriteResult({ outcome }: { outcome: InPlaceWriteOutcome }) {
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {outcome.refused.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive">
          <span>
            Nothing was written. {plural(outcome.refused.length, "change")}{" "}
            cannot be written into the game's files:
          </span>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {outcome.refused.map((r) => (
              <li key={`${r.unit}:${r.field}`}>{describeRefusal(r)}</li>
            ))}
          </ul>
        </div>
      ) : outcome.written.length > 0 ? (
        <span>
          Wrote {plural(outcome.changed, "change")} into{" "}
          {outcome.written.join(", ")}.
        </span>
      ) : (
        <span>
          The game's files already hold every change, so nothing was written.
        </span>
      )}
      {outcome.notCarried.map((line) => (
        <span key={line} className="text-muted-foreground">
          {line}
        </span>
      ))}
    </div>
  );
}
