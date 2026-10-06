import {
  Button,
  buttonVariants,
  cn,
  Input,
  useDrawer,
  useSetting,
} from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  Dices,
  Download,
  Loader2,
  Map as MapIcon,
  MapPlus,
  Orbit,
  Share2,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ContinueBadge } from "@/components/ContinueBadge";
import { OptionSelect } from "@/components/OptionSelect";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { FactionLogo } from "@/factions/FactionLogo";
import { useFactionLogo } from "@/factions/logos";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { mostRecentOpen } from "@/lib/recency";
import { challengeExport } from "../../challenge/bindings";
import { ChallengeShare } from "../../challenge/ChallengeShare";
import { ImportChallengeForm as SharedImportChallengeForm } from "../../challenge/ImportChallengeForm";
import {
  conquestImportIdentity,
  galaxyIdentity,
} from "../../challenge/identity";
import { resolveBranding, useBrandingCatalog } from "../../content/branding";
import { useUnitsyncGameHeaders, useUnitsyncScan } from "../../content/config";
import { dependencyBlockReason } from "../../content/gameDependencies";
import { useMapEligibility } from "../../content/mapEligibility";
import { BrandingLinks } from "../../content/pages/components/BrandingLinks";
import { BrandingScreenshots } from "../../content/pages/components/BrandingScreenshots";
import {
  DependencyBlocked,
  Diagnostics,
  EmptyState,
  ErrorBanner,
  ScanFailed,
  SkeletonList,
} from "../../content/pages/components/states";
import {
  normalizeGameIdentity,
  stripVersionSuffix,
} from "../../content/resolveContent";
import { useGamePresetParam } from "../../content/useGamePresetParam";
import { useImportParam } from "../../deeplink/useImportParam";
import { nextDrawerKey } from "../../general/drawerKey";
import { useRecordHubImport } from "../../hub/imports";
import {
  usePlayReadiness,
  usePreferredTarget,
  useSkirmishAis,
} from "../../play/config";
import { challengeGameRequirement, offerableGames } from "../../play/gameOffer";
import {
  candidateGames,
  compareGameVersions,
  resolveGameByShortname,
} from "../../play/installedGames";
import { missingLaunchDependency } from "../../play/launchContent";
import { DownloadGameButton } from "../../play/pages/components/DownloadGameButton";
import { GamePickerButton } from "../../play/pages/components/GamePickerButton";
import { GamePickerPanel } from "../../play/pages/components/GamePickerPanel";
import { useGameCatalog } from "../../play/useGameCatalog";
import { getGameMatcher, getProfile } from "../../profile/profile";
import { conquestDelete, conquestSave } from "../bindings";
import {
  encodeConquestChallenge,
  encodeConquestChallengeFile,
  galaxyFromChallenge,
  substitutedMapCount,
} from "../challenge";
import { refreshGalaxies, useConquestState, useGalaxies } from "../conquests";
import type { GenerateOptions } from "../generate";
import {
  GENERATE_CHOICES_KEY,
  type GenerateChoices,
  offeredOr,
  readGenerateChoices,
} from "../generateChoices";
import { ARCHIVE_MAPS_DIR } from "../handmade/archive";
import {
  type ConquestImportSettings,
  decodeConquestImport,
  encodeHandmadeChallenge,
  encodeHandmadeChallengeFile,
  isHandmadeChallenge,
  loadChallengeMap,
} from "../handmade/challenge";
import {
  handmadeConquestDoc,
  handmadeRun,
  readHandmadeRun,
} from "../handmade/conquest";
import { holdHandmadeChallenge } from "../handmade/heldChallenge";
import {
  type HandmadeImportResult,
  type HandmadeMapSummary,
  importHandmadeMap,
  removeHandmadeMap,
} from "../handmade/library";
import {
  hidesGeneratedStyles,
  mapsForGame,
  profileOnlyOwnMaps,
} from "../handmade/ownMapsOnly";
import {
  refreshHandmadeMaps,
  useGameMapFacts,
  useHandmadeMap,
  useHandmadeMaps,
} from "../handmade/useHandmadeMaps";
import { generateMap, locationNoun, MAP_STYLE_OPTIONS } from "../mapStyle";
import {
  type ConquestState,
  type GalaxyDoc,
  isLandSkin,
  type MapSkin,
} from "../model";
import { mergeConquestNames } from "../names";
import {
  DEFAULT_RADIUS_LY,
  RADIUS_CHOICES,
  systemCountWithin,
} from "../realstars";
import type { GeneratedTerrain } from "../terrainGen";
import { generatedTerrain } from "../territories";
import { sizeOptions, startPositionUnlocked, unlockedLevel } from "../unlocks";
import { useConquestUnlocks } from "../useUnlocks";
import { GalaxyPreview2D } from "./components/GalaxyPreview2D";
import { MapErrorList } from "./components/MapErrorList";
import { StartPositionSelect } from "./components/StartPositionSelect";
import { ThreatLevelSelect } from "./components/ThreatLevelSelect";

/**
 * The Conquest hub: in-progress runs first, then maps ready to start
 * (bundled and generated), plus the "Generate a map" drawer, the
 * procedural fallback for games that ship no authored map. Faction/side
 * choice happens on the galaxy page itself, over a live preview of the map.
 */
