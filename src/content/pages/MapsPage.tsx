import { Button, useDrawer } from "@picoframe/frame";
import { CloudOff, Loader2, Map as MapIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useImportParam } from "../../deeplink/useImportParam";
import { useWriteRoot } from "../../downloads/config";
import { useDownloadQueue } from "../../downloads/DownloadQueueProvider";
import { MapPacksBanner } from "../../downloads/pages/components/MapPacksBanner";
import { nextDrawerKey } from "../../general/drawerKey";
import { useRecordHubImport } from "../../hub/imports";
import { useMapFactsBatch } from "../../hub/maps/useMapFacts";
import { presetRoute } from "../../play/presets";
import { isHubEnabled } from "../../profile/profile";
import { filterUninstalledMaps, useSuggestedMaps } from "../branding";
import { useScanTargetSelection, useUnitsyncThumbnails } from "../config";
import { useScanWithLastKnown } from "../lastKnownScan";
import type { LibraryMap } from "../library";
import {
  catalogueLabel,
  isMapOnDisk,
  isPlayType,
  MAP_CATALOGUES,
  MAP_CHIPS,
  MAP_SORT_OPTIONS,
  type MapChip,
  type MapSort,
  mapCaption,
  mapInstallRequest,
  mapSquares,
  matchesMapScope,
  matchesMapSearch,
  matchesPlayType,
  type PlayType,
  sortMaps,
} from "../libraryMaps";
import { useLibrary } from "../useLibrary";
import { usePlayMap } from "../usePlayMap";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { FilterBar } from "./components/FilterBar";
import { LibraryMapCard } from "./components/LibraryMapCard";
import { SuggestionsList } from "./components/SuggestionsList";
import {
  CARD_GRID,
  Diagnostics,
  EmptyState,
  ErrorBanner,
  SavedListStatus,
  ScanFailed,
  SkeletonList,
} from "./components/states";

/** How many cards to draw at a time. The springfiles index has thousands. */
const PAGE = 200;

/** What a chip with nothing in it says. */
const EMPTY_CHIP: Record<MapChip, string> = {
  installed: "No maps installed.",
  notInstalled: "Every map is installed.",
  "1v1": "No 1v1 maps.",
  team: "No team maps.",
  water: "No water maps.",
};

/** What a play type chip says when the cards checked so far hold none. */
const NONE_CHECKED: Record<PlayType, string> = {
  "1v1": "No 1v1 maps",
  team: "No team maps",
  water: "No water maps",
};

/**
 * Every map the player has and every map the mirrors carry, in one grid. The
 * mirror indexes are the catalogue, merged on spring name, and the selected
 * engine's scan is the install state, so a map on disk no mirror lists stays,
 * marked Local. The hub's facts for the cards on screen add the start count
 * and the play type the 1v1, Team and Water chips filter on.
 */
