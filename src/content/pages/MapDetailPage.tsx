import { Button, useSetting } from "@picoframe/frame";
import {
  ArrowLeft,
  Calendar,
  Clapperboard,
  Flag,
  ImageOff,
  PackageOpen,
  Play,
  Swords,
  Trophy,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAdvancedMode } from "@/general/advanced";
import { isProfileHidden } from "@/profile/hidden";
import { MapPreview3D } from "../../mapconv/pages/components/MapPreview3D";
import {
  MapLayerToggle,
  MapOverlayImage,
  useMapOverlayLayer,
} from "../../play/pages/components/MapOverlay";
import { unitsyncArchiveTree } from "../bindings";
import {
  classifyArchive,
  useContentState,
  useReplayStats,
  useScanTargetSelection,
  useUnitsyncArchiveTree,
  useUnitsyncHeightmap,
  useUnitsyncMapInfo,
  useUnitsyncMapMeta,
  useUnitsyncMapSkybox,
  useUnitsyncMinimap,
  useUnitsyncScan,
  useUnitsyncThumbnails,
} from "../config";
import { isDeletableArchive } from "../format";
import { useMapEligibility } from "../mapEligibility";
import { mergeMapTiers } from "../mapTiers";
import { refightFilenames, useReplayUserState } from "../replayUserState";
import { allPlayers, guessPrimaryPlayer, mapRecordFor } from "../stats";
import { usePlayMap } from "../usePlayMap";
import { ArchiveRow } from "./components/ArchiveRow";
import { DeleteArchiveButton } from "./components/DeleteArchiveButton";
import { mapSizeLabel } from "./components/MapThumb";
import { OptionsList } from "./components/OptionsList";
import { StatCard } from "./components/StatWidgets";
import {
  DetailError,
  DetailLoading,
  NotFound,
  WarningBanner,
} from "./components/states";