export default function ConquestListPage() {
  const { galaxies, loading, error } = useGalaxies();
  const { file, error: stateError, saveFor } = useConquestState();
  const [abandonError, setAbandonError] = useState<string | null>(null);
  const abandon = async (galaxyId: string) => {
    setAbandonError(null);
    try {
      await saveFor(galaxyId, undefined);
    } catch (e) {
      setAbandonError(
        `The conquest was not abandoned. ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
  const drawer = useDrawer();
  const navigate = useNavigate();

  // unitsync is the source of truth for "is a game available", not a file count:
  // rapid installs (BAR et al.) live in packages/pool, not games/*.sd7. Shared
  // with the sidebar nav badge (issue #419) via `usePlayReadiness`, so the two
  // never disagree.
  const { target, state, scanErrors, scanFailure, refresh } =
    usePlayReadiness();
  // The games the galaxies on this machine are made for, with the download of
  // each one a download can be named for (issue #3368). Needs an engine: the
  // check cannot read what is installed without one.
  const gameCatalog = useGameCatalog();
  const gameOffers = useMemo(
    () =>
      target
        ? offerableGames(
            galaxies.map((g) => g.galaxy.game),
            gameCatalog,
          )
        : [],
    [target, galaxies, gameCatalog],
  );
  // "scanning" and "finding-engine" are deliberately absent: a scan or an engine
  // lookup that has not answered yet leaves the list up rather than flashing an
  // empty state that is about to be wrong.
  const needsGame =
    state === "no-engine" || state === "empty" || state === "unreadable";

  const runs = galaxies.filter((g) => file.conquests[g.galaxy.id]);
  const unstarted = galaxies.filter((g) => !file.conquests[g.galaxy.id]);

  // Hand-made maps (issue #3509). A map is listed beside the galaxies, and a
  // conquest on one is saved under the map's id like any other. A galaxy with
  // the same id is opened first, so a map it hides is said to be hidden.
  const handmade = useHandmadeMaps();
  const galaxyIds = new Set(galaxies.map((g) => g.galaxy.id));
  const maps = handmade.maps.filter((m) => !galaxyIds.has(m.id));
  const hiddenMaps = handmade.maps.filter((m) => galaxyIds.has(m.id));
  const mapRuns = maps.filter((m) => file.conquests[m.id]);
  const mapsUnstarted = maps.filter((m) => !file.conquests[m.id]);
  // A conquest whose map is gone is still a save, and is shown as one. Only
  // once the list has answered, or every conquest would look lost.
  // A failed search of the game archives says nothing about a map a game
  // carries, so no conquest is called lost then either.
  const lostRuns =
    loading || handmade.loading || handmade.error || handmade.archiveError
      ? []
      : Object.entries(file.conquests).flatMap(([id, state]) => {
          const run = readHandmadeRun(state);
          const gone =
            run && !galaxyIds.has(id) && !maps.some((m) => m.id === id);
          return gone
            ? [{ id, title: run.title, carriedBy: run.carriedBy, state }]
            : [];
        });
  const [mapError, setMapError] = useState<string | null>(null);
  const removeMap = async (map: HandmadeMapSummary) => {
    setMapError(null);
    try {
      await removeHandmadeMap(map.id);
      await refreshHandmadeMaps();
    } catch (e) {
      setMapError(
        `"${map.title}" was not removed. ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
  const nothingListed =
    galaxies.length === 0 &&
    handmade.maps.length === 0 &&
    handmade.unreadable.length === 0 &&
    lostRuns.length === 0;

  // The single most recently updated run still in progress (issue #374's
  // "continue playing" affordance). Badged below, not a separate button,
  // since each run's card already links straight to it.
  const runIds = [...runs.map((g) => g.galaxy.id), ...mapRuns.map((m) => m.id)];
  const resumeGalaxyId = mostRecentOpen(
    runIds,
    (id) => file.conquests[id]?.status === "active",
    (id) => Date.parse(file.conquests[id]?.updatedAt ?? ""),
  );

  // A confirmed `coilbox://import` deep link (issue #388) lands here with the
  // challenge code in the query string, and with the hub item it came from
  // alongside it when the hub browse screen started it (issue #1368).
  const { code: importCode, hubItemId } = useImportParam();
  const recordHubImport = useRecordHubImport();

  const openGenerate = (initialGameName?: string) =>
    drawer.open({
      title: "Generate a map",
      width: "30rem",
      content: (
        <GenerateGalaxyForm
          initialGameName={initialGameName}
          onCreated={(id) => {
            drawer.close();
            navigate(`/conquest/${encodeURIComponent(id)}`);
          }}
        />
      ),
    });

  const openImportChallenge = (initialCode?: string) =>
    drawer.open({
      title: "Import challenge",
      width: "26rem",
      content: (
        // A fresh form every time, because the last one may still be mounted
        // and would keep the code it already ran (issue #1395).
        <ImportChallengeForm
          key={nextDrawerKey()}
          initialCode={initialCode}
          onImported={(id) => {
            const route = `/conquest/${encodeURIComponent(id)}`;
            recordHubImport(hubItemId, [id], route);
            drawer.close();
            navigate(route);
          }}
        />
      ),
    });

  // Pick a zip, then run the import in a drawer that shows how it went.
  const importMap = async () => {
    const zipPath = await open({
      title: "Import map",
      multiple: false,
      filters: [{ name: "Hand-made map", extensions: ["zip"] }],
    });
    if (typeof zipPath !== "string") return;
    drawer.open({
      title: "Import map",
      width: "26rem",
      content: (
        <ImportMapForm
          key={nextDrawerKey()}
          zipPath={zipPath}
          onClose={() => drawer.close()}
          onOpenMap={(id) => {
            drawer.close();
            navigate(`/conquest/${encodeURIComponent(id)}`);
          }}
        />
      ),
    });
  };

  // Open the import drawer with the deep link's code prefilled, so the same
  // decode plus content-resolution flow runs as a manual paste.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the deep-link code arrives, not on every drawer identity change
  useEffect(() => {
    if (importCode) openImportChallenge(importCode);
  }, [importCode]);

  // Game detail's "Start a conquest" action (issue #372) lands here with the
  // game preselected in the query string. Open the generate wizard with it
  // prefilled, the same way an import code opens its own drawer above.
  const presetGame = useGamePresetParam();
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the preset arrives, not on every drawer identity change
  useEffect(() => {
    if (presetGame) openGenerate(presetGame);
  }, [presetGame]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title="Conquest"
        description="Wage a campaign across a map of territory you take one battle at a time. Win skirmishes to capture territory, defend against counterattacks, and take every enemy capital."
        actions={
          !needsGame && (
            <>
              <Button variant="outline" onClick={importMap}>
                <MapPlus className="mr-1.5 size-4" aria-hidden /> Import map
              </Button>
              <Button variant="outline" onClick={() => openImportChallenge()}>
                <Download className="mr-1.5 size-4" aria-hidden /> Import
                challenge
              </Button>
              <Button onClick={() => openGenerate()}>
                <Dices className="mr-1.5 size-4" aria-hidden /> Generate a map
              </Button>
            </>
          )
        }
      />

      {error && <ErrorBanner message={error} />}
      {stateError && (
        <ErrorBanner
          message={`Your conquest progress could not be read. Nothing has been changed. ${stateError}`}
        />
      )}
      {abandonError && <ErrorBanner message={abandonError} />}
      {handmade.error && (
        <ErrorBanner
          message={`The hand-made maps could not be listed. ${handmade.error}`}
        />
      )}
      {handmade.archiveError && (
        <ErrorBanner
          message={`The installed games could not be searched for maps they carry, so none is listed. ${handmade.archiveError}`}
        />
      )}
      {mapError && <ErrorBanner message={mapError} />}

      {needsGame ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
            <Orbit className="size-6 text-muted-foreground" aria-hidden />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {state === "unreadable"
                  ? "This engine could not read your games"
                  : target
                    ? "Conquest needs a game installed"
                    : "Conquest needs an engine and a game"}
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                {state === "unreadable"
                  ? "The scan finished but the engine reported problems and listed no games, so this is not a sign that you own none. Try another engine, or open Content > Games to see what it did find."
                  : target
                    ? "Conquest generates a map for any installed game with skirmish AIs. Download a game to get started, and it will appear here automatically."
                    : "Install an engine and at least one game, then return here to generate a map for it."}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {state !== "unreadable" &&
                gameOffers.map(({ game, download }) => (
                  <DownloadGameButton
                    key={`${game.shortname}|${game.pinnedName ?? ""}`}
                    game={game}
                    download={download}
                    onReady={refresh}
                  />
                ))}
              {(!target || state === "unreadable") && (
                <Link
                  to="/settings/engines"
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  {state === "unreadable"
                    ? "Pick another engine"
                    : "Install an engine"}
                </Link>
              )}
              {state === "unreadable" ? (
                <Link
                  to="/library/games"
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  Open Content &gt; Games
                </Link>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => navigate("/downloads/games")}
                >
                  Browse games to download
                </Button>
              )}
            </div>
          </div>
          {state === "unreadable" && scanFailure && (
            <ScanFailed noun="games" reason={scanFailure} />
          )}
          {state === "unreadable" && <Diagnostics errors={scanErrors} />}
        </div>
      ) : loading || handmade.savedLoading || state === "finding-engine" ? (
        <SkeletonList />
      ) : nothingListed && handmade.loading ? (
        <SearchingGames />
      ) : nothingListed ? (
        <EmptyState label="No conquest maps yet. Generate one for any installed game, or import a map or a challenge." />
      ) : (
        <>
          {runIds.length + lostRuns.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                In progress
              </h2>
              <ul className="flex flex-col gap-2">
                {runs.map(({ galaxy, source }) => (
                  <li key={galaxy.id}>
                    <GalaxyCard
                      galaxy={galaxy}
                      bundled={source === "bundled"}
                      state={file.conquests[galaxy.id]}
                      resume={galaxy.id === resumeGalaxyId}
                      onAbandon={() => abandon(galaxy.id)}
                    />
                  </li>
                ))}
                {mapRuns.map((map) => (
                  <li key={map.id}>
                    <HandmadeMapCard
                      map={map}
                      state={file.conquests[map.id]}
                      resume={map.id === resumeGalaxyId}
                      onAbandon={() => abandon(map.id)}
                    />
                  </li>
                ))}
                {lostRuns.map(({ id, title, carriedBy, state }) => (
                  <li key={id}>
                    <LostMapCard
                      title={title}
                      carriedBy={carriedBy}
                      state={state}
                      onAbandon={() => abandon(id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {unstarted.length + mapsUnstarted.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                Ready to start
              </h2>
              <ul className="flex flex-col gap-2">
                {unstarted.map(({ galaxy, source }) => (
                  <li key={galaxy.id}>
                    <GalaxyCard
                      galaxy={galaxy}
                      bundled={source === "bundled"}
                      state={undefined}
                    />
                  </li>
                ))}
                {mapsUnstarted.map((map) => (
                  <li key={map.id}>
                    <HandmadeMapCard
                      map={map}
                      state={undefined}
                      onRemove={
                        map.source === "imported"
                          ? () => removeMap(map)
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {handmade.unreadable.length + hiddenMaps.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                Maps that could not be listed
              </h2>
              <ul className="flex flex-col gap-2">
                {handmade.unreadable.map((u) => (
                  <li key={`${u.source}/${u.carriedBy ?? ""}/${u.folder}`}>
                    <Card className="gap-2 rounded-lg border-border/50 p-3 shadow-none">
                      <span className="text-sm font-medium">
                        {u.source === "game"
                          ? `"${ARCHIVE_MAPS_DIR}/${u.folder}" in ${u.carriedBy}`
                          : `${u.source === "bundled" ? "Bundled map" : "Map"} folder "${u.folder}"`}
                      </span>
                      <MapErrorList errors={u.errors} />
                    </Card>
                  </li>
                ))}
                {hiddenMaps.map((m) => (
                  <li key={m.id}>
                    <Card className="gap-2 rounded-lg border-border/50 p-3 shadow-none">
                      <span className="text-sm font-medium">{m.title}</span>
                      <p className="text-sm text-muted-foreground">
                        This map has the id "{m.id}", which a map in the list
                        above already uses, so the map is not listed. Change the
                        id in its map.json and import it again.
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {handmade.loading && <SearchingGames />}
        </>
      )}
    </div>
  );
}

/**
 * Said while the installed games are searched for maps they carry, which takes
 * one unitsync run a game. The rest of the list is already up (issue #3616).
 */
function SearchingGames() {
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Searching your installed games for maps they carry.
    </p>
  );
}

/** Share of nodes the player's chosen faction holds, in percent. */
function territoryPercent(galaxy: GalaxyDoc, state: ConquestState): number {
  const total = galaxy.nodes.length;
  if (total === 0) return 0;
  const held = galaxy.nodes.filter(
    (n) => state.owners[n.id] === state.playerFactionId,
  ).length;
  return Math.round((held / total) * 100);
}

/** Share of a conquest's locations the player holds, from the save alone. */
function heldPercent(state: ConquestState): number {
  const owners = Object.values(state.owners);
  if (owners.length === 0) return 0;
  const held = owners.filter((o) => o === state.playerFactionId).length;
  return Math.round((held / owners.length) * 100);
}

function statusClass(state: ConquestState | undefined): string {
  return state?.status === "won"
    ? "text-emerald-400"
    : state?.status === "lost"
      ? "text-red-400"
      : "text-muted-foreground";
}

/**
 * A hand-made map in the list: its picture, title and description, and the
 * conquest on it when there is one. The list is drawn from each map's
 * manifest alone. The map itself is read when it is opened.
 */
function HandmadeMapCard({
  map,
  state,
  resume,
  onAbandon,
  onRemove,
}: {
  map: HandmadeMapSummary;
  state: ConquestState | undefined;
  resume?: boolean;
  /** Present for a conquest in progress: clears it, keeping the map. */
  onAbandon?: () => void;
  /** Present for an imported map with no conquest on it. */
  onRemove?: () => void;
}) {
  const drawer = useDrawer();
  const openShareChallenge = (conquest: ConquestState) =>
    drawer.open({
      title: "Share challenge",
      width: "26rem",
      content: <HandmadeChallengeShare map={map} state={conquest} />,
    });
  const statusLabel =
    state?.status === "won"
      ? "Victory"
      : state?.status === "lost"
        ? "Defeat"
        : state
          ? `Turn ${state.turn} · ${heldPercent(state)}% held`
          : "Not started";
  return (
    <Card className="flex-row items-center gap-3 rounded-lg border-border/50 p-3 shadow-none transition-colors hover:border-border hover:bg-accent/50">
      <Link
        to={`/conquest/${encodeURIComponent(map.id)}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {map.pictureUrl ? (
            <img
              src={map.pictureUrl}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <MapIcon className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{map.title}</span>
            {map.source === "bundled" && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                Bundled
              </span>
            )}
            {map.source === "game" && (
              <span
                className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                title={`The game ${map.carriedBy} carries this map`}
              >
                From the game
              </span>
            )}
            {resume && <ContinueBadge />}
          </div>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {map.game.shortname} · Hand-made map
            {map.description ? ` · ${map.description}` : ""}
          </p>
          <span className={`text-xs ${statusClass(state)}`}>{statusLabel}</span>
        </div>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </Link>
      {state && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Share ${map.title} as a challenge code`}
          title="Share challenge"
          onClick={() => openShareChallenge(state)}
        >
          <Share2 className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      )}
      {state && onAbandon ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Abandon ${map.title}`}
          title="Abandon this campaign"
          onClick={onAbandon}
        >
          <Trash2 className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      ) : (
        onRemove && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${map.title}`}
            title="Remove this map"
            onClick={onRemove}
          >
            <Trash2 className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        )
      )}
    </Card>
  );
}

/**
 * The challenge code for a conquest on a hand-made map. The card is drawn
 * from the manifest alone, so the map is read here, when the code is asked
 * for: its fingerprint comes from the read.
 */
function HandmadeChallengeShare({
  map,
  state,
}: {
  map: HandmadeMapSummary;
  state: ConquestState;
}) {
  const { loading, result, failure } = useHandmadeMap(map.id);
  if (loading) {
    return (
      <p className="p-4 text-sm text-muted-foreground">Reading the map…</p>
    );
  }
  const run = readHandmadeRun(state);
  if (!result?.ok || !run) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <ErrorBanner
          message={`No challenge code can be made, because the map "${map.title}" could not be read.${failure ? ` ${failure}` : ""}`}
        />
        {result && !result.ok && <MapErrorList errors={result.errors} />}
      </div>
    );
  }
  const galaxy = handmadeConquestDoc(result.doc, run);
  const exportChallengeFile = async () => {
    const fileText = encodeHandmadeChallengeFile(galaxy);
    if (!fileText) return;
    const dest = await save({
      title: "Export challenge",
      defaultPath: `${galaxy.title || "challenge"}.json`,
      filters: [{ name: "Coilbox challenge", extensions: ["json"] }],
    });
    if (!dest) return;
    await challengeExport({ text: fileText, dest });
  };
  return (
    <ChallengeShare
      identity={galaxyIdentity(galaxy)}
      code={encodeHandmadeChallenge(galaxy) ?? ""}
      helpText="Anyone who pastes this code into Import challenge plays this map with the same settings, so results are directly comparable. They need the same game and the same version of this map installed. The code does not carry the map."
      onExportFile={exportChallengeFile}
    />
  );
}

/** A saved conquest whose hand-made map is no longer installed. */
function LostMapCard({
  title,
  carriedBy,
  state,
  onAbandon,
}: {
  title: string;
  /** The game that carried the map when the conquest started. */
  carriedBy?: string;
  state: ConquestState;
  onAbandon: () => void;
}) {
  return (
    <Card className="flex-row items-center gap-3 rounded-lg border-border/50 p-3 shadow-none">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
        <MapIcon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{title}</span>
        <p className="text-xs text-muted-foreground">
          {carriedBy
            ? `The game ${carriedBy} no longer carries the map this conquest is played on. A game update may have removed it. Your progress is saved (turn ${state.turn}), and it carries on if a game carries the map again.`
            : `The map this conquest is played on is no longer installed. Your progress is saved (turn ${state.turn}). Import the map again to carry on.`}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Abandon ${title}`}
        title="Abandon this campaign"
        onClick={onAbandon}
      >
        <Trash2 className="size-4 text-muted-foreground" aria-hidden />
      </Button>
    </Card>
  );
}

/**
 * Import a hand-made map from a zip and say how it went. The import starts as
 * the drawer opens. A map that is already installed is replaced only after the
 * player agrees, and a map the reader refuses lists every reason.
 */
function ImportMapForm({
  zipPath,
  onClose,
  onOpenMap,
}: {
  zipPath: string;
  onClose: () => void;
  onOpenMap: (id: string) => void;
}) {
  /** Null while an import is running. */
  const [result, setResult] = useState<HandmadeImportResult | null>(null);
  const run = useCallback(
    async (replace: boolean) => {
      setResult(null);
      const next = await importHandmadeMap(zipPath, { replace });
      // The list changes on an install, and on a failed read after one.
      if (next.status !== "exists") {
        await refreshHandmadeMaps().catch(() => {});
      }
      setResult(next);
    },
    [zipPath],
  );
  // Once per drawer, so a second effect run cannot import the zip twice.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run(false);
  }, [run]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {result === null && (
        <p className="text-sm text-muted-foreground">Importing the map…</p>
      )}
      {result?.status === "imported" && (
        <>
          <p className="text-sm">
            "{result.doc.title}" is imported and listed on the Conquest page.
          </p>
          {result.skipped > 0 && (
            <p className="text-sm text-muted-foreground">
              {result.skipped} file{result.skipped === 1 ? "" : "s"} in the zip{" "}
              {result.skipped === 1 ? "was" : "were"} left out, because a map
              does not use {result.skipped === 1 ? "it" : "them"}.
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={() => onOpenMap(result.id)}>Open the map</Button>
            <Button variant="outline" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      )}
      {result?.status === "exists" && (
        <>
          <p className="text-sm">
            A map called "{result.title}" is already installed. Replace it with
            the one in this zip?
          </p>
          <p className="text-sm text-muted-foreground">
            A conquest in progress on it is kept and carries on with the new
            map.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => run(true)}>Replace the map</Button>
            <Button variant="outline" onClick={onClose}>
              Keep the installed map
            </Button>
          </div>
        </>
      )}
      {result?.status === "invalid" && (
        <>
          <p className="text-sm">
            The map was not imported. Fix the following in the map folder, zip
            it again and import the new zip.
          </p>
          <MapErrorList errors={result.errors} />
        </>
      )}
      {result?.status === "refused" && (
        <ErrorBanner message={`The map was not imported. ${result.message}`} />
      )}
    </div>
  );
}

function GalaxyCard({
  galaxy,
  bundled,
  state,
  resume,
  onAbandon,
}: {
  galaxy: GalaxyDoc;
  bundled: boolean;
  state: ConquestState | undefined;
  /** The single most-recently-updated active run (issue #374): badged, not a
   * separate control, since this card's own link already resumes it. */
  resume?: boolean;
  /** Present for in-progress cards: clears the run state, keeping the galaxy. */
  onAbandon?: () => void;
}) {
  const { refresh } = useGalaxies();
  const drawer = useDrawer();
  // Only a procedurally generated galaxy carries the seed a challenge code
  // needs (issue #376), so nothing to share for an authored/bundled one.
  const challengeCode = encodeConquestChallenge(galaxy);
  const exportChallengeFile = async () => {
    const fileText = encodeConquestChallengeFile(galaxy);
    if (!fileText) return;
    const dest = await save({
      title: "Export challenge",
      defaultPath: `${galaxy.title || "challenge"}.json`,
      filters: [{ name: "Coilbox challenge", extensions: ["json"] }],
    });
    if (!dest) return;
    await challengeExport({ text: fileText, dest });
  };
  const openShareChallenge = () =>
    drawer.open({
      title: "Share challenge",
      width: "26rem",
      content: (
        <ChallengeShare
          identity={galaxyIdentity(galaxy)}
          code={challengeCode ?? ""}
          helpText="Anyone who pastes this code into Import challenge (needs the same game installed) plays the identical map, so results are directly comparable."
          onExportFile={exportChallengeFile}
        />
      ),
    });
  // The player's chosen faction emblem (by its in-game side), shown in place of the
  // generic orbit glyph. Resolved per card, hooks are shared/cached per target.
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const installedGame = resolveGameByShortname(
    galaxy.game,
    scan.data?.games ?? [],
  );
  const playerLogo = useFactionLogo(
    {
      game: installedGame ?? undefined,
      enginePath: target?.enginePath,
      dataDir: target?.dataDir,
      gameArchive: installedGame?.primaryArchive.name,
      size: 24,
    },
    state?.playerSide,
  );
  const statusLabel =
    state?.status === "won"
      ? "Victory"
      : state?.status === "lost"
        ? "Defeat"
        : state
          ? `Turn ${state.turn} · ${territoryPercent(galaxy, state)}% held`
          : "Not started";

  return (
    <Card className="flex-row items-center gap-3 rounded-lg border-border/50 p-3 shadow-none transition-colors hover:border-border hover:bg-accent/50">
      <Link
        to={`/conquest/${encodeURIComponent(galaxy.id)}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
          {playerLogo ? (
            <FactionLogo
              logo={playerLogo}
              sideName={state?.playerSide}
              size={24}
            />
          ) : (
            <Orbit className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{galaxy.title}</span>
            {bundled && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                Bundled
              </span>
            )}
            {galaxy.importedChallenge && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                Imported challenge
              </span>
            )}
            {resume && <ContinueBadge />}
          </div>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {galaxy.game.shortname} · {galaxy.nodes.length}{" "}
            {locationNoun(galaxy.theme?.skin).many} · {galaxy.factions.length}{" "}
            factions
          </p>
          <span
            className={`text-xs ${
              state?.status === "won"
                ? "text-emerald-400"
                : state?.status === "lost"
                  ? "text-red-400"
                  : "text-muted-foreground"
            }`}
          >
            {statusLabel}
          </span>
        </div>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </Link>
      {challengeCode && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Share ${galaxy.title} as a challenge code`}
          title="Share challenge"
          onClick={openShareChallenge}
        >
          <Share2 className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      )}
      {state && onAbandon ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Abandon ${galaxy.title}`}
          title="Abandon this campaign"
          onClick={onAbandon}
        >
          <Trash2 className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      ) : (
        !bundled &&
        !state && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${galaxy.title}`}
            onClick={async () => {
              await conquestDelete({ id: galaxy.id });
              await refreshGalaxies();
              refresh();
            }}
          >
            <Trash2 className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        )
      )}
    </Card>
  );
}

const FACTION_OPTIONS = [
  { value: "1", label: "One enemy faction" },
  { value: "2", label: "Two enemy factions" },
  { value: "3", label: "Three enemy factions" },
];
const LAYOUT_OPTIONS = [
  { value: "random", label: "Surprise me" },
  { value: "scatter", label: "Scattered disc" },
  { value: "spiral", label: "Spiral arms" },
  { value: "clusters", label: "Clusters" },
  { value: "ring", label: "Ring" },
  { value: "realstars", label: "Real stars (the solar neighbourhood)" },
];
// Real stars are a galaxy and nothing else, and a disc and arms are a galaxy's
// words, so every other style gets the same shapes under plainer names.
const PLAIN_LAYOUT_OPTIONS = [
  { value: "random", label: "Surprise me" },
  { value: "scatter", label: "Scattered" },
  { value: "spiral", label: "Spiral" },
  { value: "clusters", label: "Clusters" },
  { value: "ring", label: "Ring" },
];
// The land styles describe the land rather than how points are scattered.
const LAND_LAYOUT_OPTIONS = [
  { value: "random", label: "Surprise me" },
  { value: "continent", label: "One continent" },
  { value: "coast", label: "Coast" },
  { value: "continents", label: "Two continents" },
  { value: "archipelago", label: "Archipelago" },
  { value: "inlandsea", label: "Inland sea" },
  { value: "landlocked", label: "Landlocked" },
];
/** The shapes a style offers. */
const layoutOptionsFor = (style: MapSkin) =>
  style === "galaxy"
    ? LAYOUT_OPTIONS
    : isLandSkin(style)
      ? LAND_LAYOUT_OPTIONS
      : PLAIN_LAYOUT_OPTIONS;
/** How long the form waits after the last change before it builds a land
 * preview. A choice, not a measurement: long enough that typing a seed builds
 * one map and not one per digit. */
const LAND_PREVIEW_DELAY_MS = 300;
// Real-star galaxies are sized by radius, not by node count: every system
// inside the radius is on the map. Counts come from the catalogue so they
// cannot drift from the data.
const RADIUS_OPTIONS = RADIUS_CHOICES.map((ly) => ({
  value: String(ly),
  label: `${ly} light years (${systemCountWithin(ly)} systems)`,
}));
/** Sentinel for "let the generator decide" (the classic full-frontier start for
 * procedural maps, capital-only for real stars). An empty string cannot be
 * used: Radix Select reads it as no selection and falls back to the
 * placeholder, leaving the row looking blank. */
const STARTING_DEFAULT = "auto";
/** The starting territory choices, counted in the style's own locations. */
function startingOptions(
  noun: { one: string; many: string },
  realStars: boolean,
) {
  return [
    {
      value: STARTING_DEFAULT,
      label: realStars ? "Capital only (default)" : "Full frontier (default)",
    },
    { value: "1", label: "Capital only" },
    { value: "2", label: `Capital + 1 ${noun.one}` },
    { value: "3", label: `Capital + 2 ${noun.many}` },
    { value: "4", label: `Capital + 3 ${noun.many}` },
  ];
}

/** A land preview, and the options it was built from, as text. */
interface LandPreview {
  key: string;
  doc: GalaxyDoc;
  terrain: GeneratedTerrain | null;
}

/** Where the wizard keeps the game it was last used with. */
const LAST_GAME_KEY = "conquest.generate.lastGame";

/** What makes two installed archives the same game in the wizard: the modinfo
 * shortname and the name without its version. */
function gameChoiceKey(g: {
  name: string;
  info: Record<string, string>;
}): string {
  return `${(g.info.shortname ?? g.name).trim().toLowerCase()}|${normalizeGameIdentity(stripVersionSuffix(g.name))}`;
}

/**
 * The procedural wizard: pick a game (one entry per game, newest
 * installed version, narrowed by the profile's game filter — auto-selected
 * when only one qualifies), size, enemy count and seed, then save the
 * generated document so the run is stable across sessions and content changes.
 */
function GenerateGalaxyForm({
  onCreated,
  initialGameName,
}: {
  onCreated: (id: string) => void;
  /**
   * Preselect this game (its unitsync name) from game detail's "Start a
   * conquest" action (issue #372). Falls back to the wizard's own default
   * pick when the name doesn't match any available game, e.g. it's since
   * been removed.
   */
  initialGameName?: string;
}) {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const brandingEntries = useBrandingCatalog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One wizard entry per game: the newest installed version represents it. A
  // game is its shortname and its name without the version, so an archive that
  // only shares the shortname (Zero-K Benchmark v3 beside Zero-K) is its own
  // entry (issue #3465). The entry's full name is saved on the galaxy.
  // Every game is offered. Whether a game asks for its own maps only is read
  // for the selected game alone (issue #3674), since finding it out for every
  // game takes one archive read each.
  const gameChoices = useMemo(() => {
    const matcher = getGameMatcher();
    // Never coilbox's own generated games: a campaign fought in the unit
    // builder's scratch game is not a campaign.
    const games = withoutGeneratedGames(scan.data?.games ?? []);
    const byShort = new Map<string, (typeof games)[number]>();
    for (const g of games) {
      if (matcher && !matcher(g.name)) continue;
      const short = (g.info.shortname ?? g.name).trim();
      if (!short) continue;
      const key = gameChoiceKey(g);
      const existing = byShort.get(key);
      if (
        !existing ||
        compareGameVersions(g.info.version ?? "", existing.info.version ?? "") >
          0
      ) {
        byShort.set(key, g);
      }
    }
    return [...byShort.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [scan.data]);

  const [gameShort, setGameShort] = useState("");
  // The game this form was last used with, as a `gameChoiceKey`. A frame
  // setting like the host form's, kept apart from Warpath's own.
  const [lastGame, setLastGame] = useSetting(LAST_GAME_KEY, "");
  // Default to the preselected game (if it matches one on offer), else the
  // last game used (if it is still on offer), else the first game, so the
  // create button is never a silent dead-end. The user can still switch games
  // via the select.
  const selected =
    gameChoices.find((g) => gameChoiceKey(g) === gameShort) ??
    (initialGameName
      ? gameChoices.find((g) => g.name === initialGameName)
      : undefined) ??
    gameChoices.find((g) => gameChoiceKey(g) === lastGame) ??
    gameChoices[0];
  const chooseGame = (key: string) => {
    setGameShort(key);
    setLastGame(key);
  };
  const effectiveShort = selected
    ? (selected.info.shortname ?? selected.name).trim()
    : "";

  const {
    ais,
    loaded: aisLoaded,
    failed: aisFailed,
  } = useSkirmishAis(
    target?.enginePath,
    target?.dataDir,
    selected?.primaryArchive.name,
  );

  // Whether this game asks for its own maps only, read for this game alone.
  // The map style field waits on it, so a game that hides the generated styles
  // is never offered them and then has them taken away.
  const { loading: factsLoading, facts } = useGameMapFacts(selected);
  const hidesStyles =
    !!selected &&
    !factsLoading &&
    hidesGeneratedStyles(
      selected,
      mapsForGame(selected, facts.maps),
      facts,
      profileOnlyOwnMaps(),
    );
  const { headers: gameHeaders } = useUnitsyncGameHeaders(
    target?.enginePath,
    target?.dataDir,
  );
  const [pickingGame, setPickingGame] = useState(false);

  // Naming pools / faction presets: the matched game's catalog defaults, with
  // a distribution's profile.json overriding on top.
  const brandingEntry = selected
    ? resolveBranding(brandingEntries, selected)
    : null;
  const names = useMemo(
    () => mergeConquestNames(getProfile().conquest, brandingEntry?.conquest),
    [brandingEntry],
  );

  // What the form remembers from the last map made, apart from the seed. What
  // the player changes in this session is in `picked`, because the stored
  // setting only reaches the form again the next time it opens.
  const [remembered, setRemembered] = useSetting<unknown>(
    GENERATE_CHOICES_KEY,
    {},
  );
  const saved = readGenerateChoices(remembered);
  const [picked, setPicked] = useState<Partial<GenerateChoices>>({});
  const choices = { ...saved, ...picked };
  const choose = (patch: Partial<GenerateChoices>) => {
    setPicked((p) => ({ ...p, ...patch }));
    setRemembered({ ...saved, ...picked, ...patch });
  };
  // A remembered choice the form does not offer now, such as a size or level
  // this game has not unlocked, goes back to the default.
  const style: MapSkin = choices.style ?? "galaxy";
  const layout = offeredOr(choices.layout, layoutOptionsFor(style), "random");
  const radius = offeredOr(
    choices.radius,
    RADIUS_OPTIONS,
    String(DEFAULT_RADIUS_LY),
  );
  const realStars = layout === "realstars";
  const land = isLandSkin(style);
  const noun = locationNoun(style);
  const starting = offeredOr(
    choices.starting,
    startingOptions(noun, realStars),
    STARTING_DEFAULT,
  );
  const factions = offeredOr(choices.factions, FACTION_OPTIONS, "2");
  const fog = choices.fog ?? false;
  // Unlocks are per game, so a level chosen for one game never carries to a
  // game that has not unlocked it.
  const { unlocks } = useConquestUnlocks();
  const ceiling = unlockedLevel(unlocks, effectiveShort);
  const threat = (choices.threat ?? 0) <= ceiling ? (choices.threat ?? 0) : 0;
  // A size above 80 follows the same unlocks.
  const size = offeredOr(choices.size, sizeOptions(ceiling, noun.many), "18");
  const nodeCount = Number(size);
  const startUnlocked = startPositionUnlocked(unlocks, effectiveShort);
  const startPosition =
    choices.start === "centre" && startUnlocked ? "centre" : undefined;
  const [seed, setSeed] = useState(() =>
    String(Math.floor(Math.random() * 100000)),
  );

  const {
    run: runScan,
    data: scanData,
    loading: scanLoading,
    error: scanError,
  } = scan;
  useEffect(() => {
    if (!scanData && !scanLoading && !scanError) runScan();
  }, [scanData, scanLoading, scanError, runScan]);

  // Excluded maps never enter the pool, so a generated galaxy cannot put the
  // player on one (see `content/mapEligibility`).
  const { eligible } = useMapEligibility();
  const maps = useMemo(
    () => eligible(scan.data?.maps ?? []),
    [scan.data, eligible],
  );

  // One options builder shared by the live preview and the create action, so
  // the map the user saw is exactly the map that gets saved.
  const genOptions = useCallback(
    (id: string): GenerateOptions => ({
      seed: Number(seed) || 1,
      game: { shortname: effectiveShort, pinnedName: selected?.name },
      maps,
      nodeCount,
      factionCount: Number(factions),
      layout: layout as GenerateOptions["layout"],
      radiusLy: Number(radius),
      skin: style,
      startingSystems:
        starting === STARTING_DEFAULT ? undefined : Number(starting),
      fogOfWar: fog,
      threatLevel: threat,
      startPosition: realStars ? undefined : startPosition,
      names,
      id,
      title: `${effectiveShort} Conquest`,
    }),
    [
      seed,
      effectiveShort,
      selected?.name,
      maps,
      nodeCount,
      factions,
      layout,
      radius,
      realStars,
      style,
      starting,
      fog,
      threat,
      startPosition,
      names,
    ],
  );

  const canPreview =
    Boolean(selected) && maps.length > 0 && !factsLoading && !hidesStyles;
  // A galaxy or a theatre builds in a few milliseconds, so its preview is
  // built as the form renders.
  const pointPreview = useMemo(() => {
    if (land || !canPreview) return null;
    try {
      return generateMap(genOptions("preview"));
    } catch {
      return null;
    }
  }, [genOptions, land, canPreview]);
  // Land is slower to build, so it waits until the form has been still for a
  // moment. The last preview stays up, dimmed, until the new one replaces it.
  // Keyed on the options as text, so a preview is rebuilt when a value
  // changes and never because an equal object was made again.
  const [landPreview, setLandPreview] = useState<LandPreview | null>(null);
  const landKey = useMemo(
    () => (land && canPreview ? JSON.stringify(genOptions("preview")) : null),
    [genOptions, land, canPreview],
  );
  useEffect(() => {
    if (landKey === null) return;
    const timer = setTimeout(() => {
      try {
        const doc = generateMap(JSON.parse(landKey) as GenerateOptions);
        setLandPreview({
          key: landKey,
          doc,
          terrain: generatedTerrain(doc),
        });
      } catch {
        setLandPreview(null);
      }
    }, LAND_PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [landKey]);
  const preview = land ? (landPreview?.doc ?? null) : pointPreview;
  const previewStale = land && landPreview?.key !== landKey;
  // Not knowing yet is not the same as having none: while the installed engines
  // are being read, the form waits rather than telling the player to install one.
  const blocked: ReactNode =
    !target && targetLoading ? (
      "Looking for an engine…"
    ) : !target ? (
      <>
        Install an engine first (
        <Link className="underline underline-offset-4" to="/settings/engines">
          Settings → Engines
        </Link>
        ).
      </>
    ) : scan.error ? (
      `The content scan failed, so installed games are not listed: ${scan.error}`
    ) : scan.data &&
      (scan.data.games.length === 0 || gameChoices.length === 0) ? (
      <>
        Install a game first (
        <Link className="underline underline-offset-4" to="/library/games">
          Content → Games
        </Link>
        ).
      </>
    ) : maps.length === 0 && scan.data ? (
      <>
        Install at least one map first (
        <Link className="underline underline-offset-4" to="/library/maps">
          Content → Maps
        </Link>
        ).
      </>
    ) : null;

  // Said under the picker, which stays usable so another game can be chosen.
  const stylesBlock = hidesStyles
    ? `${selected?.name} plays Conquest only on the maps the game carries. Pick one from the Conquest list.`
    : null;
  // The opponents are fought with the game's skirmish AIs, so a map cannot be
  // made until the list is in, but the rest of the form can be filled in.
  const aiNote =
    !selected || stylesBlock
      ? null
      : aisFailed
        ? "The skirmish AIs for this game could not be listed."
        : !aisLoaded
          ? "Loading this game's skirmish AIs."
          : ais.length === 0
            ? "This game has no skirmish AIs to fight against."
            : null;

  // Creating a map is not a launch, so this does not stop the form. The
  // player is told here, because every battle of it would stop on it (issue
  // #3489).
  const dependency = selected
    ? missingLaunchDependency(selected.name, scan.data?.games ?? [])
    : null;
  const dependencyBlock = dependency?.gameName
    ? dependencyBlockReason(dependency.label, dependency.gameName)
    : null;

  const create = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const id = `generated-${crypto.randomUUID()}`;
      const doc = generateMap(genOptions(id));
      await conquestSave({ id, json: JSON.stringify(doc) });
      // A game reached from game detail is remembered too, not only one picked
      // in the select.
      setLastGame(gameChoiceKey(selected));
      setRemembered({
        style,
        layout,
        size,
        radius,
        factions,
        starting,
        fog,
        threat,
        start: startPosition ?? "edge",
      } satisfies GenerateChoices);
      await refreshGalaxies();
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // The game picker takes over the drawer rather than opening a second one on
  // top of it, as the host forms do (issue #2995). The form's state stays.
  if (pickingGame) {
    return (
      <div className="p-4">
        <GamePickerPanel
          games={gameChoices}
          headers={gameHeaders}
          selectedName={selected?.name ?? ""}
          onSelect={(name) => {
            const picked = gameChoices.find((g) => g.name === name);
            if (picked) chooseGame(gameChoiceKey(picked));
          }}
          onBack={() => setPickingGame(false)}
          backLabel="Back to the map form"
          gamesLoading={scan.loading}
          scanError={scan.error}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {blocked ? (
        <p className="text-sm text-muted-foreground">{blocked}</p>
      ) : (
        <>
          {gameChoices.length > 1 && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Game</span>
              <GamePickerButton
                value={selected?.name ?? ""}
                games={gameChoices}
                headers={gameHeaders}
                placeholder={scan.loading ? "Scanning…" : "Select a game"}
                onClick={() => setPickingGame(true)}
              />
            </div>
          )}
          {gameChoices.length === 1 && (
            <p className="text-sm text-muted-foreground">
              Game:{" "}
              <span className="text-foreground">{gameChoices[0].name}</span>
            </p>
          )}
          {/* Reuse the same branding catalog art shown on game detail (issue
              #372), so the conquest setup feels like part of the game's world. */}
          {brandingEntry && <BrandingLinks entry={brandingEntry} />}
          {brandingEntry?.screenshots?.length ? (
            <BrandingScreenshots shots={brandingEntry.screenshots} />
          ) : null}
          {stylesBlock ? (
            <p className="text-sm text-muted-foreground">{stylesBlock}</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Map style</span>
                {factsLoading ? (
                  // Which styles this game offers is not known yet, and one shown
                  // now could be taken away when it is (issues #3616 and #3674).
                  <div
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                    role="status"
                  >
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Checking which maps this game carries…
                  </div>
                ) : (
                  <OptionSelect
                    value={style}
                    onValueChange={(style) =>
                      choose({ style: style as MapSkin })
                    }
                    options={MAP_STYLE_OPTIONS}
                  />
                )}
              </div>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Shape</span>
                <OptionSelect
                  value={layout}
                  onValueChange={(layout) => choose({ layout })}
                  options={layoutOptionsFor(style)}
                />
              </div>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  {realStars ? "Radius from Sol" : "Map size"}
                </span>
                {realStars ? (
                  <OptionSelect
                    value={radius}
                    onValueChange={(radius) => choose({ radius })}
                    options={RADIUS_OPTIONS}
                  />
                ) : (
                  <OptionSelect
                    value={String(nodeCount)}
                    onValueChange={(size) => choose({ size })}
                    options={sizeOptions(ceiling, noun.many)}
                  />
                )}
                {realStars && (
                  <span className="text-xs text-muted-foreground">
                    Every real system within the radius, at its true position.
                    You start at Sol, in the middle.
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Opposition</span>
                <OptionSelect
                  value={factions}
                  onValueChange={(factions) => choose({ factions })}
                  options={FACTION_OPTIONS}
                />
              </div>
              <ThreatLevelSelect
                value={threat}
                ceiling={ceiling}
                onChange={(threat) => choose({ threat })}
              />
              {!realStars && (
                <StartPositionSelect
                  value={startPosition ?? "edge"}
                  unlocked={startUnlocked}
                  onChange={(start) => choose({ start })}
                />
              )}
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Starting territory</span>
                <OptionSelect
                  value={starting}
                  onValueChange={(starting) => choose({ starting })}
                  options={startingOptions(noun, realStars)}
                />
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <label htmlFor="conquest-fog" className="flex flex-col gap-0.5">
                  <span className="font-medium">Fog of war</span>
                  <span className="text-xs text-muted-foreground">
                    Hide {noun.many} more than two{" "}
                    {style === "galaxy" ? "jumps" : "moves"} from your
                    territory.
                  </span>
                </label>
                <Switch
                  id="conquest-fog"
                  checked={fog}
                  onCheckedChange={(fog) => choose({ fog })}
                />
              </div>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Seed</span>
                <div className="flex gap-2">
                  <Input
                    value={seed}
                    onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    aria-label="Map seed"
                  />
                  <Button
                    variant="outline"
                    onClick={() =>
                      setSeed(String(Math.floor(Math.random() * 100000)))
                    }
                  >
                    <Dices className="size-4" aria-hidden />
                    <span className="sr-only">Reroll seed</span>
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  {realStars
                    ? "The stars never change. The seed sets the factions, where your enemies start, and which maps each system is fought on."
                    : "The same seed always builds the same map."}
                </span>
              </div>
              {!realStars && (preview || (land && canPreview)) && (
                <div className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Preview</span>
                  {preview ? (
                    <div className={previewStale ? "opacity-50" : undefined}>
                      <GalaxyPreview2D
                        galaxy={preview}
                        terrain={land ? landPreview?.terrain : undefined}
                      />
                    </div>
                  ) : null}
                  {land && (previewStale || !preview) && (
                    <span
                      className="text-xs text-muted-foreground"
                      role="status"
                    >
                      Building the preview…
                    </span>
                  )}
                  {preview &&
                    !previewStale &&
                    preview.nodes.length < nodeCount && (
                      <span className="text-xs text-muted-foreground">
                        Capped at {preview.nodes.length} named {noun.many}.
                      </span>
                    )}
                </div>
              )}
              {dependencyBlock && (
                <DependencyBlocked reason={dependencyBlock} />
              )}
              {aiNote && (
                <p className="text-sm text-muted-foreground">{aiNote}</p>
              )}
              {error && <ErrorBanner message={error} />}
              <Button
                onClick={create}
                disabled={busy || !selected || factsLoading || aiNote !== null}
              >
                {busy ? "Generating…" : "Create map"}
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Paste a challenge code, resolve it against the recipient's own install, and
 * generate the identical map locally (issue #376). `installedGame` is
 * resolved from the decoded settings, not from the wizard's own game picker,
 * because a challenge names its own game. Wraps the shared
 * `ImportChallengeForm` (issue #2441) with conquest's own decode and finish.
 * Warpath's counterpart is `ImportChallengeForm.tsx`.
 *
 * A game that is not installed is offered for download by the shared form's
 * content gate before `finish` runs (issues #387 and #3368). The gate fetches the
 * name `resolveGameDownload` gives it. The "not installed" error in `finish`
 * only fires if the gate was passed without the game arriving.
 */
function ImportChallengeForm({
  onImported,
  initialCode,
}: {
  onImported: (id: string) => void;
  /** A confirmed `coilbox://` import code to prefill and run once (issue #388). */
  initialCode?: string;
}) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const brandingEntries = useBrandingCatalog();
  const gameCatalog = useGameCatalog();
  const { eligible } = useMapEligibility();
  const { galaxies } = useGalaxies();
  const { file } = useConquestState();

  const {
    run: runScan,
    data: scanData,
    loading: scanLoading,
    error: scanError,
  } = scan;
  useEffect(() => {
    if (!scanData && !scanLoading && !scanError) runScan();
  }, [scanData, scanLoading, scanError, runScan]);

  const finish = async (settings: ConquestImportSettings) => {
    const matcher = getGameMatcher();
    const games = (scanData?.games ?? []).filter(
      (g) => !matcher || matcher(g.name),
    );
    // Names and branding only. Which game each battle launches is decided at
    // launch (`decideLaunchGame`), so an ambiguous code is not guessed here.
    const installedGame =
      resolveGameByShortname(settings.game, games) ??
      candidateGames(settings.game, games)[0];
    if (!installedGame) {
      if (scanError) {
        throw new Error(
          `The content scan failed, so installed games are not listed: ${scanError}`,
        );
      }
      throw new Error(
        `This challenge needs "${settings.game.shortname}", which isn't installed. Install it from Content → Games, then try again.`,
      );
    }

    const maps = eligible(scanData?.maps ?? []).map((m) => ({
      name: m.name,
      width: m.width,
      height: m.height,
    }));

    // A challenge on a hand-made map needs that map installed here, in the
    // version the challenge was made on. Nothing is generated in its place,
    // because that would be a different challenge under the same code.
    if (isHandmadeChallenge(settings)) {
      const checked = await loadChallengeMap(settings.map, installedGame.name);
      if (!checked.ok) throw new Error(checked.message);
      const { map } = checked;
      if (galaxies.some((g) => g.galaxy.id === map.id)) {
        throw new Error(
          `The hand-made map "${map.title}" has the id "${map.id}", which another map in your list already uses, so it cannot be opened. Delete that map on the Conquest page, then import this code again.`,
        );
      }
      if (file.conquests[map.id]) {
        throw new Error(
          `You already have a conquest on the hand-made map "${map.title}", and a map holds one conquest at a time. Abandon that conquest on the Conquest page, then import this code again.`,
        );
      }
      // The conquest starts on the map's own page, once the player has picked
      // a faction there. The seed only picks stand-ins here, for the count of
      // battle maps this install lacks.
      holdHandmadeChallenge(settings);
      const preview = handmadeConquestDoc(
        map,
        handmadeRun(
          map,
          {
            seed: 0,
            fogOfWar: settings.fogOfWar === true,
            threatLevel: settings.threatLevel ?? 0,
            named: settings.nodeMaps,
          },
          maps,
        ),
      );
      return { id: map.id, doc: preview };
    }

    const brandingEntry = resolveBranding(brandingEntries, installedGame);
    const names = mergeConquestNames(
      getProfile().conquest,
      brandingEntry?.conquest,
    );

    const id = `generated-${crypto.randomUUID()}`;
    const doc = galaxyFromChallenge(settings, { maps, names }, id);
    await conquestSave({
      id,
      json: JSON.stringify({ ...doc, importedChallenge: true }),
    });
    await refreshGalaxies();
    return { id, doc };
  };

  return (
    <SharedImportChallengeForm
      helpText="Paste a challenge code shared by another player to generate the identical map on your own install. A challenge made on a hand-made map needs that map installed here."
      substitutedNoun="locations"
      initialCode={initialCode}
      decode={decodeConquestImport}
      identityOf={conquestImportIdentity}
      buildRequirement={(settings) =>
        challengeGameRequirement(settings.game, gameCatalog)
      }
      finish={finish}
      countSubstitutedMaps={substitutedMapCount}
      onImported={onImported}
    />
  );
}
