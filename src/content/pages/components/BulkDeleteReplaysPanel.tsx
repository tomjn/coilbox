import { Button } from "@picoframe/frame";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  contentDeleteReplays,
  contentListReplays,
  type ReplayDeleteSummary,
  type ReplayFile,
} from "../../bindings";
import { formatBytes } from "../../format";
import { SHORT_REPLAY_SECONDS } from "../../replayFilterVisibility";
import { useReplayUserState } from "../../replayUserState";
import {
  hasCleanupFilter,
  NO_CLEANUP_FILTERS,
  type ReplayCleanupFilters,
  selectReplaysForCleanup,
} from "../../storage";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** The age choices, in days. "Any age" is the filter being off. */
const AGE_OPTIONS = [
  { value: "off", label: "Any age" },
  { value: "7", label: "Older than a week" },
  { value: "30", label: "Older than a month" },
  { value: "90", label: "Older than 3 months" },
  { value: "180", label: "Older than 6 months" },
  { value: "365", label: "Older than a year" },
];

/**
 * Bulk replay cleanup for one content root (issue #386). Replays are the biggest
 * unmanaged consumer on most installs, and deleting them one at a time on the
 * Replays screen is not a realistic way to clear a few hundred.
 *
 * The filters (age, watched, under a minute) combine, the match count and size
 * are shown before anything happens, and the delete itself is behind a confirm.
 * This complements the Replays screen's hide-short toggle from #357: that one
 * changes what you look at, this one changes what is on disk.
 */
export function BulkDeleteReplaysPanel({
  rootPath,
  onDeleted,
}: {
  rootPath: string;
  /** Re-read the breakdown, whose replay figure just changed. */
  onDeleted: () => void;
}) {
  const [replays, setReplays] = useState<ReplayFile[] | null>(null);
  const [filters, setFilters] =
    useState<ReplayCleanupFilters>(NO_CLEANUP_FILTERS);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<ReplayDeleteSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { state: replayUserState } = useReplayUserState();

  useEffect(() => {
    let live = true;
    setReplays(null);
    setError(null);
    contentListReplays({ root: rootPath })
      .then((r) => {
        if (live) setReplays(r.replays);
      })
      .catch((e) => {
        if (live) setError(msg(e));
      });
    return () => {
      live = false;
    };
  }, [rootPath]);

  // Re-selected whenever the filters or the list change. `Date.now()` is read
  // here rather than held in state because the age cut-off only has to be right
  // at the moment the panel renders.
  const selection = useMemo(
    () =>
      selectReplaysForCleanup(
        replays ?? [],
        filters,
        (f) => replayUserState[f]?.watched === true,
        Date.now(),
      ),
    [replays, filters, replayUserState],
  );

  const active = hasCleanupFilter(filters);

  // Opening the confirm asks Rust what the batch actually comes to, so the
  // number being confirmed is one read off disk rather than the list's idea of
  // it (a replay deleted elsewhere since the list loaded is not in the answer).
  function onConfirmOpenChange(next: boolean) {
    setConfirming(next);
    if (!next) return;
    setPreview(null);
    setError(null);
    contentDeleteReplays({ paths: selection.paths, apply: false })
      .then((r) => setPreview(r.summary))
      .catch((e) => setError(msg(e)));
  }

  async function del() {
    setPending(true);
    setError(null);
    try {
      const { summary } = await contentDeleteReplays({
        paths: selection.paths,
        apply: true,
      });
      toast.success(
        `Deleted ${summary.deleted} ${summary.deleted === 1 ? "replay" : "replays"}, freeing ${formatBytes(summary.bytes) ?? "0 B"}.`,
      );
      if (summary.skipped.length > 0) {
        toast.warning(
          `${summary.skipped.length} could not be deleted: ${summary.skipped[0]}`,
        );
      }
      setConfirming(false);
      const { replays } = await contentListReplays({ root: rootPath });
      setReplays(replays);
      onDeleted();
    } catch (e) {
      setError(msg(e));
    } finally {
      setPending(false);
    }
  }

  const ageValue = filters.olderThanDays?.toString() ?? "off";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={ageValue}
          onValueChange={(v) =>
            setFilters({
              ...filters,
              olderThanDays: v === "off" ? null : Number(v),
            })
          }
        >
          <SelectTrigger className="w-52" aria-label="Replay age">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control */}
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <Checkbox
            checked={filters.watched}
            onCheckedChange={(v) =>
              setFilters({ ...filters, watched: v === true })
            }
          />
          Already watched
        </label>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control */}
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <Checkbox
            checked={filters.short}
            onCheckedChange={(v) =>
              setFilters({ ...filters, short: v === true })
            }
          />
          Under {SHORT_REPLAY_SECONDS} seconds
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {replays === null
            ? "Reading the replay list..."
            : !active
              ? `Pick a filter. This root has ${replays.length} ${replays.length === 1 ? "replay" : "replays"}.`
              : `${selection.count} ${selection.count === 1 ? "replay matches" : "replays match"}, ${formatBytes(selection.bytes) ?? "0 B"}.`}
        </p>
        <Popover open={confirming} onOpenChange={onConfirmOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={selection.count === 0}
              title={
                selection.count === 0
                  ? "No replays match the filters"
                  : "Delete the matching replays"
              }
            >
              <Trash2 className="size-4" />
              Delete matching
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-80 flex-col gap-3">
            {preview === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Sizing the batch...
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-medium">
                    Delete {preview.deleted}{" "}
                    {preview.deleted === 1 ? "replay" : "replays"}?
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(preview.bytes) ?? "0 B"} is freed. The files go
                    from disk and coilbox cannot bring them back.
                  </p>
                  {preview.skipped.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {preview.skipped.length} cannot be deleted and will be
                      left alone.
                    </p>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirming(false)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={del}
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
      </div>

      {error && <p className="break-words text-sm text-destructive">{error}</p>}
    </div>
  );
}
