import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { CloudOff } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { errorText } from "@/lib/helpers";
import { useWriteRoot } from "../../downloads/config";
import {
  type EnqueueInput,
  useDownloadQueue,
} from "../../downloads/DownloadQueueProvider";
import { useHubGames, useHubGamesFailure } from "../../hub/gameIcons";
import {
  filterUninstalledGames,
  useBrandingCatalog,
  useSuggestedGames,
} from "../branding";
import { useScanTargetSelection, useUnitsyncGameHeaders } from "../config";
import { useScanWithLastKnown } from "../lastKnownScan";
import type { LibraryGame } from "../library";
import {
  chipCounts,
  GAME_CHIPS,
  GAME_SORT_OPTIONS,
  type GameChip,
  type GameSort,
  inGamesGrid,
  isSearchableMutator,
  installRequest,
  matchesChip,
  matchesSearch,
  sortGames,
  updateRequest,
} from "../libraryGames";
import { type CatalogueRequest, useLibrary } from "../useLibrary";
import { usePlayGame } from "../usePlayGame";
import { useUpdateSources } from "../useUpdates";
import { NoEngines, RescanButton } from "./components/BrowserToolbar";
import { FilterBar } from "./components/FilterBar";
import { GameCard } from "./components/GameCard";
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

/** What a chip with nothing in it says. */
const EMPTY_CHIP = {
  installed: msg`No games installed.`,
  updates: msg`Every installed game is up to date.`,
  featured: msg`The hub features no games.`,
  notInstalled: msg`Every game is installed.`,
} as const satisfies Record<GameChip, unknown>;

/**
 * Every game the player has and every game the hub knows how to fetch, in one
 * grid. The hub's list is the catalogue and the selected engine's scan is the
 * install state, so a game on disk the hub does not list stays, marked Local.
 * The springfiles index and the GitHub repos of the installed games add their
 * archives as sources and updates. Scans run on open and are cached for the
 * session.
 */