function playedAt(ms: number): string {
  if (!ms) return "never";
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Keys shown in the headline; everything else goes in the metadata table. */
const HEADLINE_KEYS = new Set(["name", "description"]);

/** A single map: a minimap preview, its metadata, and the archives it's from. */
export default function MapDetailPage() {
  const { name } = useParams();
  const decoded = name ? decodeURIComponent(name) : "";
  const navigate = useNavigate();
  const playMap = usePlayMap();
  const advanced = useAdvancedMode();
  const [decompiling, setDecompiling] = useState(false);
  const { selected } = useScanTargetSelection();
  const { data, loading, error, run } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const { thumbs } = useUnitsyncThumbnails(
    selected?.enginePath,
    selected?.rootPath,
  );
  const { meta } = useUnitsyncMapMeta(selected?.enginePath, selected?.rootPath);
  const minimap = useUnitsyncMinimap(
    selected?.enginePath,
    selected?.rootPath,
    decoded,
  );
  const heightmap = useUnitsyncHeightmap(
    selected?.enginePath,
    selected?.rootPath,
    decoded,
  );
  const mapInfo = useUnitsyncMapInfo(
    selected?.enginePath,
    selected?.rootPath,
    decoded,
  );
  const skybox = useUnitsyncMapSkybox(
    selected?.enginePath,
    selected?.rootPath,
    decoded,
  );
  const overlay = useMapOverlayLayer(
    selected?.enginePath,
    selected?.rootPath,
    decoded,
  );

  // The scan reports map archives by a versioned display name and no path, so
  // the backing `.sd7`/`.sdz`/`.sdd` file comes from the archive tree. The delete
  // button needs it to know whether this map is a deletable download.
  const archiveName = data?.maps.find((m) => m.name === decoded)?.archives[0]
    ?.name;
  const { tree: archiveTree } = useUnitsyncArchiveTree(
    selected?.enginePath,
    selected?.rootPath,
    archiveName,
  );
  const archivePath = archiveTree?.archivePath;

  // Per-map record (#460): a distribution profile can hide stats entirely, in
  // which case the roots stay empty so `useReplayStats` never ingests.
  const statsHidden = isProfileHidden("multiplayer.stats");
  const { state: contentState } = useContentState();
  const statsRoots = useMemo(
    () => (statsHidden ? [] : (contentState?.roots ?? []).map((r) => r.path)),
    [contentState, statsHidden],
  );
  const { records: statRecords, ingesting: statsIngesting } = useReplayStats(
    statsRoots,
    selected?.enginePath,
  );
  const { state: replayUserState } = useReplayUserState();
  const refights = useMemo(
    () => refightFilenames(replayUserState),
    [replayUserState],
  );
  const [storedStatsPlayer] = useSetting("content.statsPlayer", "");
  const statsPlayer = useMemo(() => {
    const players = allPlayers(statRecords, refights);
    return (
      players.find((p) => p.name === storedStatsPlayer)?.name ??
      guessPrimaryPlayer(statRecords, refights) ??
      ""
    );
  }, [statRecords, refights, storedStatsPlayer]);
  const mapRecord = useMemo(
    () => mapRecordFor(statRecords, decoded, statsPlayer, refights),
    [statRecords, decoded, statsPlayer, refights],
  );

  if (error && !data)
    return (
      <DetailError
        backTo="/content/maps"
        message={error}
        onRetry={() => run(true)}
      />
    );
  if (!data || loading) return <DetailLoading backTo="/content/maps" />;
  const scanned = data.maps.find((m) => m.name === decoded);
  if (!scanned) return <NotFound backTo="/content/maps" label="map" />;
  // Proportions and mapinfo arrive after the scan now, so fold in whichever of
  // those tiers has landed.
  const [map] = mergeMapTiers([scanned], thumbs, meta);

  const otherInfo = Object.entries(map.info).filter(
    ([k]) => !HEADLINE_KEYS.has(k),
  );
  const size = mapSizeLabel(map.width, map.height);

  // Start positions are in world coords; the map's world size is its metal-map
  // dimension * 16, so normalise to 0..1 for overlaying on the (object-fill,
  // aspect-correct) minimap.
  const worldW = (map.width ?? 0) * 16;
  const worldH = (map.height ?? 0) * 16;
  const markers =
    worldW > 0 && worldH > 0
      ? minimap.startPositions.map((p) => ({
          key: `${p.x},${p.z}`,
          left: (p.x / worldW) * 100,
          top: (p.z / worldH) * 100,
        }))
      : [];

  // Aspect ratio of the map (unitsync minimaps are square, so the box carries the
  // true shape and `object-fill` stretches the square source back into it).
  const ratio = map.width && map.height ? map.width / map.height : 1;

  // Resolve the map's backing archive to its on-disk path and hand it to mapconv
  // decompile. The scan reports map archives by a versioned display name (no path),
  // so ask the archive-tree command — it turns that name into the real `.sd7`/
  // `.sdz`/`.sdd` file the decompiler opens.
  const openInDecompile = async () => {
    if (!selected || !archiveName) return;
    setDecompiling(true);
    try {
      const tree = await unitsyncArchiveTree({
        enginePath: selected.enginePath,
        dataDir: selected.rootPath,
        archive: archiveName,
      });
      if (tree.archivePath) {
        navigate("/mapconv/decompile", {
          state: { inputPath: tree.archivePath },
        });
      } else {
        toast.error("Couldn't locate this map's archive on disk.");
      }
    } catch {
      toast.error("Couldn't open this map in mapconv.");
    } finally {
      setDecompiling(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-1">
        <Link
          to="/content/maps"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Maps
        </Link>
        <h1 className="break-words text-lg font-semibold">{map.name}</h1>
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
          {size && <span>{size}</span>}
          {map.fileName && <span className="break-all">{map.fileName}</span>}
          {mapInfo.info?.checksum && (
            <span>checksum {mapInfo.info.checksum}</span>
          )}
        </div>
        {map.info.description && (
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {map.info.description}
          </p>
        )}
      </header>

      <section className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="gap-1.5" onClick={() => playMap(map.name)}>
          <Play className="size-4" /> Play this map
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => navigate("/battles", { state: { hostMap: map.name } })}
        >
          <Swords className="size-4" /> Host a battle here
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() =>
            navigate(`/play/replays?map=${encodeURIComponent(map.name)}`)
          }
        >
          <Clapperboard className="size-4" /> Replays on this map
        </Button>
        {advanced && archiveName && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={openInDecompile}
            disabled={decompiling}
          >
            <PackageOpen className="size-4" />
            {decompiling ? "Opening…" : "Open in mapconv decompile"}
          </Button>
        )}
        {archivePath && isDeletableArchive(archivePath) && (
          <DeleteArchiveButton
            path={archivePath}
            name={archiveName ?? map.name}
            onDeleted={() => navigate("/content/maps")}
          />
        )}
      </section>

      {mapInfo.info?.warnings?.length ? (
        <WarningBanner warnings={mapInfo.info.warnings} noun="map" />
      ) : null}

      {!statsHidden && (
        <section className="rounded-lg border border-border/60 bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Trophy className="size-4 text-muted-foreground" />
            Your record on this map
          </h2>
          {statsIngesting && statRecords.length === 0 ? (
            <Skeleton className="h-16 rounded bg-muted" />
          ) : mapRecord.games === 0 ? (
            <p className="text-sm text-muted-foreground">
              No replays recorded on this map yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                icon={<Swords className="size-3.5" />}
                label="Games"
                value={String(mapRecord.games)}
              />
              <StatCard
                icon={<Trophy className="size-3.5" />}
                label="Win rate"
                value={
                  mapRecord.winRate == null
                    ? "—"
                    : `${Math.round(mapRecord.winRate * 100)}%`
                }
                sub={
                  mapRecord.decided > 0
                    ? `${mapRecord.wins}W · ${mapRecord.losses}L`
                    : "outcome unknown"
                }
              />
              <StatCard
                icon={<Calendar className="size-3.5" />}
                label="Last played"
                value={playedAt(mapRecord.lastPlayedMs)}
              />
              <StatCard
                icon={<Flag className="size-3.5" />}
                label="Top faction"
                value={mapRecord.favouriteFaction?.key ?? "—"}
                sub={
                  mapRecord.favouriteFaction
                    ? `${mapRecord.favouriteFaction.wins}W of ${mapRecord.favouriteFaction.games}`
                    : undefined
                }
              />
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            Preview
            {minimap.startPositions.length > 0
              ? ` · ${minimap.startPositions.length} start positions`
              : ""}
          </h2>
          {minimap.url && (
            <MapLayerToggle layer={overlay.layer} onChange={overlay.setLayer} />
          )}
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-card">
            {minimap.loading ? (
              <div className="flex size-64 max-w-full items-center justify-center">
                <Skeleton className="size-32 rounded bg-muted" />
              </div>
            ) : minimap.url ? (
              // Give the box a definite width derived from the 32rem height cap
              // (`width = ratio * 32rem` ⇒ `height = 32rem`), capped by `max-w-sm`
              // for wide maps (then `max-w` binds and the height shrinks instead —
              // aspect stays correct). The `shrink-0` card collapses to this width,
              // so a tall map yields a narrow card and the `flex-1` 3D preview grows
              // to fill the freed space. `object-fill` stretches the square source
              // back to the true shape.
              <div
                className="relative max-h-[32rem] max-w-sm"
                style={{
                  aspectRatio: `${ratio}`,
                  width: `calc(${ratio} * 32rem)`,
                }}
              >
                <img
                  src={minimap.url}
                  alt={`Minimap of ${map.name}`}
                  className={`absolute inset-0 size-full object-fill${
                    overlay.overlayUrl ? " brightness-[0.55]" : ""
                  }`}
                />
                {overlay.overlayUrl && (
                  <MapOverlayImage src={overlay.overlayUrl} />
                )}
                {markers.map((m, i) => (
                  <span
                    key={m.key}
                    className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-primary shadow"
                    style={{ left: `${m.left}%`, top: `${m.top}%` }}
                    title={`Start position ${i + 1}`}
                  />
                ))}
              </div>
            ) : (
              <div className="flex size-64 max-w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                <ImageOff className="size-6" />
                <span className="text-xs">No minimap</span>
              </div>
            )}
          </div>

          {heightmap.data && heightmap.url && minimap.url && (
            <MapPreview3D
              className="w-full min-w-0 lg:flex-1"
              heightSrc={heightmap.url}
              heightRange={heightmap.range}
              textureSrc={minimap.url}
              appearance={minimap.appearance}
              skyboxSrc={skybox.dataUrl}
              minHeight={heightmap.data.minHeight ?? 0}
              maxHeight={heightmap.data.maxHeight ?? 0}
              worldWidth={
                heightmap.data.width
                  ? (heightmap.data.width - 1) * 8
                  : (map.width ?? 1) * 16
              }
              worldHeight={
                heightmap.data.height
                  ? (heightmap.data.height - 1) * 8
                  : (map.height ?? 1) * 16
              }
            />
          )}
        </div>
      </section>

      <MapEligibilitySection mapName={map.name} />

      {otherInfo.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Metadata</h2>
          <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-border/50 bg-card p-3 text-sm">
            {otherInfo.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <OptionsList options={mapInfo.info?.options ?? []} title="Map options" />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          Archives ({map.archives.length})
        </h2>
        {map.archives.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No archives reported for this map.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {map.archives.map((a, i) => (
              <ArchiveRow
                key={a.name}
                archive={a}
                // Skip the self-classification on the map's own archive (i === 0)
                // so it doesn't render a redundant "View map" back to this page.
                classification={
                  i === 0 ? undefined : classifyArchive(data, a.name)
                }
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Opt this map out of the two modes that pick maps for the player (issue #696).
 * The switch is the player's own layer: when the branding catalog or the
 * distribution profile has already excluded the map, it shows that state and
 * why, and stays off. Exclusion is additive, so there is nothing to re-enable.
 */
function MapEligibilitySection({ mapName }: { mapName: string }) {
  const { verdictFor, setPlayerExcluded } = useMapEligibility();
  const verdict = verdictFor(mapName);
  const curated = verdict !== null && verdict.source !== "player";

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Warpath and Galactic Conquest</h2>
      <label
        htmlFor="map-mode-eligibility"
        className="flex items-center justify-between gap-4 rounded-lg border border-border/50 bg-card p-3"
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium">Hide this map</span>
          <span className="text-xs text-muted-foreground">
            {curated
              ? `Hidden by the ${
                  verdict.source === "catalog"
                    ? "branding catalog"
                    : "distribution profile"
                }${verdict.reason ? `: ${verdict.reason}` : "."}`
              : "Keep this map out of generated warpaths and conquests. It stays playable in skirmish and multiplayer."}
          </span>
        </span>
        <Switch
          id="map-mode-eligibility"
          checked={verdict !== null}
          disabled={curated}
          onCheckedChange={(on) => setPlayerExcluded(mapName, on)}
        />
      </label>
    </section>
  );
}