export default function MapsPage() {
  const { targets, selected, selectedKey } = useScanTargetSelection();
  const {
    data,
    unvouched,
    result,
    unchecked,
    status,
    loading,
    error,
    cancelled,
    run,
    cancel,
  } = useScanWithLastKnown(selected?.enginePath, selected?.rootPath);
  const { thumbs, loading: thumbsLoading } = useUnitsyncThumbnails(
    selected?.enginePath,
    selected?.rootPath,
  );
  const playMap = usePlayMap();
  const writeRoot = useWriteRoot("maps");
  const writePath = writeRoot?.path;
  const { enqueue, cancel: cancelDownload, itemFor } = useDownloadQueue();
  const hubOn = isHubEnabled();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<MapSort>("name-asc");
  const [picked, setChip] = useState<MapChip | null>(null);
  const [limit, setLimit] = useState(PAGE);

  // A failed Init leaves data null and the engine's reason in error. The raw
  // result stays in unvouched, which this page still lists from, unless there
  // is a saved list to show instead (unchecked).
  const scanFailure = unvouched && !unchecked ? error : null;
  const scanned = result?.maps ?? [];
  const busy = loading || (!!selected && !data && !error && !cancelled);

  const library = useLibrary({ scan: result, catalogues: MAP_CATALOGUES });
  const records = library.maps;
  const installedFiles = library.installedFiles.maps;
  const thumbOf = (m: LibraryMap) => thumbs.get(m.installed?.name ?? m.id);

  const counts = useMemo(
    () => ({
      all: records.length,
      installed: records.filter(isMapOnDisk).length,
      notInstalled: records.filter((m) => !isMapOnDisk(m)).length,
    }),
    [records],
  );
  // The player's own maps until they pick a chip, or the maps they could get
  // when they have none yet.
  const chip = picked ?? (counts.installed > 0 ? "installed" : "notInstalled");

  // Sorted by the sizes known without the hub, so the facts that arrive for
  // the cards on screen never move which cards are on screen.
  const scoped = useMemo(() => {
    const area = (m: LibraryMap) => {
      const s = mapSquares(m, thumbs.get(m.installed?.name ?? m.id), undefined);
      return s ? s.width * s.height : 0;
    };
    return sortMaps(
      records.filter(
        (m) => matchesMapScope(m, chip) && matchesMapSearch(m, search),
      ),
      sort,
      area,
    );
  }, [records, chip, search, sort, thumbs]);

  // The hub is asked about the cards on screen, a page at a time. A play type
  // chip checks the same page of every map and shows the ones that match.
  const page = useMemo(() => scoped.slice(0, limit), [scoped, limit]);
  const names = useMemo(() => page.map((m) => m.id), [page]);
  const { facts, answered } = useMapFactsBatch(names);
  const shown = isPlayType(chip)
    ? page.filter((m) => matchesPlayType(facts.get(m.id), chip))
    : page;
  const remaining = scoped.length - page.length;

  const chips = MAP_CHIPS.filter((c) => hubOn || !isPlayType(c.value)).map(
    (c) => ({
      ...c,
      count: isPlayType(c.value) ? undefined : counts[c.value],
    }),
  );

  // Pack maps borrow the springfiles pictures for their thumbnails.
  const packThumbs = useMemo(
    () =>
      records.flatMap((m) =>
        m.sources.flatMap((s) =>
          s.thumb ? [{ filename: s.filename, thumb: s.thumb }] : [],
        ),
      ),
    [records],
  );

  // Curated download suggestions, for when nothing is installed and no mirror
  // could be read either.
  const suggested = useSuggestedMaps();
  const suggestions = useMemo(
    () => filterUninstalledMaps(suggested, installedFiles, scanned),
    [suggested, installedFiles, scanned],
  );

  // A confirmed `coilbox://import` deep link for a setup pack lands here with
  // the pack code in the query string (issue #388). This is the one content
  // screen no distribution profile can hide: `library.maps` is not in
  // `HIDEABLE_NAV_IDS`, unlike the hub screen, which redirects home when the
  // hub is off. The old `/downloads/maps` path redirects here with its query.
  const { code: importCode, hubItemId } = useImportParam();
  const recordHubImport = useRecordHubImport();
  const drawer = useDrawer();

  const openPackImport = async (initialCode?: string) => {
    const { ImportPackForm } = await import(
      "../../packs/pages/components/ImportPackForm"
    );
    drawer.open({
      title: "Import a setup pack",
      width: "26rem",
      content: (
        // A fresh form every time, because the last one may still be mounted and
        // would keep the code it already ran (issue #1395).
        <ImportPackForm
          key={nextDrawerKey()}
          initialCode={initialCode}
          onImported={(presetIds, content) =>
            recordHubImport(
              hubItemId,
              presetIds,
              presetIds[0] ? presetRoute(presetIds[0]) : "/library/maps",
              content,
            )
          }
        />
      ),
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the deep-link code arrives, not on every drawer identity change
  useEffect(() => {
    if (importCode) void openPackImport(importCode);
  }, [importCode]);

  const resetPage = () => setLimit(PAGE);
  const showMore = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setLimit((l) => l + PAGE)}
    >
      Show more ({remaining} remaining)
    </Button>
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Maps</h1>
        <p className="text-sm text-muted-foreground">
          Every map you have, and every map the mirrors carry.
        </p>
      </header>

      <BrowserToolbar
        targets={targets}
        selectedKey={selectedKey}
        onRescan={() => run(true)}
        scanning={loading}
        onCancel={cancel}
      />

      <MapPacksBanner
        writePath={writePath}
        installed={installedFiles}
        items={packThumbs}
      />

      {unchecked && (
        <SavedListStatus checking={status === "checking"} reason={error} />
      )}

      {!library.cataloguesRead && (
        <p
          role="status"
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          Reading the mirror indexes…
        </p>
      )}
      {library.catalogueFailures.map((f) => (
        <p
          key={catalogueLabel(f.request)}
          role="status"
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <CloudOff className="size-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {catalogueLabel(f.request)}: {f.reason}
          </span>
        </p>
      ))}

      {writeRoot && !writeRoot.loading && !writePath && records.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Set a download folder in{" "}
          <Link
            className="underline underline-offset-4"
            to="/settings/content-folders"
          >
            Content folders
          </Link>{" "}
          to install maps.
        </p>
      )}

      {(!busy || unchecked) && records.length > 0 && (
        <FilterBar
          chips={chips}
          chip={chip}
          onChip={(v) => {
            setChip(v as MapChip);
            resetPage();
          }}
          chipsLabel="Show"
          search={search}
          onSearch={(v) => {
            setSearch(v);
            resetPage();
          }}
          searchPlaceholder="Search maps…"
          searchLabel="Search maps"
          sort={sort}
          onSort={(v) => {
            setSort(v as MapSort);
            resetPage();
          }}
          sortOptions={MAP_SORT_OPTIONS}
          total={isPlayType(chip) ? counts.all : counts[chip]}
          shown={scoped.length}
          noun="maps"
        />
      )}

      {error && !scanFailure && !unchecked && <ErrorBanner message={error} />}
      {result?.errors?.length ? <Diagnostics errors={result.errors} /> : null}
      {scanFailure && records.length > 0 && scanned.length === 0 && (
        <ScanFailed noun="maps" reason={scanFailure} />
      )}

      {targets.length === 0 ? null : busy && !unchecked ? (
        <SkeletonList grid />
      ) : cancelled && records.length === 0 ? (
        <EmptyState label="Scan cancelled. Press Rescan to load maps." />
      ) : records.length === 0 && scanFailure ? (
        <ScanFailed noun="maps" reason={scanFailure} />
      ) : records.length === 0 ? (
        !library.cataloguesRead ? (
          <SkeletonList grid />
        ) : suggestions.length > 0 ? (
          <SuggestionsList
            kind="map"
            heading="No maps yet — try one of these"
            items={suggestions}
            writeRoot={writeRoot}
            onComplete={() => run(true)}
          />
        ) : (
          <EmptyState icon={MapIcon} label="No maps found for this engine." />
        )
      ) : shown.length === 0 ? (
        isPlayType(chip) && !answered ? (
          <SkeletonList grid />
        ) : (
          <EmptyState
            icon={MapIcon}
            label={
              search.trim()
                ? `No maps match “${search.trim()}”.`
                : isPlayType(chip) && remaining > 0
                  ? `${NONE_CHECKED[chip]} in the first ${page.length}.`
                  : EMPTY_CHIP[chip]
            }
            action={remaining > 0 ? showMore : undefined}
          />
        )
      ) : (
        <>
          <ul className={CARD_GRID}>
            {shown.map((m) => {
              const thumb = thumbOf(m);
              const known = facts.get(m.id);
              const squares = mapSquares(m, thumb, known);
              return (
                <li
                  key={m.id}
                  className="[contain-intrinsic-size:16rem] [content-visibility:auto]"
                >
                  <LibraryMapCard
                    map={m}
                    thumbUrl={thumb?.url}
                    squares={squares}
                    caption={mapCaption(m, squares, known)}
                    loading={!!m.installed && thumbsLoading && !thumb}
                    playDisabled={unchecked}
                    canDownload={!!writePath}
                    failure={m.download?.error}
                    progress={m.download ? itemFor(m.download.identity) : null}
                    onPlay={() => m.installed && playMap(m.installed.name)}
                    onInstall={() => {
                      const request =
                        writePath && mapInstallRequest(m, writePath);
                      if (request) enqueue(request);
                    }}
                    onCancel={() => m.download && cancelDownload(m.download.id)}
                  />
                </li>
              );
            })}
          </ul>
          {remaining > 0 && (
            <div className="flex justify-center">{showMore}</div>
          )}
        </>
      )}
    </div>
  );
}
