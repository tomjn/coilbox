import { plural, select, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
  Astroid,
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
import { ConfirmPopover } from "@/components/ConfirmPopover";
import { ContinueBadge } from "@/components/ContinueBadge";
import { GameIcon } from "@/components/GameIcon";
import { OptionSelect } from "@/components/OptionSelect";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/i18n/uiError";
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
import type { LandPicture } from "../landJob";
import { generateMapOffThread, landPreviewOffThread } from "../landJobs";
import { generateMap, locationNounKey, MAP_STYLE_OPTIONS } from "../mapStyle";
import {
  type ConquestState,
  type GalaxyDoc,
  isLandSkin,
  type MapSkin,
} from "../model";
import { mergeConquestNames } from "../names";
import { isPlanetId, planetOf } from "../planets";
import {
  DEFAULT_RADIUS_LY,
  RADIUS_CHOICES,
  systemCountWithin,
} from "../realstars";
import { landLayoutsFor } from "../terrainGen";
import { generatedPlanet } from "../territories";
import { sizeOptions, startPositionUnlocked, unlockedLevel } from "../unlocks";
import { useConquestUnlocks } from "../useUnlocks";
import { GalaxyPreview2D } from "./components/GalaxyPreview2D";
import { MapErrorList } from "./components/MapErrorList";
import { PlanetSwatch } from "./components/PlanetSwatch";
import { PLANET_OPTIONS } from "./components/planetOptions";
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
  const { t } = useLingui();
  const [abandonError, setAbandonError] = useState<string | null>(null);
  const abandon = async (galaxyId: string) => {
    setAbandonError(null);
    try {
      await saveFor(galaxyId, undefined);
    } catch (e) {
      const reason = describeError(e);
      setAbandonError(t`The conquest was not abandoned. ${reason}`);
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
  const handmadeError = handmade.error;
  const archiveError = handmade.archiveError;
  const [mapError, setMapError] = useState<string | null>(null);
  const removeMap = async (map: HandmadeMapSummary) => {
    setMapError(null);
    try {
      await removeHandmadeMap(map.id);
      await refreshHandmadeMaps();
    } catch (e) {
      const title = map.title;
      const reason = describeError(e);
      setMapError(t`"${title}" was not removed. ${reason}`);
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
      title: t`Generate a map`,
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
      title: t`Import challenge`,
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
      title: t`Import map`,
      multiple: false,
      filters: [{ name: t`Hand-made map`, extensions: ["zip"] }],
    });
    if (typeof zipPath !== "string") return;
    drawer.open({
      title: t`Import map`,
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
        title={t`Conquest`}
        description={t`Wage a campaign across a map of territory you take one battle at a time. Win skirmishes to capture territory, defend against counterattacks, and take every enemy capital.`}
        actions={
          !needsGame && (
            <>
              <Button variant="outline" onClick={importMap}>
                <MapPlus className="mr-1.5 size-4" aria-hidden />{" "}
                <Trans>Import map</Trans>
              </Button>
              <Button variant="outline" onClick={() => openImportChallenge()}>
                <Download className="mr-1.5 size-4" aria-hidden />{" "}
                <Trans>Import challenge</Trans>
              </Button>
              <Button onClick={() => openGenerate()}>
                <Dices className="mr-1.5 size-4" aria-hidden />{" "}
                <Trans>Generate a map</Trans>
              </Button>
            </>
          )
        }
      />

      {error && <ErrorBanner message={error} />}
      {stateError && (
        <ErrorBanner
          message={t`Your conquest progress could not be read. Nothing has been changed. ${stateError}`}
        />
      )}
      {abandonError && <ErrorBanner message={abandonError} />}
      {handmade.error && (
        <ErrorBanner
          message={t`The hand-made maps could not be listed. ${handmadeError}`}
        />
      )}
      {handmade.archiveError && (
        <ErrorBanner
          message={t`The installed games could not be searched for maps they carry, so none is listed. ${archiveError}`}
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
                  ? t`This engine could not read your games`
                  : target
                    ? t`Conquest needs a game installed`
                    : t`Conquest needs an engine and a game`}
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                {state === "unreadable"
                  ? t`The scan finished but the engine reported problems and listed no games, so this is not a sign that you own none. Try another engine, or open Content > Games to see what it did find.`
                  : target
                    ? t`Conquest generates a map for any installed game with skirmish AIs. Download a game to get started, and it will appear here automatically.`
                    : t`Install an engine and at least one game, then return here to generate a map for it.`}
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
                    ? t`Pick another engine`
                    : t`Install an engine`}
                </Link>
              )}
              {state === "unreadable" ? (
                <Link
                  to="/library/games"
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  <Trans>Open Content &gt; Games</Trans>
                </Link>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => navigate("/library/games")}
                >
                  <Trans>Browse games to download</Trans>
                </Button>
              )}
            </div>
          </div>
          {state === "unreadable" && scanFailure && (
            <ScanFailed noun={t`games`} reason={scanFailure} />
          )}
          {state === "unreadable" && <Diagnostics errors={scanErrors} />}
        </div>
      ) : loading || handmade.savedLoading || state === "finding-engine" ? (
        <SkeletonList />
      ) : nothingListed && handmade.loading ? (
        <SearchingGames />
      ) : nothingListed ? (
        <EmptyState
          label={t`No conquest maps yet. Generate one for any installed game, or import a map or a challenge.`}
        />
      ) : (
        <>
          {runIds.length + lostRuns.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                <Trans>In progress</Trans>
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
                <Trans>Ready to start</Trans>
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
                <Trans>Maps that could not be listed</Trans>
              </h2>
              <ul className="flex flex-col gap-2">
                {handmade.unreadable.map((u) => (
                  <li key={`${u.source}/${u.carriedBy ?? ""}/${u.folder}`}>
                    <Card className="gap-2 rounded-lg border-border/50 p-3 shadow-none">
                      <span className="text-sm font-medium">
                        {unreadableMapTitle(u)}
                      </span>
                      <MapErrorList errors={u.errors} />
                    </Card>
                  </li>
                ))}
                {hiddenMaps.map((m) => {
                  const mapId = m.id;
                  return (
                    <li key={m.id}>
                      <Card className="gap-2 rounded-lg border-border/50 p-3 shadow-none">
                        <span className="text-sm font-medium">{m.title}</span>
                        <p className="text-sm text-muted-foreground">
                          <Trans>
                            This map has the id "{mapId}", which a map in the
                            list above already uses, so the map is not listed.
                            Change the id in its map.json and import it again.
                          </Trans>
                        </p>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {handmade.loading && <SearchingGames />}
        </>
      )}
    </div>
  );
}

/** How an unreadable map folder is named above the reasons it was refused. */
function unreadableMapTitle(u: {
  source: string;
  folder: string;
  carriedBy?: string;
}): string {
  const folder = u.folder;
  if (u.source === "game") {
    const mapsDir = ARCHIVE_MAPS_DIR;
    const game = u.carriedBy ?? "";
    return t`"${mapsDir}/${folder}" in ${game}`;
  }
  return u.source === "bundled"
    ? t`Bundled map folder "${folder}"`
    : t`Map folder "${folder}"`;
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
      <Trans>Searching your installed games for maps they carry.</Trans>
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

/** How many locations a map has, in the words its style uses for them. */
function locationCount(style: string, count: number): string {
  return select(style, {
    galaxy: plural(count, { one: "# system", other: "# systems" }),
    theatre: plural(count, { one: "# location", other: "# locations" }),
    cities: plural(count, { one: "# city", other: "# cities" }),
    territories: plural(count, { one: "# province", other: "# provinces" }),
    other: plural(count, { one: "# location", other: "# locations" }),
  });
}

/** Said under the preview when the map has fewer locations than were asked for. */
function cappedMessage(style: string, count: number): string {
  return select(style, {
    galaxy: plural(count, {
      one: "Capped at # named system.",
      other: "Capped at # named systems.",
    }),
    theatre: plural(count, {
      one: "Capped at # named location.",
      other: "Capped at # named locations.",
    }),
    cities: plural(count, {
      one: "Capped at # named city.",
      other: "Capped at # named cities.",
    }),
    territories: plural(count, {
      one: "Capped at # named province.",
      other: "Capped at # named provinces.",
    }),
    other: plural(count, {
      one: "Capped at # named location.",
      other: "Capped at # named locations.",
    }),
  });
}

/** What a conquest's card says about how it stands. */
function statusLabelFor(
  state: ConquestState | undefined,
  percent: number,
): string {
  if (state?.status === "won") return t`Victory`;
  if (state?.status === "lost") return t`Defeat`;
  if (!state) return t`Not started`;
  const turn = state.turn;
  return t`Turn ${turn} · ${percent}% held`;
}

/** The warning on abandoning a conquest, with how far it got in the sentence. */
function abandonDescription(state: ConquestState, percent: number): string {
  if (state.status === "won") {
    return t`This deletes the conquest for good, including its progress (Victory). The map stays in your list. It cannot be undone.`;
  }
  if (state.status === "lost") {
    return t`This deletes the conquest for good, including its progress (Defeat). The map stays in your list. It cannot be undone.`;
  }
  const turn = state.turn;
  return t`This deletes the conquest for good, including its progress (Turn ${turn} · ${percent}% held). The map stays in your list. It cannot be undone.`;
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
  onAbandon?: () => void | Promise<void>;
  /** Present for an imported map with no conquest on it. */
  onRemove?: () => void | Promise<void>;
}) {
  const { t } = useLingui();
  const drawer = useDrawer();
  const openShareChallenge = (conquest: ConquestState) =>
    drawer.open({
      title: t`Share challenge`,
      width: "26rem",
      content: <HandmadeChallengeShare map={map} state={conquest} />,
    });
  const percent = state ? heldPercent(state) : 0;
  const statusLabel = statusLabelFor(state, percent);
  const mapTitle = map.title;
  const carriedBy = map.carriedBy;
  const shortname = map.game.shortname;
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
                <Trans>Bundled</Trans>
              </span>
            )}
            {map.source === "game" && (
              <span
                className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                title={t`The game ${carriedBy} carries this map`}
              >
                <Trans>From the game</Trans>
              </span>
            )}
            {resume && <ContinueBadge />}
          </div>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {t`${shortname} · Hand-made map`}
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
          aria-label={t`Share ${mapTitle} as a challenge code`}
          title={t`Share challenge`}
          onClick={() => openShareChallenge(state)}
        >
          <Share2 className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      )}
      {state && onAbandon ? (
        <ConfirmPopover
          triggerProps={{
            variant: "ghost",
            size: "icon",
            "aria-label": t`Abandon ${mapTitle}`,
            title: t`Abandon this campaign`,
          }}
          heading={t`Abandon the conquest on ${mapTitle}?`}
          description={abandonDescription(state, percent)}
          confirmLabel={t`Abandon conquest`}
          busyLabel={t`Abandoning…`}
          onConfirm={onAbandon}
        >
          <Trash2 className="size-4 text-muted-foreground" aria-hidden />
        </ConfirmPopover>
      ) : (
        onRemove && (
          <ConfirmPopover
            triggerProps={{
              variant: "ghost",
              size: "icon",
              "aria-label": t`Remove ${mapTitle}`,
              title: t`Remove this map`,
            }}
            heading={t`Remove ${mapTitle}?`}
            description={t`This deletes the imported map from your computer. To play it again you would have to import it again. It cannot be undone.`}
            confirmLabel={t`Remove map`}
            busyLabel={t`Removing…`}
            onConfirm={onRemove}
          >
            <Trash2 className="size-4 text-muted-foreground" aria-hidden />
          </ConfirmPopover>
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
  const { t } = useLingui();
  const { loading, result, failure } = useHandmadeMap(map.id);
  if (loading) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        <Trans>Reading the map…</Trans>
      </p>
    );
  }
  const run = readHandmadeRun(state);
  const mapTitle = map.title;
  if (!result?.ok || !run) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <ErrorBanner
          message={`${t`No challenge code can be made, because the map "${mapTitle}" could not be read.`}${failure ? ` ${failure}` : ""}`}
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
      title: t`Export challenge`,
      defaultPath: `${galaxy.title || "challenge"}.json`,
      filters: [{ name: t`Coilbox challenge`, extensions: ["json"] }],
    });
    if (!dest) return;
    await challengeExport({ text: fileText, dest });
  };
  return (
    <ChallengeShare
      identity={galaxyIdentity(galaxy)}
      code={encodeHandmadeChallenge(galaxy) ?? ""}
      title={galaxy.title}
      helpText={t`Anyone who pastes this code into Import challenge plays this map with the same settings, so results are directly comparable. They need the same game and the same version of this map installed. The code does not carry the map.`}
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
  onAbandon: () => void | Promise<void>;
}) {
  const { t } = useLingui();
  const turn = state.turn;
  const game = carriedBy;
  return (
    <Card className="flex-row items-center gap-3 rounded-lg border-border/50 p-3 shadow-none">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
        <MapIcon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{title}</span>
        <p className="text-xs text-muted-foreground">
          {carriedBy
            ? t`The game ${game} no longer carries the map this conquest is played on. A game update may have removed it. Your progress is saved (turn ${turn}), and it carries on if a game carries the map again.`
            : t`The map this conquest is played on is no longer installed. Your progress is saved (turn ${turn}). Import the map again to carry on.`}
        </p>
      </div>
      <ConfirmPopover
        triggerProps={{
          variant: "ghost",
          size: "icon",
          "aria-label": t`Abandon ${title}`,
          title: t`Abandon this campaign`,
        }}
        heading={t`Abandon the conquest on ${title}?`}
        description={t`This deletes the conquest for good, including its progress (turn ${turn}). It cannot be undone, and it cannot carry on if the map comes back.`}
        confirmLabel={t`Abandon conquest`}
        busyLabel={t`Abandoning…`}
        onConfirm={onAbandon}
      >
        <Trash2 className="size-4 text-muted-foreground" aria-hidden />
      </ConfirmPopover>
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
  const { t } = useLingui();
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
  const importedTitle = result?.status === "imported" ? result.doc.title : "";
  const skipped = result?.status === "imported" ? result.skipped : 0;
  const existingTitle = result?.status === "exists" ? result.title : "";
  const refusal = result?.status === "refused" ? result.message : "";
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run(false);
  }, [run]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {result === null && (
        <p className="text-sm text-muted-foreground">
          <Trans>Importing the map…</Trans>
        </p>
      )}
      {result?.status === "imported" && (
        <>
          <p className="text-sm">
            <Trans>
              "{importedTitle}" is imported and listed on the Conquest page.
            </Trans>
          </p>
          {result.skipped > 0 && (
            <p className="text-sm text-muted-foreground">
              {plural(skipped, {
                one: "# file in the zip was left out, because a map does not use it.",
                other:
                  "# files in the zip were left out, because a map does not use them.",
              })}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={() => onOpenMap(result.id)}>
              <Trans>Open the map</Trans>
            </Button>
            <Button variant="outline" onClick={onClose}>
              <Trans>Done</Trans>
            </Button>
          </div>
        </>
      )}
      {result?.status === "exists" && (
        <>
          <p className="text-sm">
            <Trans>
              A map called "{existingTitle}" is already installed. Replace it
              with the one in this zip?
            </Trans>
          </p>
          <p className="text-sm text-muted-foreground">
            <Trans>
              A conquest in progress on it is kept and carries on with the new
              map.
            </Trans>
          </p>
          <div className="flex gap-2">
            <Button onClick={() => run(true)}>
              <Trans>Replace the map</Trans>
            </Button>
            <Button variant="outline" onClick={onClose}>
              <Trans>Keep the installed map</Trans>
            </Button>
          </div>
        </>
      )}
      {result?.status === "invalid" && (
        <>
          <p className="text-sm">
            <Trans>
              The map was not imported. Fix the following in the map folder, zip
              it again and import the new zip.
            </Trans>
          </p>
          <MapErrorList errors={result.errors} />
        </>
      )}
      {result?.status === "refused" && (
        <ErrorBanner message={t`The map was not imported. ${refusal}`} />
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
  onAbandon?: () => void | Promise<void>;
}) {
  const { t } = useLingui();
  const { refresh } = useGalaxies();
  const drawer = useDrawer();
  // Only a procedurally generated galaxy carries the seed a challenge code
  // needs (issue #376), so nothing to share for an authored/bundled one.
  const challengeCode = encodeConquestChallenge(galaxy);
  const exportChallengeFile = async () => {
    const fileText = encodeConquestChallengeFile(galaxy);
    if (!fileText) return;
    const dest = await save({
      title: t`Export challenge`,
      defaultPath: `${galaxy.title || "challenge"}.json`,
      filters: [{ name: t`Coilbox challenge`, extensions: ["json"] }],
    });
    if (!dest) return;
    await challengeExport({ text: fileText, dest });
  };
  const openShareChallenge = () =>
    drawer.open({
      title: t`Share challenge`,
      width: "26rem",
      content: (
        <ChallengeShare
          identity={galaxyIdentity(galaxy)}
          code={challengeCode ?? ""}
          title={galaxy.title}
          helpText={t`Anyone who pastes this code into Import challenge (needs the same game installed) plays the identical map, so results are directly comparable.`}
          onExportFile={exportChallengeFile}
        />
      ),
    });
  // The installed game this map is for, so the card shows that game's icon.
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const installedGame = resolveGameByShortname(
    galaxy.game,
    scan.data?.games ?? [],
  );
  const percent = state ? territoryPercent(galaxy, state) : 0;
  const statusLabel = statusLabelFor(state, percent);
  const galaxyTitle = galaxy.title;
  // Set for a generated Cities or Territories map, which is the only kind
  // built on a planet.
  const planet = generatedPlanet(galaxy);
  const factionCount = galaxy.factions.length;
  const galaxyCounts = [
    galaxy.game.shortname,
    locationCount(galaxy.theme?.skin ?? "galaxy", galaxy.nodes.length),
    plural(factionCount, { one: "# faction", other: "# factions" }),
    ...(planet ? [planetOf(planet).label] : []),
  ].join(" · ");

  return (
    <Card className="flex-row items-center gap-3 rounded-lg border-border/50 p-3 shadow-none transition-colors hover:border-border hover:bg-accent/50">
      <Link
        to={`/conquest/${encodeURIComponent(galaxy.id)}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <GameIcon
          name={
            galaxy.game.pinnedName ??
            installedGame?.name ??
            galaxy.game.shortname
          }
          size={40}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{galaxy.title}</span>
            {bundled && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                <Trans>Bundled</Trans>
              </span>
            )}
            {galaxy.importedChallenge && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                <Trans>Imported challenge</Trans>
              </span>
            )}
            {resume && <ContinueBadge />}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{galaxyCounts}</span>
            {planet ? (
              <PlanetSwatch planet={planet} />
            ) : (
              <Astroid
                className="size-4 shrink-0"
                fill="currentColor"
                aria-hidden
              />
            )}
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
          aria-label={t`Share ${galaxyTitle} as a challenge code`}
          title={t`Share challenge`}
          onClick={openShareChallenge}
        >
          <Share2 className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      )}
      {state && onAbandon ? (
        <ConfirmPopover
          triggerProps={{
            variant: "ghost",
            size: "icon",
            "aria-label": t`Abandon ${galaxyTitle}`,
            title: t`Abandon this campaign`,
          }}
          heading={t`Abandon the conquest on ${galaxyTitle}?`}
          description={abandonDescription(state, percent)}
          confirmLabel={t`Abandon conquest`}
          busyLabel={t`Abandoning…`}
          onConfirm={onAbandon}
        >
          <Trash2 className="size-4 text-muted-foreground" aria-hidden />
        </ConfirmPopover>
      ) : (
        !bundled &&
        !state && (
          <ConfirmPopover
            triggerProps={{
              variant: "ghost",
              size: "icon",
              "aria-label": t`Delete ${galaxyTitle}`,
            }}
            heading={t`Delete ${galaxyTitle}?`}
            description={t`This deletes the map from your computer. It cannot be undone.`}
            confirmLabel={t`Delete map`}
            busyLabel={t`Deleting…`}
            onConfirm={async () => {
              await conquestDelete({ id: galaxy.id });
              await refreshGalaxies();
              refresh();
            }}
          >
            <Trash2 className="size-4 text-muted-foreground" aria-hidden />
          </ConfirmPopover>
        )
      )}
    </Card>
  );
}

/** An option whose label is read when the picker draws, so it follows the
 * language. */
const option = (value: string, label: () => string) => ({
  value,
  get label() {
    return label();
  },
});
const FACTION_OPTIONS = [
  option("1", () => t`One enemy faction`),
  option("2", () => t`Two enemy factions`),
  option("3", () => t`Three enemy factions`),
];
const LAYOUT_OPTIONS = [
  option("random", () => t`Surprise me`),
  option("scatter", () => t`Scattered disc`),
  option("spiral", () => t`Spiral arms`),
  option("clusters", () => t`Clusters`),
  option("ring", () => t`Ring`),
  option("realstars", () => t`Real stars (the solar neighbourhood)`),
];
// Real stars are a galaxy and nothing else, and a disc and arms are a galaxy's
// words, so every other style gets the same shapes under plainer names.
const PLAIN_LAYOUT_OPTIONS = [
  option("random", () => t`Surprise me`),
  option("scatter", () => t`Scattered`),
  option("spiral", () => t`Spiral`),
  option("clusters", () => t`Clusters`),
  option("ring", () => t`Ring`),
];
// The land styles describe the land rather than how points are scattered.
const LAND_LAYOUT_OPTIONS = [
  option("random", () => t`Surprise me`),
  option("continent", () => t`One continent`),
  option("coast", () => t`Coast`),
  option("continents", () => t`Two continents`),
  option("archipelago", () => t`Archipelago`),
  option("inlandsea", () => t`Inland sea`),
  option("landlocked", () => t`Landlocked`),
];
/** The shapes a style offers. A land style on a planet whose sea cannot be
 * crossed offers only the single-mass shapes. */
const layoutOptionsFor = (style: MapSkin, planet: string) => {
  if (style === "galaxy") return LAYOUT_OPTIONS;
  if (!isLandSkin(style)) return PLAIN_LAYOUT_OPTIONS;
  if (!isPlanetId(planet)) return LAND_LAYOUT_OPTIONS;
  const offered: readonly string[] = landLayoutsFor(planet);
  return LAND_LAYOUT_OPTIONS.filter(
    (o) => o.value === "random" || offered.includes(o.value),
  );
};
/** How long the form waits after the last change before it builds a land
 * preview. A choice, not a measurement: long enough that typing a seed builds
 * one map and not one per digit. */
const LAND_PREVIEW_DELAY_MS = 300;
// Real-star galaxies are sized by radius, not by node count: every system
// inside the radius is on the map. Counts come from the catalogue so they
// cannot drift from the data.
const RADIUS_OPTIONS = RADIUS_CHOICES.map((ly) =>
  option(String(ly), () => {
    const count = systemCountWithin(ly);
    return t`${ly} light years (${plural(count, { one: "# system", other: "# systems" })})`;
  }),
);
/** Sentinel for "let the generator decide" (the classic full-frontier start for
 * procedural maps, capital-only for real stars). An empty string cannot be
 * used: Radix Select reads it as no selection and falls back to the
 * placeholder, leaving the row looking blank. */
const STARTING_DEFAULT = "auto";
/** The starting territory choices, counted in the style's own locations. */
function startingOptions(style: MapSkin, realStars: boolean) {
  return [
    option(STARTING_DEFAULT, () =>
      realStars ? t`Capital only (default)` : t`Full frontier (default)`,
    ),
    option("1", () => t`Capital only`),
    option("2", () =>
      select(style, {
        galaxy: "Capital + 1 system",
        theatre: "Capital + 1 location",
        cities: "Capital + 1 city",
        territories: "Capital + 1 province",
        other: "Capital + 1 location",
      }),
    ),
    option("3", () =>
      select(style, {
        galaxy: "Capital + 2 systems",
        theatre: "Capital + 2 locations",
        cities: "Capital + 2 cities",
        territories: "Capital + 2 provinces",
        other: "Capital + 2 locations",
      }),
    ),
    option("4", () =>
      select(style, {
        galaxy: "Capital + 3 systems",
        theatre: "Capital + 3 locations",
        cities: "Capital + 3 cities",
        territories: "Capital + 3 provinces",
        other: "Capital + 3 locations",
      }),
    ),
  ];
}

/** A land preview, and the options it was built from, as text. */
interface KeyedLandPreview {
  key: string;
  /** Null when these options could not be built into a map. */
  doc: GalaxyDoc | null;
  picture: LandPicture | null;
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
  const { t } = useLingui();
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
  const planet = offeredOr(choices.planet, PLANET_OPTIONS, "random");
  const layout = offeredOr(
    choices.layout,
    layoutOptionsFor(style, planet),
    "random",
  );
  const radius = offeredOr(
    choices.radius,
    RADIUS_OPTIONS,
    String(DEFAULT_RADIUS_LY),
  );
  const realStars = layout === "realstars";
  const land = isLandSkin(style);
  const locationKey = locationNounKey(style);
  const starting = offeredOr(
    choices.starting,
    startingOptions(style, realStars),
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
  const size = offeredOr(choices.size, sizeOptions(ceiling, locationKey), "18");
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
      ...(land ? { planet: planet as GenerateOptions["planet"] } : {}),
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
      land,
      planet,
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
  // Land is slower to build, so it is built off the main thread once the form
  // has been still for a moment. The last preview stays up, dimmed, until the
  // new one replaces it.
  // Keyed on the options as text, so a preview is rebuilt when a value
  // changes and never because an equal object was made again.
  const [landPreview, setLandPreview] = useState<KeyedLandPreview | null>(null);
  const landKey = useMemo(
    () => (land && canPreview ? JSON.stringify(genOptions("preview")) : null),
    [genOptions, land, canPreview],
  );
  useEffect(() => {
    if (landKey === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      landPreviewOffThread(JSON.parse(landKey) as GenerateOptions).then(
        (built) => {
          if (!cancelled) setLandPreview({ key: landKey, ...built });
        },
        () => {
          if (!cancelled) {
            setLandPreview({ key: landKey, doc: null, picture: null });
          }
        },
      );
    }, LAND_PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [landKey]);
  const preview = land ? (landPreview?.doc ?? null) : pointPreview;
  const previewStale = land && landPreview?.key !== landKey;
  const previewFailed = land && !previewStale && landPreview?.doc === null;
  // Not knowing yet is not the same as having none: while the installed engines
  // are being read, the form waits rather than telling the player to install one.
  const reason = scan.error;
  const onlyGameName = gameChoices[0]?.name;
  const blocked: ReactNode =
    !target && targetLoading ? (
      t`Looking for an engine…`
    ) : !target ? (
      <Trans>
        Install an engine first (
        <Link className="underline underline-offset-4" to="/settings/engines">
          Settings → Engines
        </Link>
        ).
      </Trans>
    ) : scan.error ? (
      t`The content scan failed, so installed games are not listed: ${reason}`
    ) : scan.data &&
      (scan.data.games.length === 0 || gameChoices.length === 0) ? (
      <Trans>
        Install a game first (
        <Link className="underline underline-offset-4" to="/library/games">
          Content → Games
        </Link>
        ).
      </Trans>
    ) : maps.length === 0 && scan.data ? (
      <Trans>
        Install at least one map first (
        <Link className="underline underline-offset-4" to="/library/maps">
          Content → Maps
        </Link>
        ).
      </Trans>
    ) : null;

  // Said under the picker, which stays usable so another game can be chosen.
  const selectedName = selected?.name;
  const stylesBlock = hidesStyles
    ? t`${selectedName} plays Conquest only on the maps the game carries. Pick one from the Conquest list.`
    : null;
  // The opponents are fought with the game's skirmish AIs, so a map cannot be
  // made until the list is in, but the rest of the form can be filled in.
  const aiNote =
    !selected || stylesBlock
      ? null
      : aisFailed
        ? t`The skirmish AIs for this game could not be listed.`
        : !aisLoaded
          ? t`Loading this game's skirmish AIs.`
          : ais.length === 0
            ? t`This game has no skirmish AIs to fight against.`
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
      const doc = await generateMapOffThread(genOptions(id));
      await conquestSave({ id, json: JSON.stringify(doc) });
      // A game reached from game detail is remembered too, not only one picked
      // in the select.
      setLastGame(gameChoiceKey(selected));
      setRemembered({
        style,
        layout,
        planet,
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
      setError(describeError(e));
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
          backLabel={t`Back to the map form`}
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
              <span className="font-medium">
                <Trans>Game</Trans>
              </span>
              <GamePickerButton
                value={selected?.name ?? ""}
                games={gameChoices}
                headers={gameHeaders}
                placeholder={scan.loading ? t`Scanning…` : t`Select a game`}
                onClick={() => setPickingGame(true)}
              />
            </div>
          )}
          {gameChoices.length === 1 && (
            <p className="text-sm text-muted-foreground">
              <Trans>
                Game: <span className="text-foreground">{onlyGameName}</span>
              </Trans>
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
                <span className="font-medium">
                  <Trans>Map style</Trans>
                </span>
                {factsLoading ? (
                  // Which styles this game offers is not known yet, and one shown
                  // now could be taken away when it is (issues #3616 and #3674).
                  <div
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                    role="status"
                  >
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    <Trans>Checking which maps this game carries…</Trans>
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
              {land && (
                <div className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">
                    <Trans>Planet</Trans>
                  </span>
                  <OptionSelect
                    value={planet}
                    onValueChange={(planet) => choose({ planet })}
                    options={PLANET_OPTIONS}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  <Trans>Shape</Trans>
                </span>
                <OptionSelect
                  value={layout}
                  onValueChange={(layout) => choose({ layout })}
                  options={layoutOptionsFor(style, planet)}
                />
              </div>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  {realStars ? t`Radius from Sol` : t`Map size`}
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
                    options={sizeOptions(ceiling, locationKey)}
                  />
                )}
                {realStars && (
                  <span className="text-xs text-muted-foreground">
                    <Trans>
                      Every real system within the radius, at its true position.
                      You start at Sol, in the middle.
                    </Trans>
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  <Trans>Opposition</Trans>
                </span>
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
                <span className="font-medium">
                  <Trans>Starting territory</Trans>
                </span>
                <OptionSelect
                  value={starting}
                  onValueChange={(starting) => choose({ starting })}
                  options={startingOptions(style, realStars)}
                />
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <label htmlFor="conquest-fog" className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    <Trans>Fog of war</Trans>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {select(style, {
                      galaxy:
                        "Hide systems more than two jumps from your territory.",
                      theatre:
                        "Hide locations more than two moves from your territory.",
                      cities:
                        "Hide cities more than two moves from your territory.",
                      territories:
                        "Hide provinces more than two moves from your territory.",
                      other:
                        "Hide locations more than two moves from your territory.",
                    })}
                  </span>
                </label>
                <Switch
                  id="conquest-fog"
                  checked={fog}
                  onCheckedChange={(fog) => choose({ fog })}
                />
              </div>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  <Trans>Seed</Trans>
                </span>
                <div className="flex gap-2">
                  <Input
                    value={seed}
                    onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    aria-label={t`Map seed`}
                  />
                  <Button
                    variant="outline"
                    onClick={() =>
                      setSeed(String(Math.floor(Math.random() * 100000)))
                    }
                  >
                    <Dices className="size-4" aria-hidden />
                    <span className="sr-only">
                      <Trans>Reroll seed</Trans>
                    </span>
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  {realStars
                    ? t`The stars never change. The seed sets the factions, where your enemies start, and which maps each system is fought on.`
                    : t`The same seed always builds the same map.`}
                </span>
              </div>
              {!realStars && (preview || (land && canPreview)) && (
                <div className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">
                    <Trans>Preview</Trans>
                  </span>
                  {preview ? (
                    <div className={previewStale ? "opacity-50" : undefined}>
                      <GalaxyPreview2D
                        galaxy={preview}
                        picture={land ? landPreview?.picture : undefined}
                      />
                    </div>
                  ) : null}
                  {previewFailed ? (
                    <span className="text-xs text-muted-foreground">
                      <Trans>
                        These choices could not be built into a map. Try another
                        seed.
                      </Trans>
                    </span>
                  ) : (
                    land &&
                    (previewStale || !preview) && (
                      <span
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                        role="status"
                      >
                        <Loader2
                          className="size-3.5 motion-safe:animate-spin"
                          aria-hidden
                        />
                        <Trans>Building the preview…</Trans>
                      </span>
                    )
                  )}
                  {preview &&
                    !previewStale &&
                    preview.nodes.length < nodeCount && (
                      <span className="text-xs text-muted-foreground">
                        {cappedMessage(style, preview.nodes.length)}
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
                {busy && (
                  <Loader2
                    className="mr-1.5 size-4 motion-safe:animate-spin"
                    aria-hidden
                  />
                )}
                {busy ? t`Generating…` : t`Create map`}
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
  const { t } = useLingui();
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
        const reason = scanError;
        throw new Error(
          t`The content scan failed, so installed games are not listed: ${reason}`,
        );
      }
      const shortname = settings.game.shortname;
      throw new Error(
        t`This challenge needs "${shortname}", which isn't installed. Install it from Content → Games, then try again.`,
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
      const mapTitle = map.title;
      const mapId = map.id;
      if (galaxies.some((g) => g.galaxy.id === map.id)) {
        throw new Error(
          t`The hand-made map "${mapTitle}" has the id "${mapId}", which another map in your list already uses, so it cannot be opened. Delete that map on the Conquest page, then import this code again.`,
        );
      }
      if (file.conquests[map.id]) {
        throw new Error(
          t`You already have a conquest on the hand-made map "${mapTitle}", and a map holds one conquest at a time. Abandon that conquest on the Conquest page, then import this code again.`,
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
      helpText={t`Paste a challenge code shared by another player to generate the identical map on your own install. A challenge made on a hand-made map needs that map installed here.`}
      substitutedNoun={t`locations`}
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