export default function GamesPage() {
  const { t } = useLingui();
  const { targets, selected } = useScanTargetSelection();
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
  const { headers, loading: headersLoading } = useUnitsyncGameHeaders(
    selected?.enginePath,
    selected?.rootPath,
  );
  const playGame = usePlayGame();
  const writeRoot = useWriteRoot("games");
  const writePath = writeRoot?.path;
  const { enqueue, cancel: cancelDownload, itemFor } = useDownloadQueue();
  const hubFailure = useHubGamesFailure();
  const hubRead = useHubGames() !== null && !hubFailure;

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<GameSort>("featured");
  // The topbar's update badge links here with ?filter=updates.
  const [params] = useSearchParams();
  const [picked, setChip] = useState<GameChip | null>(
    () =>
      GAME_CHIPS.find((c) => c.value === params.get("filter"))?.value ?? null,
  );

  // A failed Init leaves data null and the engine's reason in error. The raw
  // result stays in unvouched, which this page still lists from, unless there
  // is a saved list to show instead (unchecked).
  const scanFailure = unvouched && !unchecked ? error : null;
  const scanned = result?.games ?? [];
  const busy = loading || (!!selected && !data && !error && !cancelled);

  // The same update sources the topbar badge counts from, plus the
  // springfiles index, which tells a hub game with no source of its own
  // apart from one springfiles has.
  const updateSources = useUpdateSources(result);
  const catalogues = useMemo(
    (): CatalogueRequest[] => [
      { source: "springfiles", kind: "game" },
      ...updateSources.catalogues,
    ],
    [updateSources.catalogues],
  );
  const library = useLibrary({
    scan: result,
    catalogues,
    rapidVersions: updateSources.rapidVersions,
  });
  const records = useMemo(
    () => library.games.filter(inGamesGrid),
    [library.games],
  );
  const counts = useMemo(() => chipCounts(records), [records]);
  // A mutator is on its parent's page, and a search is the one way it is also
  // listed here.
  const mutators = useMemo(
    () => library.games.filter(isSearchableMutator),
    [library.games],
  );
  // The player's own games until they pick a chip, or the games they could
  // get when they have none yet.
  const chip = picked ?? (counts.installed > 0 ? "installed" : "notInstalled");
  const shown = useMemo(
    () =>
      sortGames(
        (search.trim()
          ? [...records, ...mutators]
          : records
        ).filter((g) => matchesChip(g, chip) && matchesSearch(g, search)),
        sort,
      ),
    [records, mutators, chip, search, sort],
  );

  // Curated download suggestions, for when nothing is installed and the hub
  // could not be read either.
  const suggested = useSuggestedGames();
  const entries = useBrandingCatalog();
  const installedFiles = library.installedFiles.games;
  const suggestions = useMemo(
    () => filterUninstalledGames(suggested, entries, installedFiles, scanned),
    [suggested, entries, installedFiles, scanned],
  );

  // Turning the hub's sources into a download can read a GitHub release list,
  // so each card says it is resolving, and why it failed, by record id.
  const [resolving, setResolving] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  async function start(
    g: LibraryGame,
    request: (g: LibraryGame, writePath: string) => Promise<EnqueueInput>,
  ) {
    if (!writePath) return;
    setResolving((prev) => new Set(prev).add(g.id));
    setFailures(({ [g.id]: _, ...rest }) => rest);
    try {
      enqueue(await request(g, writePath));
    } catch (e) {
      setFailures((prev) => ({ ...prev, [g.id]: errorText(e) }));
    } finally {
      setResolving((prev) => {
        const next = new Set(prev);
        next.delete(g.id);
        return next;
      });
    }
  }

  // An Updates chip reading 0 offers nothing, so it shows only when there is
  // an update or it is the chip already chosen.
  const chips = GAME_CHIPS.filter(
    (c) => c.value !== "updates" || counts.updates > 0 || chip === "updates",
  ).map((c) => ({ ...c, label: t(c.label), count: counts[c.value] }));
  const sortOptions = GAME_SORT_OPTIONS.map((o) => ({
    ...o,
    label: t(o.label),
  }));
  const gamesNoun = t`games`;
  const searchTerm = search.trim();

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title={t`Games`}
        description={t`Everything you can play, and everything the hub knows how to fetch.`}
        actions={
          targets.length > 0 && (
            <RescanButton
              onRescan={() => run(true)}
              scanning={loading}
              onCancel={cancel}
            />
          )
        }
      />
      {targets.length === 0 && <NoEngines />}

      {unchecked && (
        <SavedListStatus checking={status === "checking"} reason={error} />
      )}

      {hubFailure && (
        <p
          role="status"
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <CloudOff className="size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{hubFailure}</span>
        </p>
      )}

      {writeRoot && !writeRoot.loading && !writePath && records.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Set a download folder in{" "}
            <Link
              className="underline underline-offset-4"
              to="/settings/content-folders"
            >
              Content folders
            </Link>{" "}
            to install games.
          </Trans>
        </p>
      )}

      {(!busy || unchecked) && records.length > 0 && (
        <FilterBar
          chips={chips}
          chip={chip}
          onChip={(v) => setChip(v as GameChip)}
          chipsLabel={t`Show`}
          search={search}
          onSearch={setSearch}
          searchPlaceholder={t`Search games…`}
          searchLabel={t`Search games`}
          sort={sort}
          onSort={(v) => setSort(v as GameSort)}
          sortOptions={sortOptions}
          sortClassName="w-40"
          total={counts[chip]}
          shown={shown.length}
          noun={gamesNoun}
        />
      )}

      {error && !scanFailure && !unchecked && <ErrorBanner message={error} />}
      {result?.errors?.length ? <Diagnostics errors={result.errors} /> : null}
      {scanFailure && records.length > 0 && scanned.length === 0 && (
        <ScanFailed noun={gamesNoun} reason={scanFailure} />
      )}

      {targets.length === 0 ? null : busy && !unchecked ? (
        <SkeletonList grid />
      ) : cancelled && records.length === 0 ? (
        <EmptyState label={t`Scan cancelled. Press Rescan to load games.`} />
      ) : records.length === 0 && scanFailure ? (
        <ScanFailed noun={gamesNoun} reason={scanFailure} />
      ) : records.length === 0 ? (
        suggestions.length > 0 ? (
          <SuggestionsList
            kind="game"
            heading={t`No games yet — try one of these`}
            items={suggestions}
            writeRoot={writeRoot}
            onComplete={() => run(true)}
          />
        ) : (
          <EmptyState label={t`No games found for this engine.`} />
        )
      ) : shown.length === 0 ? (
        <EmptyState
          label={
            searchTerm
              ? t`No games match “${searchTerm}”.`
              : t(EMPTY_CHIP[chip])
          }
        />
      ) : (
        <ul className={CARD_GRID}>
          {shown.map((g) => {
            const installed = g.installed[0];
            const header = installed ? headers.get(installed.name) : undefined;
            return (
              <li
                key={g.id}
                className="[contain-intrinsic-size:13rem] [content-visibility:auto]"
              >
                <GameCard
                  game={g}
                  headerUrl={header}
                  loading={!!installed && headersLoading && !header}
                  playDisabled={unchecked}
                  canDownload={!!writePath}
                  resolving={resolving.has(g.id)}
                  failure={failures[g.id] ?? g.download?.error}
                  progress={g.download ? itemFor(g.download.identity) : null}
                  hubRead={hubRead}
                  onPlay={() => installed && playGame(installed.name)}
                  onInstall={() => start(g, installRequest)}
                  onUpdate={() => start(g, updateRequest)}
                  onCancel={() => g.download && cancelDownload(g.download.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
