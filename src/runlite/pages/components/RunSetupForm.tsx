import { Button } from "@picoframe/frame";
import { Loader2, Swords } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useUnitsyncGameHeaders,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "../../../content/config";
import { usePreferredTarget, useSkirmishAis } from "../../../play/config";
import { GameSelectCard } from "../../../play/pages/components/GameSelectCard";
import { getGameMatcher } from "../../../profile/profile";
import {
  type GenBuildGraph,
  type GenerateRunOpts,
  type GenRunMap,
  generateRun,
} from "../../generate";
import { loadoutById, unlockedLoadouts } from "../../meta";
import type { RunLength, RunSkin } from "../../model";
import { useRun, useRunMeta } from "../../runs";
import { OptionSelect } from "./OptionSelect";

/**
 * The run-setup form, shown in a drawer (see RunListPage). Assembles a
 * {@link GenerateRunOpts} from the installed game's maps, sides and build graph,
 * bakes a self-contained run and saves it, then calls `onStarted`.
 */
/** Remembers the last game picked across runs (and the module-level default). */
const LAST_GAME_KEY = "runlite:lastGame";

export function RunSetupForm({ onStarted }: { onStarted: () => void }) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { save } = useRun();
  const { meta } = useRunMeta();

  // In a distribution profile filtered to a game, only that game is offered.
  const matcher = getGameMatcher();
  const allGames = scan.data?.games ?? [];
  const games = useMemo(
    () => (matcher ? allGames.filter((g) => matcher(g.name)) : allGames),
    [allGames, matcher],
  );
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
  const [loadoutId, setLoadoutId] = useState("standard");

  const loadouts = unlockedLoadouts(meta);
  const { headers: gameHeaders } = useUnitsyncGameHeaders(
    target?.enginePath,
    target?.dataDir,
  );

  // Default to the last game the player picked (if still installed/allowed),
  // else the first available game.
  useEffect(() => {
    if (gameName && games.some((g) => g.name === gameName)) return;
    if (games.length === 0) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_GAME_KEY);
    } catch {}
    const pick = games.find((g) => g.name === last) ?? games[0];
    setGameName(pick.name);
  }, [games, gameName]);

  const game = games.find((g) => g.name === gameName) ?? null;
  const archive = game?.primaryArchive.name;
  const { info, loading: infoLoading } = useUnitsyncGameInfo(
    target?.enginePath,
    target?.dataDir,
    archive,
  );
  const { dataset, loading: datasetLoading } = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    archive,
  );
  const gameLoading = !!archive && (infoLoading || datasetLoading);
  const { ais } = useSkirmishAis(target?.enginePath, target?.dataDir, archive);

  const sides = info?.sides ?? [];
  useEffect(() => {
    if (sides.length > 0 && !sides.some((s) => s.name === sideName)) {
      setSideName(sides[0].name);
    }
  }, [sides, sideName]);

  const side = sides.find((s) => s.name === sideName);

  const build: GenBuildGraph | undefined = useMemo(() => {
    if (!dataset || !side?.startUnit) return undefined;
    const edges = new Map<string, string[]>();
    const names = new Map<string, string>();
    for (const u of dataset.units) {
      edges.set(
        u.name.toLowerCase(),
        (u.buildOptions ?? []).map((o) => o.toLowerCase()),
      );
      names.set(u.name.toLowerCase(), u.fullName ?? u.name);
    }
    return { startUnit: side.startUnit.toLowerCase(), edges, names };
  }, [dataset, side?.startUnit]);

  const genMaps: GenRunMap[] = useMemo(
    () =>
      maps.map((m) => ({
        name: m.name,
        size: (m.width ?? 8) * (m.height ?? 8),
      })),
    [maps],
  );

  const enemyAiKey = ais[0] ? `${ais[0].kind}:${ais[0].shortName}` : undefined;
  const canGenerate = !!game && genMaps.length > 0 && !gameLoading;

  const startRun = async () => {
    if (!game) return;
    const opts: GenerateRunOpts = {
      seed: Math.floor(Math.random() * 1e9),
      length,
      difficulty,
      ascension,
      game: { shortname: game.info.shortname ?? game.name },
      factionId: "player",
      side: sideName || undefined,
      skin,
      maps: genMaps,
      build,
      enemyAiKey,
      loadoutBranch: loadoutById(loadoutId).branchIndex,
    };
    await save(generateRun(opts));
    onStarted();
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
                  {s.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </Field>
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
        {meta.ascensionTier > 0 && (
          <Field label="Ascension">
            <OptionSelect
              value={String(ascension)}
              onValueChange={(v) => setAscension(Number(v))}
              options={Array.from(
                { length: meta.ascensionTier + 1 },
                (_, i) => ({
                  value: String(i),
                  label: `Tier ${i}`,
                }),
              )}
            />
          </Field>
        )}
      </div>

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
      {!build && game && (
        <p className="text-xs text-muted-foreground">
          Unit data unavailable for this game — rewards will offer perks only
          and the full arsenal is allowed.
        </p>
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
