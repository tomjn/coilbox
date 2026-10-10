import { Button } from "@picoframe/frame";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { notify } from "@/notify/notify";
import {
  contentDeleteReplays,
  type ReplayDeleteSummary,
  type ReplayFile,
} from "../../bindings";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** What deleting an empty file risks, in the words every surface uses. */
export const UNFINISHED_WARNING =
  "The engine writes a replay only when its game ends, so a game running right now has an empty file like this too. Deleting that file loses the replay.";

/**
 * "Clear unfinished recordings" for the Replays screen (issue #3868).
 *
 * A replay of zero bytes is what a game leaves when it is killed or crashes. The
 * file never fills in. Opening this asks the backend what the delete would do,
 * lists it, and removes nothing until it is confirmed. The backend refuses every
 * empty file while a game coilbox launched is running, and skips a file that has
 * filled in since the preview.
 */
export function ClearUnfinishedButton({
  replays,
  onCleared,
}: {
  replays: ReplayFile[];
  /** Re-read the list, which just lost files. */
  onCleared: () => void;
}) {
  const unfinished = replays.filter((r) => r.unfinished);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ReplayDeleteSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (unfinished.length === 0) return null;
  const paths = unfinished.map((r) => r.path);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setPreview(null);
    setError(null);
    contentDeleteReplays({ paths, apply: false, onlyUnfinished: true })
      .then((r) => setPreview(r.summary))
      .catch((e) => setError(msg(e)));
  };

  const apply = async () => {
    setPending(true);
    setError(null);
    try {
      const { summary } = await contentDeleteReplays({
        paths,
        apply: true,
        onlyUnfinished: true,
      });
      void notify({
        title: `Deleted ${summary.deleted} unfinished ${summary.deleted === 1 ? "recording" : "recordings"}.`,
        level: "success",
      });
      setOpen(false);
      onCleared();
    } catch (e) {
      setError(msg(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          title="Delete the empty replays that games left when they did not finish recording"
        >
          <Trash2 className="size-4" />
          Clear unfinished ({unfinished.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-96 flex-col gap-3">
        {error ? (
          <p className="break-words text-sm text-destructive">{error}</p>
        ) : preview === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Checking what can be deleted...
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">
                Delete {preview.deleted} unfinished{" "}
                {preview.deleted === 1 ? "recording" : "recordings"}?
              </h3>
              <p className="text-xs text-muted-foreground">
                {UNFINISHED_WARNING}
              </p>
            </div>
            {preview.skipped.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">Left alone:</p>
                <ul className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
                  {preview.skipped.map((line) => (
                    <li key={line} className="break-words font-mono">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={apply}
                disabled={pending || preview.deleted === 0}
                className="gap-1.5"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Delete
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
