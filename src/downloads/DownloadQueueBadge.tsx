import type { MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import {
  Cpu,
  Download,
  File,
  Gamepad2,
  type LucideIcon,
  Map as MapIcon,
  Package,
  X,
} from "lucide-react";
import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatBytes } from "@/lib/format";
import { type QueueItem, useDownloadQueue } from "./DownloadQueueProvider";
import { formatDuration } from "./downloadRate";
import {
  type ProgressSource,
  QueueProgress,
} from "./pages/components/ProgressBar";
import { contentOf, type QueueContent, queuedSize } from "./queueLanes";

/** The same icons the sidebar uses for the maps, games and rapid pages. */
const CONTENT_ICONS: Record<
  QueueContent,
  { icon: LucideIcon; name: MessageDescriptor }
> = {
  map: { icon: MapIcon, name: msg`Map` },
  game: { icon: Gamepad2, name: msg`Game` },
  rapid: { icon: Package, name: msg`Rapid` },
  engine: { icon: Cpu, name: msg`Engine` },
  file: { icon: File, name: msg`File` },
};

/**
 * An icon saying what a download is. It carries the kind as its accessible
 * name, so a screen reader hears "Map" before the map's name.
 */
function ContentIcon({ content }: { content: QueueContent | null }) {
  const { i18n } = useLingui();
  const { icon: Icon, name } = content
    ? CONTENT_ICONS[content]
    : { icon: Download, name: msg`Download` };
  return (
    <Icon
      size={14}
      role="img"
      aria-label={i18n._(name)}
      className="shrink-0 text-muted-foreground"
    />
  );
}

/**
 * The queued list's heading. Adds the total size when the catalogs the items
 * came from listed any, and says how many it could not count rather than
 * passing a partial total off as the whole.
 */
export function queuedHeading(items: { sizeBytes?: number }[]): string {
  const count = items.length;
  const size = queuedSize(items);
  if (!size) return t`Queued (${count})`;
  const total = formatBytes(size.bytes);
  if (size.unknown === 0) return t`Queued (${count}) · ${total}`;
  const unknown = size.unknown;
  return t`Queued (${count}) · ${total} + ${unknown} of unknown size`;
}

/**
 * The one number the pill has room for, or null when there is nothing worth
 * putting there.
 *
 * Time left is the thing somebody glancing at the topbar actually wants, since
 * it is the one that answers "can I go and do something else". It needs a
 * settled rate though, so until there is one the percentage stands in, and a
 * download that reports neither gets no number rather than a made-up one.
 */
export function badgeSummary(item: ProgressSource | null): string | null {
  if (!item?.progress) return null;
  if (item.rate.secondsLeft != null) {
    const left = formatDuration(item.rate.secondsLeft);
    return t`${left} left`;
  }
  if (item.progress.percent != null)
    return `${Math.round(item.progress.percent)}%`;
  return null;
}

/**
 * One running download's name and progress bar, with a cancel button when
 * there is something to cancel. A download reported from outside the queue has
 * no cancel, because the queue has no way to stop something it is not running.
 */
function RunningDownload({
  item,
  content,
  onCancel,
}: {
  item: ProgressSource & { label: string };
  content: QueueContent | null;
  onCancel?: () => void;
}) {
  const { t } = useLingui();
  const label = item.label;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <ContentIcon content={content} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.label}
        </span>
        {onCancel && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2"
            onClick={onCancel}
            aria-label={t`Cancel downloading ${label}`}
          >
            <X size={14} />
          </Button>
        )}
      </div>
      {item.progress ? (
        <QueueProgress item={item} />
      ) : (
        <p className="text-xs text-muted-foreground">
          <Trans>Starting…</Trans>
        </p>
      )}
    </div>
  );
}

/**
 * topbar.right slot: a download-queue widget, shown only while something is
 * downloading or waiting. The pill reports the in-flight count and how much
 * longer the first running download has to go. Its popover shows the running downloads'
 * full progress on top and the queued items beneath, each cancellable. Returns
 * null when nothing is downloading.
 *
 * "Running" is the queue's own downloads, one per lane, plus anything reported to it from
 * outside, which today means coilbox downloading its own update. That one is
 * counted and drawn here rather than given a pill of its own, because the point
 * of this widget is to be the single place on screen that means something is
 * downloading (issue #1790).
 */
export default function DownloadQueueBadge() {
  const { t } = useLingui();
  const removeLabel = (itemLabel: string) => t`Remove ${itemLabel} from queue`;
  const { running, active, queued, reported, cancel, acknowledgeFailures } =
    useDownloadQueue();
  if (running.length === 0 && queued.length === 0 && reported.length === 0)
    return null;

  const count = running.length + reported.length + queued.length;
  const summary = badgeSummary(active ?? reported[0] ?? null);
  return (
    <Popover onOpenChange={(open) => open && acknowledgeFailures()}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={
            summary
              ? t`Downloads: ${count} in progress, ${summary}`
              : t`Downloads: ${count} in progress`
          }
        >
          <Download
            size={14}
            className="animate-pulse motion-reduce:animate-none"
          />
          <span className="tabular-nums">
            {summary
              ? t`${count} downloading · ${summary}`
              : t`${count} downloading`}
          </span>
        </button>
      </PopoverTrigger>
      {/* The running downloads stay pinned at the top and only the queued list
          scrolls, so a queue of a hundred maps fits the window (issue #3141). */}
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="flex max-h-(--radix-popover-content-available-height) w-80 flex-col p-0"
      >
        {running.length + reported.length > 0 && (
          <div className="shrink-0 space-y-3 border-b border-border p-4">
            {running.map((item) => (
              <RunningDownload
                key={item.id}
                item={item}
                content={contentOf(item)}
                onCancel={() => cancel(item.id)}
              />
            ))}
            {reported.map((item) => (
              <RunningDownload key={item.id} item={item} content={null} />
            ))}
          </div>
        )}
        {queued.length > 0 && (
          <div className="flex min-h-0 flex-col">
            <p className="shrink-0 px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {queuedHeading(queued)}
            </p>
            <ul className="min-h-0 space-y-1 overflow-y-auto px-4 pb-3">
              {queued.map((item: QueueItem) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <ContentIcon content={contentOf(item)} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.sizeBytes != null && item.sizeBytes > 0 && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatBytes(item.sizeBytes)}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-2"
                    onClick={() => cancel(item.id)}
                    aria-label={removeLabel(item.label)}
                  >
                    <X size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Link
          to="/library/downloads"
          className="shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trans>All downloads</Trans>
        </Link>
      </PopoverContent>
    </Popover>
  );
}
