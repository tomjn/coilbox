import {
  Button,
  buttonVariants,
  cn,
  useDrawer,
  useSetting,
} from "@picoframe/frame";
import { Boxes, FolderOpen, Loader2, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { GameEquivalents } from "@/blueprint/pages/components/GameEquivalents";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFactionLogos } from "@/factions/logos";
import { useAdvancedMode } from "@/general/advanced";
import { nextDrawerKey } from "@/general/drawerKey";
import { generatedGameNote } from "@/lib/generatedGames";
import { isProfileHidden } from "@/profile/hidden";
import { setGamePin, setGameUpdates } from "../../downloads/gamePrefs";
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
import { missingDependencyNotes } from "../gameDependencies";
import { refightFilenames, useReplayUserState } from "../replayUserState";
import { allPlayers, factionRecordsFor, guessPrimaryPlayer } from "../stats";
import { useCompatReport } from "../useCompatReport";
import { useGameLibrary } from "../useGameLibrary";
import { usePlayGame } from "../usePlayGame";
import { ArchiveRow } from "./components/ArchiveRow";
import { BrandingLinks } from "./components/BrandingLinks";
import { BrandingScreenshots } from "./components/BrandingScreenshots";
import { FindingList } from "./components/CompatFindings";
import { CompatMode } from "./components/CompatMode";
import { Convert3doDrawer } from "./components/Convert3doDrawer";
import { DeleteArchiveButton } from "./components/DeleteArchiveButton";
import {
  FactionBuildList,
  useFactionReachableCounts,
} from "./components/FactionBuildList";
import { GameHeader } from "./components/GameHeader";
import { GameLibrarySummary } from "./components/GameLibrarySummary";
import { GameSourcesTab } from "./components/GameSourcesTab";
import { GameVersionsTab } from "./components/GameVersionsTab";
import { MissionRuntimeSection } from "./components/MissionRuntimeSection";
import { OptionCards } from "./components/OptionsList";
import { StartModeActions } from "./components/StartModeActions";
import { TallyBar } from "./components/StatWidgets";
import {
  DetailError,
  DetailLoading,
  MissingDependencyBanner,
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
  const decoded = name ?? "";
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
  // Same counts FactionBuildList's buttons disable on, so the "every side is
  // dead" note below (Zero-K: a readable 614-unit roster whose one side reports
  // a start unit, `update_your_damn_engine`, that unit dataset never defines)
  // and the buttons it explains never disagree.
  const factionCounts = useFactionReachableCounts(
    gameInfo?.sides ?? [],
    dataset?.units ?? [],
  );
  const compat = useCompatReport(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const drawer = useDrawer();
  // The archive page's Convert models link lands here (issue #4554).
  const [params] = useSearchParams();
  const wantsCompat = params.get("section") === "compat";
  const hasFindings = compat.findings.length > 0;
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

  // The Versions and Sources tabs and the library facts above them (#4580).
  const lib = useGameLibrary(decoded, data);
  const [tab, setTab] = useState(wantsCompat ? "compat" : "overview");
  useEffect(() => {
    if (wantsCompat) setTab("compat");
  }, [wantsCompat]);
  const advanced = useAdvancedMode();

  if (error && !data)
    return (
      <DetailError
        backTo="/library/games"
        message={error}
        onRetry={() => run(true)}
      />
    );
  if (!data || loading) return <DetailLoading backTo="/library/games" />;
  if (!game) return <NotFound backTo="/library/games" label="game" />;

  const otherInfo = Object.entries(game.info).filter(
    ([k]) => !HEADLINE_KEYS.has(k),
  );

  // Coilbox's own generated games are hidden from every picker, so this page is
  // the one place they are shown. Saying what wrote it is what keeps a folder in
  // `games/` that appears in no picker from reading as a bug (issue #810).
  const generated = generatedGameNote(game.primaryArchive.name);

  const models = compat.findings.find((f) => f.kind === "models-3do")?.count;
  const gameDir = isSdd(game.primaryArchive)
    ? (compat.archivePath ?? game.primaryArchive.path ?? null)
    : null;
  const openConvert = () => {
    if (!selected?.enginePath || !selected?.rootPath || !models) return;
    drawer.open({
      title: "Convert .3do models",
      description: `Turn ${game.primaryArchive.name}'s ${models} legacy models into .s3o, one shared texture per folder.`,
      width: "44rem",
      content: (
        <Convert3doDrawer
          key={nextDrawerKey()}
          enginePath={selected.enginePath}
          dataDir={selected.rootPath}
          archive={game.primaryArchive.name}
          models={models}
          gameDir={gameDir}
        />
      ),
    });
  };

  const openFolder = (a: Archive) => {
    if (!a.path) return;
    // A .sdd path is the folder itself; otherwise open the containing folder.
    const target = isSdd(a) ? a.path : a.path.replace(/[\\/][^\\/]*$/, "");
    contentOpenPath({ path: target }).catch(() => {});
  };

  // A game can ship a full roster and declare no sides at all: flove's
  // GameData/SideData.lua returns an empty table, so unitsync reports its 30
  // units and no side. Gating this whole section on sides took the unit count
  // and the All units link off with them, and that link is the only route to
  // the units page. Only the per-faction list needs sides, so only it drops
  // out. `!gameInfo` counts as having sides so the heading does not read
  // "Units" for the length of the read and then change.
  const hasSides = !gameInfo || gameInfo.sides.length > 0;
  const unitCount = gameInfo?.unitCount ?? 0;
  // "Units · 30" rather than "Units · 30 units", which the sides heading can
  // say because its own noun is different.
  const sectionHeading = hasSides
    ? `Sides${unitCount > 0 ? ` · ${unitCount} units` : ""}`
    : `Units${unitCount > 0 ? ` · ${unitCount}` : ""}`;

  // Gated on "ready" (a genuine read, checksum and all) rather than just
  // `dataset` being non-null, or this reads true for a heartbeat while the
  // dataset is still loading and every side's count is 0 because there are no
  // units yet, not because none of them resolve. A game whose read failed
  // entirely gets its own message below instead.
  const noSideReachesAnything =
    datasetStatus === "ready" &&
    (dataset?.units.length ?? 0) > 0 &&
    (gameInfo?.sides.length ?? 0) > 0 &&
    gameInfo?.sides.every((s) => (factionCounts.get(s.name) ?? 0) === 0);

  return (
    <div className="flex flex-col gap-5 p-4">
      <GameHeader
        game={game}
        installed={data?.games ?? null}
        enginePath={selected?.enginePath}
        dataDir={selected?.rootPath}
        onPlay={() => playGame(game.name)}
      />

      <Tabs
        className="gap-4"
        value={tab === "advanced" && !advanced ? "overview" : tab}
        onValueChange={setTab}
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="options">Options</TabsTrigger>
          <TabsTrigger value="compat">Compatibility</TabsTrigger>
          {advanced && <TabsTrigger value="advanced">Advanced</TabsTrigger>}
        </TabsList>
        <TabsContent value="versions">
          <GameVersionsTab
            table={lib.versions}
            indexAge={lib.indexAge}
            loading={lib.rapidLoading}
            errors={lib.rapidErrors}
            canInstall={!!lib.writePath}
            statusOf={lib.statusOf}
            onInstall={lib.install}
            onRemoved={() => navigate("/library/games")}
          />
        </TabsContent>
        <TabsContent value="sources">
          <GameSourcesTab
            rows={lib.sources}
            onPin={(step) => setGamePin(lib.prefKey, step)}
          />
        </TabsContent>
        <TabsContent value="options">
          {gameInfoLoading ? (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin" />
              Reading this game&apos;s options…
            </p>
          ) : !gameInfo ? (
            <p className="text-sm text-muted-foreground">
              Could not read this game&apos;s options.
            </p>
          ) : gameInfo.options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This game has no options.
            </p>
          ) : (
            <OptionCards options={gameInfo.options} />
          )}
        </TabsContent>
        <TabsContent value="compat">
          <section className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-4">
            {hasFindings && selected?.enginePath && selected.rootPath && (
              <CompatMode
                enginePath={selected.enginePath}
                dataDir={selected.rootPath}
                archiveName={game.primaryArchive.name}
                gameName={game.name}
                checksum={gameInfo?.checksum}
              />
            )}
            {hasFindings && (
              <FindingList
                findings={compat.findings}
                actions={{
                  "models-3do": selected && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={openConvert}
                    >
                      <Boxes className="size-4" /> Convert models
                    </Button>
                  ),
                }}
              />
            )}
            {compat.checking ? (
              <p
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" />
                {hasFindings ? "Still checking…" : "Checking this game…"}
              </p>
            ) : !hasFindings ? (
              <p className="text-sm text-muted-foreground">
                {compat.read
                  ? "Nothing found that would stop this game running on this engine."
                  : "Could not read this game's files."}
              </p>
            ) : null}
          </section>
        </TabsContent>
        <TabsContent value="overview" className="flex flex-col gap-5">
          <StartModeActions gameName={game.name} />
          <GameLibrarySummary
            game={game}
            record={lib.record}
            installedFrom={lib.installedFrom}
            engine={selected?.engineVersion}
            updatesOn={lib.updatesOn}
            onUpdatesChange={(on) => setGameUpdates(lib.prefKey, on)}
            canUpdate={!!lib.writePath && !!lib.record}
            updating={lib.updating}
            onUpdate={lib.update}
          />
          {lib.updateFailure && (
            <p role="alert" className="break-words text-xs text-destructive">
              {lib.updateFailure}
            </p>
          )}

          {generated && (
            <Alert>
              <AlertDescription className="max-w-prose">
                {generated} It is not offered anywhere a game is picked, which
                is why you will not find it in Singleplayer or in a
                scenario&apos;s setup.
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

          {brand && <BrandingLinks entry={brand} />}
          {brand?.screenshots?.length ? (
            <BrandingScreenshots shots={brand.screenshots} />
          ) : null}

          {missingDependencyNotes(game).length > 0 && (
            <MissingDependencyBanner notes={missingDependencyNotes(game)} />
          )}
          {game.warnings?.length ? (
            <WarningBanner warnings={game.warnings} noun="game" />
          ) : null}

          {(gameInfoLoading ||
            (gameInfo &&
              (gameInfo.sides.length > 0 || gameInfo.unitCount > 0))) && (
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium">{sectionHeading}</h2>
                {/* Per-faction browsing (FactionBuildList) never reaches the units no
                faction's build tree reaches, so this is the one way back to all
                of them, "Other units" included, unless the read that would
                populate it failed outright. Then there is nothing for it to
                link to either. */}
                {datasetStatus === "error" ? (
                  <Button type="button" variant="outline" size="sm" disabled>
                    All units
                  </Button>
                ) : (
                  <Link
                    to={`/library/games/${encodeURIComponent(game.name)}/units`}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                    )}
                  >
                    All units
                  </Link>
                )}
              </div>
              {/* An unreadable unit list leaves every faction button, and All
              units, on nothing. The errors say this is a coilbox read
              failure, not the game shipping none. */}
              {datasetStatus === "error" && (
                <Alert variant="destructive">
                  <AlertTitle>Could not read this game&apos;s units</AlertTitle>
                  <AlertDescription>
                    <ul className="flex flex-col gap-1 font-mono text-xs">
                      {(dataset?.errors ?? []).map((e) => (
                        <li key={e} className="break-words">
                          {e}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {/* The read succeeded (Zero-K: 614 units, no errors) but every side's
              start unit is one the dataset never defines, so every per-faction
              button below is correctly dead. Without this, that reads as a
              broken page rather than the game's own sides.lua declining to
              hand back a usable commander. All units still works, since the
              roster it lists never depended on a side resolving. */}
              {noSideReachesAnything && (
                <p className="text-xs text-muted-foreground">
                  None of this game&apos;s sides resolve to a start unit in its
                  roster, so every build tree below is empty. All units still
                  lists the full roster.
                </p>
              )}
              {gameInfoLoading || !gameInfo || !selected ? (
                <div className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border/50 bg-card text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading sides…
                </div>
              ) : hasSides ? (
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
              ) : null}
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
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={f.faction}
                      >
                        {f.faction}
                      </span>
                      {f.games === 0 ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          No games recorded
                        </span>
                      ) : f.decided === 0 ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {f.games} game{f.games === 1 ? "" : "s"} · outcome
                          unknown
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
        </TabsContent>
        {advanced && (
          <TabsContent value="advanced" className="flex flex-col gap-5">
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
                        onDeleted={() => navigate("/library/games")}
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

            {otherInfo.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">Metadata</h2>
                <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-border/50 bg-card p-3 text-sm">
                  {otherInfo.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="font-mono text-xs text-muted-foreground">
                        {k}
                      </dt>
                      <dd className="break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <MissionRuntimeSection game={game} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
