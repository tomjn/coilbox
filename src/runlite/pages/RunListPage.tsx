import { Button } from "@picoframe/frame";
import { Dices, Play, Swords, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "../../content/config";
import { EmptyState } from "../../content/pages/components/states";
import { usePreferredTarget, useSkirmishAis } from "../../play/config";
import {
  type GenBuildGraph,
  type GenerateRunOpts,
  type GenRunMap,
  generateRun,
} from "../generate";
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

  const [shortname, setShortname] = useState("");
  const [sideName, setSideName] = useState("");
  const [length, setLength] = useState<RunLength>("standard");
  const [difficulty, setDifficulty] = useState(2);
  const [ascension, setAscension] = useState(0);
  const [skin, setSkin] = useState<RunSkin>("galaxy");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));

  // Default to the first installed game once the scan lands.
  useEffect(() => {
    if (!shortname && games.length > 0) {
      setShortname(games[0].info.shortname ?? games[0].name);
    }
  }, [games, shortname]);

  const game = games.find((g) => (g.info.shortname ?? g.name) === shortname);
  const archive = game?.primaryArchive.name;
  const { info } = useUnitsyncGameInfo(
    target?.enginePath,
    target?.dataDir,
    archive,
  );
  const { dataset } = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    archive,
  );
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

  const canGenerate = !!game && genMaps.length > 0;

  const startRun = async () => {
    if (!game) return;
    const opts: GenerateRunOpts = {
      seed,
      length,
      difficulty,
      ascension,
      game: { shortname: shortname },
      factionId: "player",
      side: sideName || undefined,
      skin,
      maps: genMaps,
      build,
      enemyAiKey,
    };
    await save(generateRun(opts));
    navigate("/runlite/active");
  };

  if (target && scan.data && games.length === 0) {
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
          and reach the warlord before your hull runs out.
        </p>
      </header>

      {activeRun && activeRun.progress.status === "active" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div>
            <div className="font-medium">Run in progress</div>
            <div className="text-xs text-muted-foreground">
              {activeRun.settings.game.shortname} · hull{" "}
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
          <OptionSelect
            value={shortname}
            onValueChange={setShortname}
            options={games.map((g) => ({
              value: g.info.shortname ?? g.name,
              label: g.info.name ?? g.name,
            }))}
            placeholder="Select a game"
          />
        </Field>

        {sides.length > 0 && (
          <Field label="Faction / side">
            <OptionSelect
              value={sideName}
              onValueChange={setSideName}
              options={sides.map((s) => ({ value: s.name, label: s.name }))}
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Length">
            <OptionSelect
              value={length}
              onValueChange={(v) => setLength(v as RunLength)}
              options={[
                { value: "quick", label: "Quick" },
                { value: "standard", label: "Standard" },
                { value: "long", label: "Long" },
              ]}
            />
          </Field>
          <Field label="Difficulty">
            <OptionSelect
              value={String(difficulty)}
              onValueChange={(v) => setDifficulty(Number(v))}
              options={[1, 2, 3, 4, 5].map((d) => ({
                value: String(d),
                label: `Level ${d}`,
              }))}
            />
          </Field>
        </div>

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

        <Field label="Seed">
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate font-mono text-sm tabular-nums text-muted-foreground">
              {seed}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
            >
              <Dices className="mr-1.5 size-4" aria-hidden /> Reroll
            </Button>
          </div>
        </Field>

        <Button onClick={startRun} disabled={!canGenerate} className="w-full">
          <Swords className="mr-1.5 size-4" aria-hidden /> Begin run
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
