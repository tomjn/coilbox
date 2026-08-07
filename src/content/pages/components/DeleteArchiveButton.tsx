import { Button } from "@picoframe/frame";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { contentDeleteArchive, contentRescan } from "../../bindings";
import {
  invalidateScans,
  primeScan,
  useScanTargetSelection,
} from "../../config";
import { formatBytes } from "../../format";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * Confirm-then-delete for one downloaded game or map archive (issue #978).
 *
 * Only render it for a path {@link isDeletableArchive} accepts. The same rule is
 * enforced in Rust, so an engine's base archives are refused there too, but the
 * button should not be offered for something that can only fail.
 */
export function DeleteArchiveButton({
  path,
  name,
  onDeleted,
}: {
  /** The archive's on-disk path. */
  path: string;
  /** What to call it in the confirmation, usually the archive file name. */
  name: string;
  /** Leave the detail page, which now describes content that is gone. */
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { selected } = useScanTargetSelection();

  async function del() {
    setPending(true);
    setError(null);
    try {
      const { bytes } = await contentDeleteArchive({ path });
      const freed = formatBytes(bytes);
      toast.success(
        freed ? `Deleted ${name}, freeing ${freed}.` : `Deleted ${name}.`,
      );
      // The scan caches still list it, and the root's counts are now stale. The
      // forced unitsync rescan is what takes it out of the grids. It is not
      // awaited because a rescan can run for minutes, and the page the user
      // lands on joins the same in-flight scan.
      invalidateScans();
      if (selected)
        primeScan(selected.enginePath, selected.rootPath, true).catch(() => {});
      await contentRescan({ withCounts: true }).catch(() => {});
      setOpen(false);
      onDeleted();
    } catch (e) {
      setError(msg(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5">
          <Trash2 className="size-4" /> Delete
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Delete this archive?</h3>
          <p className="break-words text-xs text-muted-foreground">
            {name} is deleted from disk and you would have to download it again.
            Replays and saves that need it stop working.
          </p>
        </div>
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
            onClick={del}
            disabled={pending}
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
        {error && (
          <p className="break-words text-xs text-destructive">{error}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
