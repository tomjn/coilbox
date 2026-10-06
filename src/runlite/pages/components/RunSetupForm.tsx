import { Button, useSetting } from "@picoframe/frame";
import { Loader2, Swords } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FactionLogo } from "@/factions/FactionLogo";
import { useFactionLogos } from "@/factions/logos";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import {
  hidesGeneratedStyles,
  profileOnlyOwnMaps,
} from "../../../conquest/handmade/ownMapsOnly";
import { useGameMapFacts } from "../../../conquest/handmade/useHandmadeMaps";
import { locationNoun, MAP_STYLE_OPTIONS } from "../../../conquest/mapStyle";
import { resolveBranding, useBrandingCatalog } from "../../../content/branding";
import {
  useUnitsyncGameHeaders,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "../../../content/config";
import { dependencyBlockReason } from "../../../content/gameDependencies";
import { useMapEligibility } from "../../../content/mapEligibility";
import { BrandingLinks } from "../../../content/pages/components/BrandingLinks";
import { BrandingScreenshots } from "../../../content/pages/components/BrandingScreenshots";
import {
  DependencyBlocked,
  ErrorBanner,
} from "../../../content/pages/components/states";
import { usePreferredTarget, useSkirmishAis } from "../../../play/config";
import { aiForDifficulty, mergeGameAi } from "../../../play/gameAi";
import { resolveGameByShortname } from "../../../play/installedGames";
import { missingLaunchDependency } from "../../../play/launchContent";
import { GameSelectCard } from "../../../play/pages/components/GameSelectCard";
import { aiKey } from "../../../play/participants";
import { getGameMatcher, getProfile } from "../../../profile/profile";
import type { GenBuildGraph, GenerateRunOpts, GenRunMap } from "../../generate";
import { loadHandmadeRunMap } from "../../handmadeMap";
import {
  generateMapRun,
  generateStyledRun,
  LAND_RUN_SIZES,
} from "../../mapRun";
import { loadoutById, unlockedLoadouts, unlocksFor } from "../../meta";
import type { RunLength, RunSkin } from "../../model";
import { useRunMeta, useRuns } from "../../runs";
import {
  readSetupChoices,
  SETUP_CHOICES_KEY,
  type SetupChoices,
} from "../../setupChoices";
import {
  buildGraphFor,
  setupLimitNote,
  setupLimitWarning,
} from "../../unitLimit";

/**
 * The run-setup form, shown in a drawer (see RunListPage). Assembles a
 * {@link GenerateRunOpts} from the installed game's maps, sides and build graph,
 * bakes a self-contained run and saves it, then calls `onStarted`. A Cities or
 * Territories run also generates the land map it crosses.
 */
/**
 * The game the player last picked or started a run in, by its unitsync name. A
 * frame setting like the host form's, so it is kept with the rest of the app's
 * settings. Conquest keeps its own (`conquest.generate.lastGame`).
 */
const LAST_GAME_KEY = "warpath.setup.lastGame";

/** Marks a map style value that names a hand-made map by its id. */
const HANDMADE_PREFIX = "handmade:";

export function RunSetupForm({
  onStarted,
  initialGameName,
}: {
  onStarted: (id: string) => void;
  /**
   * Preselect this game (its unitsync name) from game detail's "Start a
   * warpath run" action (issue #372). Falls back to the last-picked/first
   * game when the name doesn't match any available game, e.g. it's since
   * been removed.
   */
  initialGameName?: string;
}) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { saveRun } = useRuns();
  const { meta, loading: metaLoading, error: metaError } = useRunMeta();

  // In a distribution profile filtered to a game, only that game is offered.
  const matcher = getGameMatcher();
  const scanned = scan.data?.games;
  const games = useMemo(() => {
    // Coilbox's own generated games go first: a warpath run in one is never
    // what a player meant, unless the caller asked for that one by name.
    const all = withoutGeneratedGames(scanned ?? [], initialGameName);
    return matcher ? all.filter((g) => matcher(g.name)) : all;
  }, [scanned, matcher, initialGameName]);
  // A profile pinned to a single game hides the picker entirely.
  const forcedSingleGame = !!matcher && games.length === 1;
  const maps = scan.data?.maps ?? [];

  const [gameName, setGameName] = useState("");
  const [lastGame, setLastGame] = useSetting(LAST_GAME_KEY, "");
  const selectGame = (name: string) => {
    setGameName(name);
    setLastGame(name);
  };
  // What the form remembers from the last run started. What the player changes
  // in this session is in `picked`, because the stored setting only reaches the
  // form again the next time it opens.
  const [remembered, setRemembered] = useSetting<unknown>(
    SETUP_CHOICES_KEY,
    {},
  );
  const saved = readSetupChoices(remembered);
  const [picked, setPicked] = useState<Partial<SetupChoices>>({});
  const choices = { ...saved, ...picked };
  const choose = (patch: Partial<SetupChoices>) => {
    setPicked((p) => ({ ...p, ...patch }));
    setRemembered({ ...saved, ...picked, ...patch });
  };
  const [sideName, setSideName] = useState("");
  const length = choices.length ?? "standard";
  const difficulty = choices.difficulty ?? 2;
  const skin: RunSkin = choices.skin ?? "galaxy";
  // The hand-made map picked in place of a generated style, by its id.
  const pickedMapId = choices.mapId ?? null;
  const pickedLoadoutId = choices.loadout ?? "standard";
  const { headers: gameHeaders } = useUnitsyncGameHeaders(
    target?.enginePath,
    target?.dataDir,
  );

  // Default to the preselected game (if it's on offer), else the last game
  // the player picked (if still installed/allowed), else the first available
  // game.
  useEffect(() => {
    if (gameName && games.some((g) => g.name === gameName)) return;
    if (games.length === 0) return;
    const pick =
      (initialGameName && games.find((g) => g.name === initialGameName)) ||
      games.find((g) => g.name === lastGame) ||
      games[0];
    setGameName(pick.name);
  }, [games, gameName, initialGameName, lastGame]);

  const game = games.find((g) => g.name === gameName) ?? null;
  // What this game offers: the legacy unlocks plus its own. The key is the one a
  // run records for the game, so a finished run lands in the record shown here.
  const gameShortname = game ? (game.info.shortname ?? game.name) : "";
  const unlocks = unlocksFor(meta, gameShortname);
  const loadouts = unlockedLoadouts(unlocks);
  // A choice made for another game falls back when this game does not offer it.
  const loadoutId = loadouts.some((l) => l.id === pickedLoadoutId)
    ? pickedLoadoutId
    : "standard";
  const ascensionTier = unlocks.ascensionTier;
  // A tier this game has not reached goes back to none.
  const rememberedAscension = choices.ascension ?? 0;
  const ascension =
    rememberedAscension <= ascensionTier ? rememberedAscension : 0;
  // The hand-made maps for this game whose author marked a Warpath start and
  // goal. A map with neither is offered only in Conquest.
  // Read for this game alone, and the map style waits on it so a game that hides
  // the generated styles is never offered them and then has them taken away
  // (issue #3674).
  const {
    loading: stylesLoading,
    facts: handmade,
    error: handmadeError,
  } = useGameMapFacts(game);
  const handmadeMaps = game
    ? handmade.maps.filter(
        (m) => m.warpath && resolveGameByShortname(m.game, [game]) === game,
      )
    : [];
  // A game that asks for its own maps only, in its archive or through the
  // profile, is offered no generated style, as long as it has a map to offer
  // here (issues #3511 and #3604). Its first map is then
  // the default.
  const ownMapsOnly =
    !!game &&
    !stylesLoading &&
    hidesGeneratedStyles(game, handmadeMaps, handmade, profileOnlyOwnMaps());
  // A map picked for another game falls back to the generated styles.
  const handmadeMap =
    handmadeMaps.find((m) => m.id === pickedMapId) ??
    (ownMapsOnly ? handmadeMaps[0] : undefined);
  const archive = game?.primaryArchive.name;
  // Starting a run is not a launch, so this does not stop the form. The player
  // is told here, because every battle of the run would stop on it (issue #3489).
  const dependency = game
    ? missingLaunchDependency(game.name, scanned ?? [])
    : null;
  const dependencyBlock = dependency?.gameName
    ? dependencyBlockReason(dependency.label, dependency.gameName)
    : null;
  // Reuse the same branding catalog art shown on game detail (issue #372), so
  // the warpath setup feels like part of the game's world.
  const brandingEntries = useBrandingCatalog();
  const brandingEntry = game ? resolveBranding(brandingEntries, game) : null;
  const { info, loading: infoLoading } = useUnitsyncGameInfo(
    target?.enginePath,
    target?.dataDir,
    archive,
  );
  const {
    dataset,
    status: datasetStatus,
    loading: datasetLoading,
  } = useUnitsyncUnitDataset(target?.enginePath, target?.dataDir, archive);
  const gameLoading = !!archive && (infoLoading || datasetLoading);
  const { ais } = useSkirmishAis(target?.enginePath, target?.dataDir, archive);

  const sides = info?.sides ?? [];
  const factionLogos = useFactionLogos({
    game: game ?? undefined,
    enginePath: target?.enginePath,
    dataDir: target?.dataDir,
    gameArchive: archive,
    sideNames: sides.map((s) => s.name),
  });
  useEffect(() => {
    if (sides.length > 0 && !sides.some((s) => s.name === sideName)) {
      // The remembered side, when this game has one of that name.
      setSideName((sides.find((s) => s.name === saved.side) ?? sides[0]).name);
    }
  }, [sides, sideName, saved.side]);

  const side = sides.find((s) => s.name === sideName);

  const build: GenBuildGraph | undefined = useMemo(
    () => (dataset ? buildGraphFor(side?.startUnit, dataset.units) : undefined),
    [dataset, side?.startUnit],
  );

  // Said before the run starts, so the player knows when no unit limit applies.
  const limitInput = {
    gameName: game?.name ?? "",
    sideName: sideName || "this game",
    startUnit: side?.startUnit,
    status: datasetStatus,
    units: dataset?.units,
  };
  const limitWarning =
    game && !gameLoading ? setupLimitWarning(limitInput) : null;
  const limitNote = game && !gameLoading ? setupLimitNote(limitInput) : null;

  // Excluded maps never enter the pool, so a generated run cannot put the player
  // on one (see `content/mapEligibility`).
  const { eligible } = useMapEligibility();
  const genMaps: GenRunMap[] = useMemo(
    () =>
      eligible(maps).map((m) => ({
        name: m.name,
        size: (m.width ?? 8) * (m.height ?? 8),
      })),
    [maps, eligible],
  );

  // The opponent this run fields: the AI its difficulty calls for, from the
  // game's ranking rather than whatever unitsync listed first.
  const aiConfig = mergeGameAi(getProfile().ai, brandingEntry?.ai);
  const enemyAi = aiForDifficulty(difficulty, ais, aiConfig);
  const enemyAiKey = enemyAi ? aiKey(enemyAi) : undefined;
  const canGenerate =
    !!game && genMaps.length > 0 && !gameLoading && !stylesLoading;

  // Why the last Begin did not start a run, so the player is told where they
  // pressed rather than sent to a run that was never saved.
  const [startError, setStartError] = useState<string | null>(null);
  const startRun = async () => {
    if (!game) return;
    setStartError(null);
    // A game reached from game detail is remembered too, not only one picked here.
    setLastGame(game.name);
    setRemembered({
      skin,
      mapId: pickedMapId,
      side: sideName || undefined,
      length,
      difficulty,
      ascension,
      loadout: loadoutId,
    });
    const opts: GenerateRunOpts = {
      seed: Math.floor(Math.random() * 1e9),
      length,
      difficulty,
      ascension,
      // The archive the player picked, by its full name, so every battle
      // launches it and not another archive sharing the shortname (#3465).
      game: {
        shortname: gameShortname,
        pinnedName: game.name,
      },
      factionId: "player",
      side: sideName || undefined,
      skin,
      maps: genMaps,
      build,
      enemyAiKey,
      loadoutBranch: loadoutById(loadoutId).branchIndex,
    };
    const id = `run-${crypto.randomUUID()}`;
    try {
      if (handmadeMap) {
        // Read now, so a map changed since it was listed is the one played.
        const loaded = await loadHandmadeRunMap(handmadeMap.id);
        if (!loaded.ok) throw new Error(loaded.message);
        await saveRun(
          id,
          generateMapRun({ ...opts, skin: "theatre", ...loaded.source }),
        );
      } else {
        await saveRun(id, generateStyledRun(opts));
      }
    } catch (e) {
      setStartError(
        `The warpath was not started. ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    onStarted(id);
  };

  // Set for the two styles that cross a generated land map.
  const landSizes =
    !handmadeMap && (skin === "cities" || skin === "territories")
      ? LAND_RUN_SIZES[skin]
      : null;

  const toggleItem =
    "rounded-md border border-border/60 px-4 data-[state=on]:border-primary data-[state=on]:bg-primary/10";

  return (
    <div className="flex flex-col gap-4">
      {!forcedSingleGame && (
        <Field label="Game">
          <GameSelectCard
            game={game}
            games={games}
            headers={gameHeaders}
            gamesLoading={scan.loading}
            onSelectGame={selectGame}
          />
        </Field>
      )}

      {brandingEntry && <BrandingLinks entry={brandingEntry} />}
      {brandingEntry?.screenshots?.length ? (
        <BrandingScreenshots shots={brandingEntry.screenshots} />
      ) : null}

      {(sides.length > 0 || gameLoading) && (
        <Field label="Faction / side">
          {gameLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading the game's factions…
            </div>
          ) : (
            <ToggleGroup
              type="single"
              value={sideName}
              onValueChange={(v) => {
                if (!v) return;
                setSideName(v);
                choose({ side: v });
              }}
              className="flex-wrap justify-start gap-2"
            >
              {sides.map((s) => (
                <ToggleGroupItem
                  key={s.name}
                  value={s.name}
                  className={toggleItem}
                >
                  <span className="flex items-center gap-1.5">
                    {factionLogos[s.name.toLowerCase()] && (
                      <FactionLogo
                        logo={factionLogos[s.name.toLowerCase()]}
                        sideName={s.name}
                        size={16}
                      />
                    )}
                    {s.name}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </Field>
      )}

      {!metaLoading && metaError && (
        <ErrorBanner
          message={`Warpath records could not be read. Only the standard options are offered. The file has not been changed. ${metaError}`}
        />
      )}

      {loadouts.length > 1 && (
        <Field label="Loadout">
          <ToggleGroup
            type="single"
            value={loadoutId}
            onValueChange={(v) => v && choose({ loadout: v })}
            className="flex-wrap justify-start gap-2"
          >
            {loadouts.map((l) => (
              <ToggleGroupItem key={l.id} value={l.id} className={toggleItem}>
                {l.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      )}

      {/* A hand-made map decides how long its run is. */}
      {!handmadeMap && (
        <Field label="Length">
          <ToggleGroup
            type="single"
            value={length}
            onValueChange={(v) => v && choose({ length: v as RunLength })}
            className="justify-start gap-2"
          >
            {(["quick", "standard", "long"] as const).map((l) => (
              <ToggleGroupItem
                key={l}
                value={l}
                className={`${toggleItem} capitalize`}
              >
                {l}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {landSizes && (
            <span className="text-xs text-muted-foreground">
              The map decides how long this warpath is. This length crosses a
              map of {landSizes[length]} {locationNoun(skin).many}.
            </span>
          )}
        </Field>
      )}

      <Field label={`Difficulty — level ${difficulty}`}>
        <Slider
          min={1}
          max={5}
          step={1}
          value={[difficulty]}
          onValueChange={([v]) => choose({ difficulty: v })}
          className="py-2"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Map style">
          {stylesLoading ? (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Checking which maps this game carries…
            </div>
          ) : (
            <OptionSelect
              value={handmadeMap ? `${HANDMADE_PREFIX}${handmadeMap.id}` : skin}
              onValueChange={(v) => {
                if (v.startsWith(HANDMADE_PREFIX)) {
                  choose({ mapId: v.slice(HANDMADE_PREFIX.length) });
                } else {
                  choose({ mapId: null, skin: v as RunSkin });
                }
              }}
              options={[
                ...(ownMapsOnly ? [] : MAP_STYLE_OPTIONS),
                ...handmadeMaps.map((m) => ({
                  value: `${HANDMADE_PREFIX}${m.id}`,
                  label: `${m.title} (hand-made map)`,
                })),
              ]}
            />
          )}
        </Field>
        {ascensionTier > 0 && (
          <Field label="Ascension">
            <OptionSelect
              value={String(ascension)}
              onValueChange={(v) => choose({ ascension: Number(v) })}
              options={Array.from({ length: ascensionTier + 1 }, (_, i) => ({
                value: String(i),
                label: `Tier ${i}`,
              }))}
            />
          </Field>
        )}
      </div>

      {handmadeError && (
        <ErrorBanner
          message={`The hand-made maps could not be listed, so none is offered here. ${handmadeError}`}
        />
      )}

      {dependencyBlock && <DependencyBlocked reason={dependencyBlock} />}

      {startError && <ErrorBanner message={startError} />}

      <Button onClick={startRun} disabled={!canGenerate} className="w-full">
        {gameLoading ? (
          <>
            <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
            Loading game data…
          </>
        ) : (
          <>
            <Swords className="mr-1.5 size-4" aria-hidden /> Begin warpath
          </>
        )}
      </Button>
      {limitNote && (
        <p className="text-xs text-muted-foreground">{limitNote}</p>
      )}
      {limitWarning && (
        <p className="text-xs text-muted-foreground">{limitWarning}</p>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
