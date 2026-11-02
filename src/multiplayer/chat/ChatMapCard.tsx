import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, ExternalLink, FolderOpen, X } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useUnitsyncScan, useUnitsyncThumbnails } from "@/content/config";
import type { LibraryMap } from "@/content/library";
import {
  isMapOnDisk,
  MAP_CATALOGUES,
  mapCaption,
  mapInstallRequest,
  mapSquares,
} from "@/content/libraryMaps";
import { scanSettled } from "@/content/scanSettled";
import { useLibrary } from "@/content/useLibrary";
import { buildMapLink } from "@/deeplink/build";
import { dispatchDeepLink } from "@/deeplink/bus";
import { useContentRoots, useWriteRootPath } from "@/downloads/config";
import {
  type EnqueueInput,
  identityOf,
  useDownloadQueue,
} from "@/downloads/DownloadQueueProvider";
import {
  QueueProgress,
  StartingBar,
} from "@/downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "@/downloads/useQueuedDownload";
import { MapOutline } from "@/hub/assets/MapPicture";
import { mapPictureAlt } from "@/hub/assets/picture";
import {
  useMapPictureLadder,
  useMapPictureRung,
} from "@/hub/assets/useMapPicture";
import { useMapFacts } from "@/hub/maps/useMapFacts";
import { usePreferredTarget } from "@/play/config";
import { type MapLinkCard, mapNameForSlug } from "./linkCards";

/**
 * The card under a chat message that links to a map (issue #286): its picture and
 * details, whether it is installed, and a button to download it. A `<div>` rather
 * than the site card's `<button>`, because a button cannot hold other buttons.
 *
 * A web page's link says only a slug. Until that matches a name this machine
 * knows, or if it never does, the card names the slug and opens the page.
 */
export function ChatMapCard({ card }: { card: MapLinkCard }) {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const library = useLibrary({
    scan: scan.data,
    catalogues: MAP_CATALOGUES,
  });
  const { paths, loading: rootsLoading } = useContentRoots();

  const mapName = useMemo(() => {
    if (card.map.kind === "name") return card.map.name;
    // A version already here beats a newer one somebody would have to download.
    const here = library.maps.filter(isMapOnDisk).map((m) => m.id);
    return (
      mapNameForSlug(card.map, here) ??
      mapNameForSlug(
        card.map,
        library.maps.map((m) => m.id),
      )
    );
  }, [card.map, library.maps]);

  if (mapName === null) return <UnresolvedMapCard card={card} />;

  const record = library.maps.find(
    (m) => m.id === mapName || m.installed?.name === mapName,
  );
  const known =
    (library.filesRead || (!rootsLoading && paths.length === 0)) &&
    scanSettled({
      targetLoading,
      hasTarget: !!(target?.enginePath && target?.dataDir),
      scan,
    });

  return (
    <ResolvedMapCard
      key={mapName}
      card={card}
      mapName={mapName}
      record={record}
      known={known}
      cataloguesRead={library.cataloguesRead}
      enginePath={target?.enginePath}
      dataDir={target?.dataDir}
    />
  );
}

const CARD =
  "w-64 max-w-full overflow-hidden rounded-lg border bg-muted text-sm";

function isWebLink(url: string): boolean {
  return /^https?:/i.test(url);
}

function OpenLinkButton({ url }: { url: string }) {
  const { t } = useLingui();
  const label = t`Open link`;
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={() => {
        openUrl(url).catch(() => {});
      }}
    >
      <ExternalLink className="size-3.5" />
    </Button>
  );
}

/** A map page whose slug matches no name this machine knows. */
function UnresolvedMapCard({ card }: { card: MapLinkCard }) {
  const title = card.map.kind === "slug" ? card.map.slug : card.map.name;
  return (
    <div data-link-card="" data-map-card="" className={CARD}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={title}>
            {title}
          </p>
          <p className="truncate text-muted-foreground text-xs">{card.site}</p>
        </div>
        <OpenLinkButton url={card.url} />
      </div>
    </div>
  );
}

