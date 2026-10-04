import { Button } from "@picoframe/frame";
import { Loader2, Swords } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FactionLogo } from "@/factions/FactionLogo";
import { useFactionLogos } from "@/factions/logos";
import { withoutGeneratedGames } from "@/lib/generatedGames";
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
import { missingLaunchDependency } from "../../../play/launchContent";
import { GameSelectCard } from "../../../play/pages/components/GameSelectCard";
import { aiKey } from "../../../play/participants";
import { getGameMatcher, getProfile } from "../../../profile/profile";
import {
  type GenBuildGraph,
  type GenerateRunOpts,
  type GenRunMap,
  generateRun,
} from "../../generate";
import { loadoutById, unlockedLoadouts, unlocksFor } from "../../meta";
import type { RunLength, RunSkin } from "../../model";
import { useRunMeta, useRuns } from "../../runs";
import {
  buildGraphFor,
  setupLimitNote,
  setupLimitWarning,
} from "../../unitLimit";

/**
 * The run-setup form, shown in a drawer (see RunListPage). Assembles a
 * {@link GenerateRunOpts} from the installed game's maps, sides and build graph,
 * bakes a self-contained run and saves it, then calls `onStarted`.
 */
/** Remembers the last game picked across runs (and the module-level default). */
const LAST_GAME_KEY = "runlite:lastGame";

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
  const selectGame = (name: string) => {
    setGameName(name);
    try {
      localStorage.setItem(LAST_GAME_KEY, name);
    } catch {}
  };
  const [sideName, setSideName] = useState("");
  const [length, setLength] = useState<RunLength>("standard");
  const [difficulty, setDifficulty] = useState(2);
  const [ascension, setAscension] = useState(0);
  const [skin, setSkin] = useState<RunSkin>("galaxy");
  const [pickedLoadoutId, setLoadoutId] = useState("standard");
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
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_GAME_KEY);
    } catch {}
    const pick =
      (initialGameName && games.find((g) => g.name === initialGameName)) ||
      games.find((g) => g.name === last) ||
      games[0];
    setGameName(pick.name);
  }, [games, gameName, initialGameName]);

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
      setSideName(sides[0].name);
    }
  }, [sides, sideName]);

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
  const canGenerate = !!game && genMaps.length > 0 && !gameLoading;

  // Why the last Begin did not start a run, so the player is told where they
  // pressed rather than sent to a run that was never saved.
  const [startError, setStartError] = useState<string | null>(null);
  const startRun = async () => {
    if (!game) return;
    setStartError(null);
    const opts: GenerateRunOpts = {
      seed: Math.floor(Math.random() * 1e9),
      length,
      difficulty,
      ascension: Math.min(ascension, ascensionTier),
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
      await saveRun(id, generateRun(opts));
    } catch (e) {
      setStartError(
        `The warpath was not started. ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    onStarted(id);
  };

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
              onValueChange={(v) => v && setSideName(v)}
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
            onValueChange={(v) => v && setLoadoutId(v)}
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

      <Field label="Length">
        <ToggleGroup
          type="single"
          value={length}
          onValueChange={(v) => v && setLength(v as RunLength)}
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
      </Field>

      <Field label={`Difficulty — level ${difficulty}`}>
        <Slider
          min={1}
          max={5}
          step={1}
          value={[difficulty]}
          onValueChange={([v]) => setDifficulty(v)}
          className="py-2"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Map style">
          <OptionSelect
            value={skin}
            onValueChange={(v) => setSkin(v as RunSkin)}
            options={[
              { value: "galaxy", label: "Galaxy (starfield)" },
              { value: "theatre", label: "Theatre (flat chart)" },
            ]}
          />
        </Field>
        {ascensionTier > 0 && (
          <Field label="Ascension">
            <OptionSelect
              value={String(Math.min(ascension, ascensionTier))}
              onValueChange={(v) => setAscension(Number(v))}
              options={Array.from({ length: ascensionTier + 1 }, (_, i) => ({
                value: String(i),
                label: `Tier ${i}`,
              }))}
            />
          </Field>
        )}
      </div>

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
