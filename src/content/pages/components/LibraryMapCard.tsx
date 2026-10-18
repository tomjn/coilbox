import { Button, cn } from "@picoframe/frame";
import { Download, Play, X } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import {
  type ProgressSource,
  QueueProgress,
  StartingBar,
} from "@/downloads/pages/components/ProgressBar";
import { useCachedImage } from "../../branding";
import type { LibraryMap } from "../../library";
import { GameCardShell } from "./GameCardShell";
import { MapThumb } from "./MapThumb";

const BADGES = {
  installed: { label: "Installed", tone: "bg-emerald-600 text-white" },
  downloading: { label: "Downloading", tone: "bg-sky-600 text-white" },
  queued: { label: "Queued", tone: "bg-sky-600 text-white" },
  local: { label: "Local", tone: "bg-slate-600 text-white" },
} as const;

function StateBadge({ state }: { state: LibraryMap["state"] }) {
  if (!(state in BADGES)) return null;
  const { label, tone } = BADGES[state as keyof typeof BADGES];
  return <Badge className={cn("rounded-sm shadow-sm", tone)}>{label}</Badge>;
}

/** Sits above the card's stretched detail link so it takes its own clicks. */
const RAISED = "pointer-events-auto relative z-10";

/**
 * A card on the Maps grid for one library record: the minimap, the name, the
 * caption, a state badge, and the action the state calls for. The minimap is
 * the local render for an installed map and the springfiles picture for the
 * rest. An installed card links to the map's detail page through a stretched
 * overlay, with the buttons raised above it.
 */
export function LibraryMapCard({
  map,
  thumbUrl,
  squares,
  caption,
  loading,
  playDisabled,
  canDownload,
  failure,
  progress,
  onPlay,
  onInstall,
  onCancel,
}: {
  map: LibraryMap;
  /** The local minimap, for an installed map. */
  thumbUrl?: string;
  squares: { width: number; height: number } | null;
  caption: string;
  /** The local minimap batch is still in flight for this map. */
  loading?: boolean;
  /** The list is a saved scan not yet checked, so the map may be gone. */
  playDisabled?: boolean;
  /** A download folder is set. */
  canDownload: boolean;
  /** Why the last download attempt failed. */
  failure?: string | null;
  progress?: ProgressSource | null;
  onPlay: () => void;
  onInstall: () => void;
  onCancel: () => void;
}) {
  const remote = map.sources.find((s) => s.thumb)?.thumb;
  const remoteThumb = useCachedImage(
    !thumbUrl && remote ? [remote] : undefined,
    true,
  );
  const { state } = map;
  const running = state === "downloading" || state === "queued";
  const playable = !!map.installed && !running;

  const actions: ReactNode[] = [];
  if (running) {
    actions.push(
      <Button
        key="cancel"
        size="sm"
        variant="ghost"
        className={RAISED}
        onClick={onCancel}
      >
        <X className="size-4" />
        Cancel
      </Button>,
    );
  }
  if (state === "available") {
    actions.push(
      <Button
        key="install"
        size="sm"
        variant="outline"
        className={RAISED}
        disabled={!canDownload}
        onClick={onInstall}
      >
        <Download className="size-4" />
        Install
      </Button>,
    );
  }
  if (playable) {
    actions.push(
      <Button
        key="play"
        size="sm"
        className={RAISED}
        onClick={onPlay}
        disabled={playDisabled}
      >
        <Play className="size-4 fill-current" />
        Play
      </Button>,
    );
  }

  return (
    <GameCardShell
      name={map.id}
      title={map.id}
      alt={`Minimap of ${map.id}`}
      className="h-full"
      artClassName=""
      art={
        <MapThumb
          url={thumbUrl ?? remoteThumb}
          width={squares?.width}
          height={squares?.height}
          alt={`Minimap of ${map.id}`}
          loading={loading}
        />
      }
      badge={<StateBadge state={state} />}
      subtitle={
        caption ? (
          <span
            className="truncate text-xs text-muted-foreground"
            title={caption}
          >
            {caption}
          </span>
        ) : null
      }
      footer={
        <div className="flex flex-col gap-2">
          {state === "downloading" &&
            (progress?.progress ? (
              <QueueProgress item={progress} />
            ) : (
              <StartingBar />
            ))}
          {failure && !running && (
            <p className="break-words text-xs text-destructive">{failure}</p>
          )}
          {actions.length > 0 && (
            <div className="flex items-center justify-end gap-1.5">
              {actions}
            </div>
          )}
        </div>
      }
    >
      {map.installed && (
        <Link
          to={`/library/maps/${encodeURIComponent(map.installed.name)}`}
          aria-label={map.id}
          className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        />
      )}
    </GameCardShell>
  );
}
