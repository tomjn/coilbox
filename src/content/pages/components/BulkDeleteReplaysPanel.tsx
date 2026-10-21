import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { formatBytes } from "@/lib/format";
import { notify } from "@/notify/notify";
import {
  contentDeleteReplays,
  type ReplayDeleteSummary,
  type ReplayFile,
} from "../../bindings";
import { SHORT_REPLAY_SECONDS } from "../../replayFilterVisibility";
import { loadReplays } from "../../replayList";
import { refreshStoredTracks } from "../../replayTracks";
import { useReplayUserState } from "../../replayUserState";
import {
  hasCleanupFilter,
  NO_CLEANUP_FILTERS,
  type ReplayCleanupFilters,
  selectReplaysForCleanup,
} from "../../storage";

const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** The age choices, in days. "Any age" is the filter being off. */
const AGE_OPTIONS = [
  { value: "off", label: msg`Any age` },
  { value: "7", label: msg`Older than a week` },
  { value: "30", label: msg`Older than a month` },
  { value: "90", label: msg`Older than 3 months` },
  { value: "180", label: msg`Older than 6 months` },
  { value: "365", label: msg`Older than a year` },
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
  const { t } = useLingui();
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
    loadReplays(rootPath)
      .then((r) => {
        if (live) setReplays(r);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
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
      .catch((e) => setError(errorText(e)));
  }

  async function del() {
    setPending(true);
    setError(null);
    try {
      const { summary } = await contentDeleteReplays({
        paths: selection.paths,
        apply: true,
      });
      const freed = bytesText(summary.bytes);
      void notify({
        title: plural(summary.deleted, {
          one: `Deleted # replay, freeing ${freed}.`,
          other: `Deleted # replays, freeing ${freed}.`,
        }),
        level: "success",
      });
      if (summary.skipped.length > 0) {
        const skippedCount = summary.skipped.length;
        const firstSkipped = summary.skipped[0];
        void notify({
          title: t`${skippedCount} could not be deleted: ${firstSkipped}`,
          level: "warning",
        });
      }
      if (summary.tracks > 0) void refreshStoredTracks();
      setConfirming(false);
      setReplays(await loadReplays(rootPath, true));
      onDeleted();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }

  const shortSeconds = SHORT_REPLAY_SECONDS;
  const bytesText = (n: number) => formatBytes(n) ?? "0 B";
  const matchBytes = bytesText(selection.bytes);
  const replayCount = replays?.length ?? 0;
  const analysisFreed = bytesText(preview?.analysisBytes ?? 0);
  const trackFreed = bytesText(preview?.trackBytes ?? 0);
  const previewFreed = bytesText(preview?.bytes ?? 0);
  const skippedTotal = preview?.skipped.length ?? 0;
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
          <SelectTrigger className="w-52" aria-label={t`Replay age`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {t(o.label)}
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
          <Trans>Already watched</Trans>
        </label>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control */}
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <Checkbox
            checked={filters.short}
            onCheckedChange={(v) =>
              setFilters({ ...filters, short: v === true })
            }
          />
          <Trans>Under {shortSeconds} seconds</Trans>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {replays === null
            ? t`Reading the replay list...`
            : !active
              ? plural(replayCount, {
                  one: "Pick a filter. This root has # replay.",
                  other: "Pick a filter. This root has # replays.",
                })
              : plural(selection.count, {
                  one: `# replay matches, ${matchBytes}.`,
                  other: `# replays match, ${matchBytes}.`,
                })}
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
                  ? t`No replays match the filters`
                  : t`Delete the matching replays`
              }
            >
              <Trash2 className="size-4" />
              <Trans>Delete matching</Trans>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-80 flex-col gap-3">
            {preview === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <Trans>Sizing the batch...</Trans>
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-medium">
                    {plural(preview.deleted, {
                      one: "Delete # replay?",
                      other: "Delete # replays?",
                    })}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    <Trans>
                      {previewFreed} is freed. The files go from disk and
                      coilbox cannot bring them back.
                    </Trans>
                  </p>
                  {preview.analyses > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {plural(preview.analyses, {
                        one: `# of them has a stored analysis, which is deleted too and frees another ${analysisFreed}.`,
                        other: `# of them have a stored analysis, which is deleted too and frees another ${analysisFreed}.`,
                      })}
                    </p>
                  )}
                  {preview.tracks > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {plural(preview.tracks, {
                        one: `# of them has a recorded track, which is deleted too and frees another ${trackFreed}.`,
                        other: `# of them have a recorded track, which is deleted too and frees another ${trackFreed}.`,
                      })}
                    </p>
                  )}
                  {preview.skipped.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <Trans>
                        {skippedTotal} cannot be deleted and will be left alone.
                      </Trans>
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
                    <Trans>Cancel</Trans>
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
                    <Trans>Delete</Trans>
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
