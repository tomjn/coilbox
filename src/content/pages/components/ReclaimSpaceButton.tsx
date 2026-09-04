import { Button } from "@picoframe/frame";
import { HardDrive, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { notify } from "@/notify/notify";
import { contentPruneRapidPool, type PruneSummary } from "../../bindings";
import { isClean, summarize } from "../../rapidPool";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * Per-root "Reclaim space" control. Opening it runs a dry-run prune of the root's
 * rapid pool (orphaned blobs + `.incomplete` leftovers), previews what would be
 * removed, and deletes only on an explicit confirm. Disabled while a download is
 * in flight (pruning refcounts against on-disk `.sdp` files and must not race a
 * blob being written).
 */
export function ReclaimSpaceButton({
  rootPath,
  canPrune,
  blockReason,
}: {
  rootPath: string;
  canPrune: boolean;
  blockReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<PruneSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDryRun = async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const { summary } = await contentPruneRapidPool({
        root: rootPath,
        apply: false,
      });
      setPreview(summary);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) runDryRun();
  };

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const { summary } = await contentPruneRapidPool({
        root: rootPath,
        apply: true,
      });
      void notify({ title: summarize(summary), level: "success" });
      setOpen(false);
    } catch (e) {
      setError(msg(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPrune}
          title={canPrune ? "Reclaim orphaned rapid pool data" : blockReason}
        >
          <HardDrive className="size-4" />
          Reclaim space
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Scanning the pool for orphaned data...
          </p>
        ) : error ? (
          <p className="break-words text-sm text-destructive">{error}</p>
        ) : preview ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">{summarize(preview)}</p>
            {preview.unreadableSdp > 0 && (
              <p className="text-xs text-muted-foreground">
                {preview.unreadableSdp} unreadable package file
                {preview.unreadableSdp === 1 ? "" : "s"} will be skipped.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                {isClean(preview) ? "Close" : "Cancel"}
              </Button>
              {!isClean(preview) && (
                <Button
                  type="button"
                  size="sm"
                  disabled={applying}
                  onClick={apply}
                >
                  {applying ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <HardDrive className="size-4" />
                  )}
                  Reclaim
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
