import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { SettingRow } from "@/components/SettingRow";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { describeError } from "@/i18n/uiError";
import { formatBytes } from "@/lib/format";
import { notify } from "@/notify/notify";
import { contentReplayTracksClear } from "../../bindings";
import {
  refreshStoredTracks,
  useStoredTracks,
  useTrackBudget,
  useTrackUsage,
} from "../../replayTracks";

const MIB = 1024 * 1024;

const msg = (e: unknown): string => describeError(e);

/**
 * What recorded tracks take on disk, the limit on it, and a button that
 * removes them all (#3787). Two `<SettingRow>`s, for a `<SettingList>`.
 *
 * The total comes from the same answer as the replay badges, so the two agree.
 * Lowering the limit removes nothing by itself: the next recording that is
 * stored applies it, and until then the line says the tracks are over it.
 * Clearing asks first, because a track costs a run of the engine to make again.
 */
export function ReplayTracksStorage() {
  const { t } = useLingui();
  const tracks = useStoredTracks();
  const { totalBytes } = useTrackUsage();
  const { budgetBytes, setBudgetBytes } = useTrackBudget();
  const [draft, setDraft] = useState<string | null>(null);

  const shown =
    draft ??
    (budgetBytes === null ? "" : String(Math.round(budgetBytes / MIB)));

  const commit = () => {
    const entered = draft;
    setDraft(null);
    if (entered === null || !/^\d+$/.test(entered)) return;
    const bytes = Number(entered) * MIB;
    if (bytes < MIB || !Number.isSafeInteger(bytes) || bytes === budgetBytes) {
      return;
    }
    setBudgetBytes(bytes);
  };

  const usedSize = formatBytes(totalBytes);
  const limitSize = budgetBytes === null ? "..." : formatBytes(budgetBytes);
  const over = budgetBytes !== null && totalBytes > budgetBytes;

  const trackCount = plural(tracks.size, { one: "# track", other: "# tracks" });
  const summary = t`${usedSize} used of ${limitSize}, ${trackCount}`;

  return (
    <>
      <SettingRow
        label={t`Replay tracks`}
        description={summary}
        error={over ? t`Over the limit until the next recording` : null}
        help={<TracksHelp />}
        helpLabel={t`About replay tracks`}
      >
        <ClearTracksButton count={tracks.size} bytes={totalBytes} />
      </SettingRow>
      <SettingRow
        id="replay-track-budget"
        label={t`Disk space for tracks (MB)`}
      >
        <Input
          id="replay-track-budget"
          className="w-28"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          disabled={budgetBytes === null}
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      </SettingRow>
    </>
  );
}

/** What the help popover beside "Replay tracks" says. */
function TracksHelp() {
  return (
    <>
      <p>
        <Trans>
          A track is a recording of a replay's match. It can always be made
          again from the replay.
        </Trans>
      </p>
      <p>
        <Trans>
          When a new track is stored and the tracks take more than the limit,
          the least recently watched are removed until they fit. Tracks that are
          out of date go first. The new track is never removed, so a track
          larger than the limit is kept and every other one goes.
        </Trans>
      </p>
      <p>
        <Trans>
          Lowering the limit removes nothing by itself. It applies when the next
          track is stored.
        </Trans>
      </p>
    </>
  );
}

/** The clear button, with its confirmation in a popover beside it. */
function ClearTracksButton({ count, bytes }: { count: number; bytes: number }) {
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const freeable = formatBytes(bytes);

  const clear = async () => {
    setClearing(true);
    setError(null);
    try {
      const { cleared } = await contentReplayTracksClear(undefined);
      // Every replay's badge reads this, so it goes with the files.
      await refreshStoredTracks();
      const freed = formatBytes(cleared.freedBytes);
      void notify({
        title: plural(cleared.removed, {
          one: `Removed # track, freeing ${freed}`,
          other: `Removed # tracks, freeing ${freed}`,
        }),
        level: "success",
      });
      setOpen(false);
    } catch (e) {
      setError(msg(e));
    } finally {
      setClearing(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={count === 0}
        >
          <Trash2 className="size-4" />
          <Trans>Clear all tracks</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {plural(count, {
              one: `Remove # track and free ${freeable}? The replays stay and can be recorded again.`,
              other: `Remove # tracks and free ${freeable}? The replays stay and can be recorded again.`,
            })}
          </p>
          {error && (
            <p className="break-words text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button type="button" size="sm" disabled={clearing} onClick={clear}>
              {clearing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              <Trans>Clear tracks</Trans>
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
