import { Button } from "@picoframe/frame";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatBytes } from "@/lib/format";
import { type CacheReclaimSummary, contentReclaimCaches } from "../../bindings";
import { isEmpty, nonEmptyCaches, summarizeCaches } from "../../caches";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * "Reclaim caches" control. Opening it runs a dry-run size of every generated-image
 * / info cache dir, previews the per-cache breakdown, and clears them only on an
 * explicit confirm. Every cache regenerates on demand, so clearing is always safe.
 */
export function ReclaimCachesButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<CacheReclaimSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDryRun = async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const { summary } = await contentReclaimCaches({ apply: false });
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
      const { summary } = await contentReclaimCaches({ apply: true });
      toast.success(summarizeCaches(summary));
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
          title="Size and clear the generated-image and info caches"
        >
          <Trash2 className="size-4" />
          Reclaim caches
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Sizing the caches...
          </p>
        ) : error ? (
          <p className="break-words text-sm text-destructive">{error}</p>
        ) : preview ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">{summarizeCaches(preview)}</p>
            {!isEmpty(preview) && (
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {nonEmptyCaches(preview).map((c) => (
                  <li key={c.name} className="flex justify-between gap-2">
                    <span className="truncate">{c.label}</span>
                    <span className="tabular-nums">{formatBytes(c.bytes)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                {isEmpty(preview) ? "Close" : "Cancel"}
              </Button>
              {!isEmpty(preview) && (
                <Button
                  type="button"
                  size="sm"
                  disabled={applying}
                  onClick={apply}
                >
                  {applying ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
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
