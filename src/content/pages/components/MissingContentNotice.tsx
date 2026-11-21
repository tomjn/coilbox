import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Download, Loader2 } from "lucide-react";
import { Link } from "react-router";
import { useWriteRoot, useWriteRootPath } from "../../../downloads/config";
import { QueueProgress } from "../../../downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "../../../downloads/useQueuedDownload";
import type { ReplayEngineNotice } from "../../replayEngine";
import type { ReplayEngine } from "../../useReplayEngine";

/** Best-effort game download (rapid). The demo's `gameType` is a display string,
 * not a rapid tag, so an exact-version match isn't guaranteed — surfaced honestly. */
function GameDownload({ gameType }: { gameType: string }) {
  const { t } = useLingui();
  const writePath = useWriteRootPath("games");
  const gameDl = useQueuedDownload({
    kind: "rapid",
    label: t`Game: ${gameType}`,
    args: { tag: gameType, writePath },
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          onClick={() => gameDl.start()}
          disabled={gameDl.busy || !writePath}
          className="gap-1.5"
        >
          {gameDl.busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          <Trans>Download game</Trans>
        </Button>
        <span className="text-xs text-muted-foreground">
          <Trans>Best effort — an exact version match isn't guaranteed.</Trans>
        </span>
      </div>
      <QueueProgress item={gameDl} className="max-w-xs" />
      {gameDl.status === "done" && (
        <p className="text-xs text-muted-foreground">
          <Trans>Downloaded {gameType}.</Trans>
        </p>
      )}
      {gameDl.error && (
        <p className="text-xs text-destructive">{gameDl.error}</p>
      )}
    </div>
  );
}

/**
 * Map download for the missing-content notice. `onDownloaded` invalidates the
 * cached preview and bumps the parent's remount key so the map preview
 * further down the page picks up the newly installed map.
 */
function MapDownload({
  mapName,
  onDownloaded,
}: {
  mapName: string;
  onDownloaded: () => void;
}) {
  const { t } = useLingui();
  const { path: writePath, loading: writeRootLoading } = useWriteRoot("maps");
  // Only once the read has landed and said there is none. Before that `writePath`
  // is undefined whatever the user has configured (issue #1104).
  const noWriteRoot = !writeRootLoading && !writePath;
  // Replays here are BAR-dominant, and this used to fetch the map straight from
  // BAR's search endpoint for that reason. It resolves a name by fetching and
  // storing the archive at BAR's cost, so a replay of any other game's map made
  // BAR pay to host it. The source order does not.
  const mapDl = useQueuedDownload({
    kind: "mapAnySource",
    label: t`Map: ${mapName}`,
    args: { mapName, writePath },
  });
  const downloading = mapDl.busy;

  async function download() {
    const settled = await mapDl.start();
    if (settled?.status === "done") onDownloaded();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          onClick={download}
          disabled={downloading || !writePath}
          className="gap-1.5"
        >
          {downloading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          <Trans>Download map</Trans>
        </Button>
      </div>
      <QueueProgress item={mapDl} className="max-w-xs" />
      {noWriteRoot && !downloading && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Set a download folder in{" "}
            <Link
              className="underline underline-offset-4"
              to="/settings/content-folders"
            >
              Content folders settings
            </Link>{" "}
            first.
          </Trans>
        </p>
      )}
      {mapDl.error && <p className="text-xs text-destructive">{mapDl.error}</p>}
    </div>
  );
}

/**
 * The engine the replay was recorded on, for the missing-content notice (issue
 * #3370). A replay only plays back on that version. When no build of it can be
 * downloaded the version is named, so the player knows which engine to find.
 */
function EngineDownload({
  notice,
  engine,
}: {
  notice: Extract<ReplayEngineNotice, { kind: "download" | "unavailable" }>;
  engine: ReplayEngine;
}) {
  const { t } = useLingui();
  const { requirement, resolve } = engine;
  const engineVersion = notice.version;
  const status = resolve.statusFor(requirement);
  const item = resolve.itemFor(requirement);
  const error = resolve.errorFor(requirement);
  const busy = status === "active" || status === "queued";

  if (notice.kind === "unavailable") {
    return (
      <p className="text-xs text-muted-foreground">
        {notice.reason === "no-write-root" ? (
          <Trans>
            Engine {engineVersion} is not installed. Set a download folder in{" "}
            <Link
              className="underline underline-offset-4"
              to="/settings/content-folders"
            >
              Content folders settings
            </Link>{" "}
            to download it.
          </Trans>
        ) : (
          <Trans>
            Engine {engineVersion} is not installed, and no download was found
            for it on this platform. Install it yourself in Settings, Engines.
          </Trans>
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          onClick={() => resolve.download(requirement)}
          disabled={busy}
          className="gap-1.5"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {status === "queued" ? t`Queued…` : t`Download engine`}
        </Button>
        <span className="text-xs text-muted-foreground">
          <Trans>
            Recorded on {engineVersion}. A replay only plays on that version.
          </Trans>
        </span>
      </div>
      <QueueProgress item={item} className="max-w-xs" />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Missing-content affordance for the replay's game, map and engine, surfaced near
 * the top of the page next to the game/map identity (#495) instead of at the
 * bottom, so it's the first thing a user sees when something needs
 * downloading. Renders nothing once all are installed, the common case,
 * especially after the #494 version-tolerant match fix.
 */
export function MissingContentNotice({
  gameType,
  mapName,
  missingGame,
  missingMap,
  engine,
  onMapDownloaded,
}: {
  gameType: string;
  mapName: string;
  missingGame: boolean;
  missingMap: boolean;
  engine: ReplayEngine;
  onMapDownloaded: () => void;
}) {
  const { t } = useLingui();
  const engineNotice =
    engine.notice.kind === "download" || engine.notice.kind === "unavailable"
      ? engine.notice
      : null;
  if (!missingGame && !missingMap && !engineNotice) return null;
  const label =
    missingGame && missingMap && engineNotice
      ? t`Game, map and engine not installed`
      : missingGame && missingMap
        ? t`Game and map not installed`
        : missingGame && engineNotice
          ? t`Game and engine not installed`
          : missingMap && engineNotice
            ? t`Map and engine not installed`
            : missingGame
              ? t`Game not installed`
              : missingMap
                ? t`Map not installed`
                : t`Engine not installed`;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
        <Download className="size-4" /> {label}
      </div>
      {missingGame && <GameDownload gameType={gameType} />}
      {missingMap && mapName && (
        <MapDownload mapName={mapName} onDownloaded={onMapDownloaded} />
      )}
      {engineNotice && <EngineDownload notice={engineNotice} engine={engine} />}
    </section>
  );
}
