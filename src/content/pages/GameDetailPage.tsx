import { Button, useSetting } from "@picoframe/frame";
import { FolderOpen, Trophy } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { GameEquivalents } from "@/blueprint/pages/components/GameEquivalents";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useFactionLogos } from "@/factions/logos";
import { generatedGameNote } from "@/lib/generatedGames";
import { isProfileHidden } from "@/profile/hidden";
import { type Archive, contentOpenPath } from "../bindings";
import { useBrandingEntry } from "../branding";
import {
  classifyArchive,
  useContentState,
  useReplayStats,
  useScanTargetSelection,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "../config";
import { isDeletableArchive, isSdd } from "../format";
import { refightFilenames, useReplayUserState } from "../replayUserState";
import { allPlayers, factionRecordsFor, guessPrimaryPlayer } from "../stats";
import { usePlayGame } from "../usePlayGame";
import { ArchiveRow } from "./components/ArchiveRow";
import { BrandingLinks } from "./components/BrandingLinks";
import { BrandingScreenshots } from "./components/BrandingScreenshots";
import { DeleteArchiveButton } from "./components/DeleteArchiveButton";
import { FactionBuildList } from "./components/FactionBuildList";
import { GameHeader } from "./components/GameHeader";
import { MissionRuntimeSection } from "./components/MissionRuntimeSection";
import { OptionsList } from "./components/OptionsList";
import { StartModeActions } from "./components/StartModeActions";
import { TallyBar } from "./components/StatWidgets";
import {
  DetailError,
  DetailLoading,
  NotFound,
  WarningBanner,
} from "./components/states";

/** Keys surfaced in the headline; everything else goes in the metadata table. */
const HEADLINE_KEYS = new Set(["name", "shortname", "version", "description"]);

/**
 * A single game: its metadata, its own (primary) archive, the archives it depends
 * on, and the full modinfo key/value set.
 */
export default function GameDetailPage() {
  const { name } = useParams();
  const decoded = name ? decodeURIComponent(name) : "";
  const playGame = usePlayGame();
  const navigate = useNavigate();
  const { selected } = useScanTargetSelection();
  const { data, loading, error, run } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const game = data?.games.find((g) => g.name === decoded);
  const { info: gameInfo, loading: gameInfoLoading } = useUnitsyncGameInfo(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const startUnits = useMemo(
    () =>
      gameInfo
        ? Array.from(
            new Set(
              gameInfo.sides
                .map((s) => s.startUnit)
                .filter((u): u is string => !!u),
            ),
          )
        : [],
    [gameInfo],
  );
  const buildpics = useUnitsyncUnitBuildpics(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
    startUnits,
  );
  // The reusable unit graph (units + buildoptions edges) backs the per-side build
  // buttons + drawer (see FactionBuildList). Fetched on demand when this page opens —
  // never during the scan.
  const { dataset, status: datasetStatus } = useUnitsyncUnitDataset(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const brand = useBrandingEntry(game);
  const factionNames = useMemo(
    () => gameInfo?.sides.map((s) => s.name) ?? [],
    [gameInfo],
  );
  const factionLogos = useFactionLogos({
    game,
    enginePath: selected?.enginePath,
    dataDir: selected?.rootPath,
    gameArchive: game?.primaryArchive.name,
    sideNames: factionNames,
    size: 20,
  });

  // Per-faction records (#460): a distribution profile can hide stats entirely,
  // in which case the roots stay empty so `useReplayStats` never ingests.
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
  const factionRecords = useMemo(
    () => factionRecordsFor(statRecords, factionNames, statsPlayer, refights),
    [statRecords, factionNames, statsPlayer, refights],
  );

  if (error && !data)
    return (
      <DetailError
        backTo="/content/games"
        message={error}
        onRetry={() => run(true)}
      />
    );
  if (!data || loading) return <DetailLoading backTo="/content/games" />;
  if (!game) return <NotFound backTo="/content/games" label="game" />;

  const otherInfo = Object.entries(game.info).filter(
    ([k]) => !HEADLINE_KEYS.has(k),
  );

  // Coilbox's own generated games are hidden from every picker, so this page is
  // the one place they are shown. Saying what wrote it is what keeps a folder in
  // `games/` that appears in no picker from reading as a bug (issue #810).
  const generated = generatedGameNote(game.primaryArchive.name);

  const openFolder = (a: Archive) => {
    if (!a.path) return;
    // A .sdd path is the folder itself; otherwise open the containing folder.
    const target = isSdd(a) ? a.path : a.path.replace(/[\\/][^\\/]*$/, "");
    contentOpenPath({ path: target }).catch(() => {});
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <GameHeader
        game={game}
        enginePath={selected?.enginePath}
        dataDir={selected?.rootPath}
        onPlay={() => playGame(game.name)}
      />

      {generated && (
        <Alert>
          <AlertDescription className="max-w-prose">
            {generated} It is not offered anywhere a game is picked, which is
            why you will not find it in Singleplayer or in a scenario&apos;s
            setup.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {game.info.shortname && (
            <span className="font-mono">{game.info.shortname}</span>
          )}
          {gameInfo?.checksum && (
            <span className="font-mono">checksum {gameInfo.checksum}</span>
          )}
        </div>
        {game.info.description && (
          <p className="max-w-prose text-sm text-muted-foreground">
            {game.info.description}
          </p>
        )}
      </div>

      <StartModeActions gameName={game.name} />

      {brand && <BrandingLinks entry={brand} />}
      {brand?.screenshots?.length ? (
        <BrandingScreenshots shots={brand.screenshots} />
      ) : null}

      {game.warnings?.length ? (
        <WarningBanner warnings={game.warnings} noun="game" />
      ) : null}

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

      {(gameInfoLoading || (gameInfo && gameInfo.sides.length > 0)) && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">
              Sides
              {gameInfo && gameInfo.unitCount > 0
                ? ` · ${gameInfo.unitCount} units`
                : ""}
            </h2>
            {/* A reader looking at the build tree is already asking about this
                game's units, so the encyclopedia grid is offered right beside it. */}
            <Link
              to={`/content/games/${encodeURIComponent(game.name)}/units`}
              className="text-xs text-muted-foreground hover:underline"
            >
              Browse units
            </Link>
          </div>
          {/* An unreadable unit list leaves every faction button on nothing,
              which otherwise reads as a game with no build tree. */}
          {datasetStatus === "error" && (
            <p className="text-xs text-muted-foreground">
              Could not read this game's units, so its build trees are empty.
            </p>
          )}
          {gameInfoLoading || !gameInfo || !selected ? (
            <Skeleton className="h-12 rounded-lg border border-border/50 bg-card" />
          ) : (
            <FactionBuildList
              enginePath={selected.enginePath}
              dataDir={selected.rootPath}
              gameArchive={game.primaryArchive.name}
              gameName={game.name}
              sides={gameInfo.sides}
              units={dataset?.units ?? []}
              buildpics={buildpics}
              factionLogos={factionLogos}
              branding={brand}
            />
          )}
        </section>
      )}

      {/* What converting a layout of this game between its sides has been
          told, which is a fact about the game rather than about any layout, so
          it belongs here and not on a blueprint (issue #1533). Nothing at all
          for a game nobody has answered anything about. */}
      <GameEquivalents gameArchive={game.primaryArchive.name} />

      {!statsHidden && factionNames.length > 0 && (
        <section className="rounded-lg border border-border/60 bg-card p-4">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
            <Trophy className="size-4 text-muted-foreground" />
            Your record by faction
          </h2>
          {statsIngesting && statRecords.length === 0 ? (
            <Skeleton className="h-12 rounded bg-muted" />
          ) : (
            <ul className="divide-y divide-border/40">
              {factionRecords.map((f) => (
                <li
                  key={f.faction}
                  className="flex items-center gap-3 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate" title={f.faction}>
                    {f.faction}
                  </span>
                  {f.games === 0 ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      No games recorded
                    </span>
                  ) : f.decided === 0 ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {f.games} game{f.games === 1 ? "" : "s"} · outcome unknown
                    </span>
                  ) : (
                    <TallyBar games={f.games} wins={f.wins} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <OptionsList options={gameInfo?.options ?? []} title="Game options" />

      <MissionRuntimeSection game={game} />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Primary archive</h2>
          <div className="flex items-center gap-2">
            {game.primaryArchive.path && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => openFolder(game.primaryArchive)}
              >
                <FolderOpen className="size-4" /> Open folder
              </Button>
            )}
            {game.primaryArchive.path &&
              isDeletableArchive(game.primaryArchive.path) && (
                <DeleteArchiveButton
                  path={game.primaryArchive.path}
                  name={game.primaryArchive.name}
                  onDeleted={() => navigate("/content/games")}
                />
              )}
          </div>
        </div>
        <ul>
          <ArchiveRow archive={game.primaryArchive} />
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          Dependencies ({game.dependencyArchives.length})
        </h2>
        {game.dependencyArchives.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This game depends on no other archives.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {game.dependencyArchives.map((a) => (
              <ArchiveRow
                key={a.name}
                archive={a}
                classification={classifyArchive(data, a.name)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