function ResolvedMapCard({
  card,
  mapName,
  record,
  known,
  cataloguesRead,
  enginePath,
  dataDir,
}: {
  card: MapLinkCard;
  mapName: string;
  /** Missing when neither this machine nor any mirror has heard of the map. */
  record: LibraryMap | undefined;
  /** Both the disk listing and the scan have answered. */
  known: boolean;
  cataloguesRead: boolean;
  enginePath: string | undefined;
  dataDir: string | undefined;
}) {
  const { t } = useLingui();
  const { thumbs } = useUnitsyncThumbnails(enginePath, dataDir);
  const installedName = record?.installed?.name;
  const thumb = installedName ? thumbs.get(installedName) : undefined;
  // An installed map is read locally, and that answer is better than the hub's.
  const facts = useMapFacts(installedName ? undefined : mapName) ?? undefined;
  const ladder = useMapPictureLadder(mapName, thumb?.url ?? null);
  const { picture, onError } = useMapPictureRung(ladder);

  const bare: LibraryMap = record ?? {
    id: mapName,
    state: "available",
    onDisk: false,
    sources: [],
  };
  const onDisk = isMapOnDisk(bare);
  const caption = mapCaption(bare, mapSquares(bare, thumb, facts), facts);
  const description =
    facts?.description ?? record?.installed?.info.description ?? null;
  const authors = facts?.authors.map((a) => a.name).join(", ");

  const writePath = useWriteRootPath("maps");
  const request: EnqueueInput | null = !writePath
    ? null
    : record
      ? mapInstallRequest(record, writePath)
      : {
          kind: "mapAnySource",
          label: mapName,
          args: { mapName, writePath },
        };
  const download = useQueuedDownload(request);
  const { items, cancel } = useDownloadQueue();
  const running = request
    ? items.find(
        (i) =>
          i.identity === identityOf(request) &&
          (i.status === "queued" || i.status === "active"),
      )
    : undefined;

  const missing = known && !onDisk && !running;
  const shareLink = buildMapLink(mapName);

  return (
    <div data-link-card="" data-map-card="" className={CARD}>
      {picture.from === "placeholder" ? (
        <div className="flex aspect-video w-full items-center justify-center p-3">
          <MapOutline picture={picture} className="h-full" />
        </div>
      ) : (
        // `no-referrer` so the host is not told which page or lobby the message
        // was read in.
        <img
          src={picture.url}
          alt={mapPictureAlt(picture, mapName)}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="aspect-video w-full object-contain"
          onError={onError}
        />
      )}
      <div className="flex flex-col gap-1.5 px-2 py-1.5">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 break-words font-medium">{mapName}</p>
          {running ? (
            <Badge className="shrink-0 rounded-sm bg-sky-600 text-white">
              {running.status === "active" ? t`Downloading` : t`Queued`}
            </Badge>
          ) : known && onDisk ? (
            <Badge className="shrink-0 rounded-sm bg-emerald-600 text-white">
              <Trans>Installed</Trans>
            </Badge>
          ) : missing ? (
            <Badge className="shrink-0 rounded-sm bg-slate-600 text-white">
              <Trans>Not installed</Trans>
            </Badge>
          ) : null}
        </div>
        {caption && (
          <p className="truncate text-muted-foreground text-xs" title={caption}>
            {caption}
          </p>
        )}
        {authors && (
          <p className="truncate text-muted-foreground text-xs" title={authors}>
            <Trans>By {authors}</Trans>
          </p>
        )}
        {description && (
          <p className="line-clamp-2 text-muted-foreground text-xs">
            {description}
          </p>
        )}
        {running?.status === "active" &&
          (download.progress ? (
            <QueueProgress item={download} />
          ) : (
            <StartingBar />
          ))}
        {download.error && !running && !onDisk && (
          <p className="break-words text-destructive text-xs">
            {download.error}
          </p>
        )}
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-muted-foreground text-xs">
            {card.site}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {running && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => cancel(running.id)}
              >
                <X className="size-4" />
                <Trans>Cancel</Trans>
              </Button>
            )}
            {missing && (
              <Button
                size="sm"
                variant="outline"
                disabled={!request || !cataloguesRead}
                title={
                  writePath
                    ? undefined
                    : t`Set a download folder to install maps.`
                }
                onClick={() => void download.start()}
              >
                <Download className="size-4" />
                <Trans>Download</Trans>
              </Button>
            )}
            {known && onDisk && shareLink && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => dispatchDeepLink(shareLink)}
              >
                <FolderOpen className="size-4" />
                <Trans>Open</Trans>
              </Button>
            )}
            {isWebLink(card.url) && <OpenLinkButton url={card.url} />}
          </div>
        </div>
      </div>
    </div>
  );
}
