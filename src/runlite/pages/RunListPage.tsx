import { Button } from "@picoframe/frame";
import { Loader2, Play, Swords, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useUnitsyncGameHeaders,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "../../content/config";
import { EmptyState } from "../../content/pages/components/states";
import { usePreferredTarget, useSkirmishAis } from "../../play/config";
import { GameSelectCard } from "../../play/pages/components/GameSelectCard";
import {
  type GenBuildGraph,
  type GenerateRunOpts,
  type GenRunMap,
  generateRun,
} from "../generate";
import { loadoutById, unlockedLoadouts } from "../meta";
import type { RunLength, RunSkin } from "../model";
import { useRun, useRunMeta } from "../runs";
import { OptionSelect } from "./components/OptionSelect";

/**
 * Run setup + resume. Assembles a {@link GenerateRunOpts} from the installed
 * game's maps, sides and build graph (all resolved via the content hooks), then
 * `generateRun` bakes a self-contained run that's saved and played. A run in
 * flight can be resumed or abandoned.
 */
export default function RunListPage() {
  const navigate = useNavigate();
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { run: activeRun, save } = useRun();
  const { meta } = useRunMeta();

  const games = scan.data?.games ?? [];
  const maps = scan.data?.maps ?? [];

  const [gameName, setGameName] = useState("");
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

  // Default to the first installed game once the scan lands.
  useEffect(() => {
    if (!gameName && games.length > 0) setGameName(games[0].name);
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
  // The game's sides/build tree load asynchronously after a game switch; the
  // faction, loadout and Begin controls all derive from them, so gate them.
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
      // No seed field: a run is disposable and unshared, so each is fresh.
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
    navigate("/runlite/active");
  };

  // The initial scan can take a moment; don't leave the form blank and inert.
  if (!scan.data) {
    return (
      <div className="p-6">
        {target ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Scanning installed games…
          </div>
        ) : (
          <EmptyState label="Install an engine first (Content → Engines)." />
        )}
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="p-6">
        <EmptyState label="No games installed. Add one from Content → Games." />
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Swords className="size-5 text-primary" aria-hidden /> Roguelite Run
        </h1>
        <p className="text-sm text-muted-foreground">
          Cross a forward-only map once — fight, take rewards, grow your build,
          and reach the warlord before your health runs out.
        </p>
      </header>

      {activeRun && activeRun.progress.status === "active" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div>
            <div className="font-medium">Run in progress</div>
            <div className="text-xs text-muted-foreground">
              {activeRun.settings.game.shortname} · health{" "}
              {activeRun.progress.hull}/{activeRun.progress.maxHull}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate("/runlite/active")}>
              <Play className="mr-1.5 size-4" aria-hidden /> Resume
            </Button>
            <Button variant="outline" onClick={() => save(null)}>
              <Trash2 className="mr-1.5 size-4" aria-hidden /> Abandon
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-lg border border-border/50 bg-card/50 p-5">
        <Field label="Game">
          {/* Compact picker, not a full-width battle card. */}
          <div className="max-w-[20rem]">
            <GameSelectCard
              game={game}
              games={games}
              headers={gameHeaders}
              gamesLoading={scan.loading}
              onSelectGame={setGameName}
            />
          </div>
        </Field>

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
                    className="rounded-md border border-border/60 px-4 data-[state=on]:border-primary data-[state=on]:bg-primary/10"
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
                <ToggleGroupItem
                  key={l.id}
                  value={l.id}
                  className="rounded-md border border-border/60 px-4 data-[state=on]:border-primary data-[state=on]:bg-primary/10"
                >
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
                className="rounded-md border border-border/60 px-4 capitalize data-[state=on]:border-primary data-[state=on]:bg-primary/10"
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
                  (_, i) => ({ value: String(i), label: `Tier ${i}` }),
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
              <Swords className="mr-1.5 size-4" aria-hidden /> Begin run
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
