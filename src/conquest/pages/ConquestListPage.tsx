import { Button, Input, useDrawer } from "@picoframe/frame";
import { ChevronRight, Dices, Orbit, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useUnitsyncScan } from "../../content/config";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { usePreferredTarget, useSkirmishAis } from "../../play/config";
import { getGameMatcher } from "../../profile/profile";
import { OptionSelect } from "../../uberstress/pages/components/OptionSelect";
import { conquestDelete, conquestSave } from "../bindings";
import { refreshGalaxies, useConquestState, useGalaxies } from "../conquests";
import { generateGalaxy } from "../generate";
import type { ConquestState, GalaxyDoc } from "../model";
import { compareGameVersions } from "../model";

/**
 * The Conquest hub: in-progress runs first, then galaxies ready to start
 * (bundled and generated), plus the "Generate a galaxy" drawer — the
 * procedural fallback for games that ship no authored galaxy. Faction/side
 * choice happens on the galaxy page itself, over a live preview of the map.
 */
export default function ConquestListPage() {
  const { galaxies, loading, error } = useGalaxies();
  const { file } = useConquestState();
  const drawer = useDrawer();
  const navigate = useNavigate();

  const runs = galaxies.filter((g) => file.conquests[g.galaxy.id]);
  const unstarted = galaxies.filter((g) => !file.conquests[g.galaxy.id]);

  const openGenerate = () =>
    drawer.open({
      title: "Generate a galaxy",
      width: "30rem",
      content: (
        <GenerateGalaxyForm
          onCreated={(id) => {
            drawer.close();
            navigate(`/conquest/${encodeURIComponent(id)}`);
          }}
        />
      ),
    });

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Conquest</h1>
          <p className="text-sm text-muted-foreground">
            Wage a campaign across a galaxy of star systems. Win skirmishes to
            capture territory, defend against counterattacks, and take every
            enemy capital.
          </p>
        </div>
        <Button onClick={openGenerate} className="shrink-0">
          <Dices className="mr-1.5 size-4" aria-hidden /> Generate a galaxy
        </Button>
      </header>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <SkeletonList />
      ) : galaxies.length === 0 ? (
        <EmptyState label="No galaxies yet. Generate one for any installed game, or import a galaxy file." />
      ) : (
        <>
          {runs.length > 0 && (
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
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {unstarted.length > 0 && (
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
              </ul>
            </section>
          )}
        </>
      )}
    </div>
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

function GalaxyCard({
  galaxy,
  bundled,
  state,
}: {
  galaxy: GalaxyDoc;
  bundled: boolean;
  state: ConquestState | undefined;
}) {
  const { refresh } = useGalaxies();
  const statusLabel =
    state?.status === "won"
      ? "Victory"
      : state?.status === "lost"
        ? "Defeat"
        : state
          ? `Turn ${state.turn} · ${territoryPercent(galaxy, state)}% held`
          : "Not started";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-border hover:bg-accent/50">
      <Link
        to={`/conquest/${encodeURIComponent(galaxy.id)}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <Orbit className="size-5 text-muted-foreground" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{galaxy.title}</span>
            {bundled && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                Bundled
              </span>
            )}
          </div>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {galaxy.game.shortname} · {galaxy.nodes.length} systems ·{" "}
            {galaxy.factions.length} factions
          </p>
          <span
            className={`text-xs ${
              state?.status === "won"
                ? "text-emerald-400"
                : state?.status === "lost"
                  ? "text-red-400"
                  : "text-muted-foreground/80"
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
      {!bundled && !state && (
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
      )}
    </div>
  );
}

const SIZE_OPTIONS = [
  { value: "12", label: "Small (12 systems)" },
  { value: "18", label: "Medium (18 systems)" },
  { value: "28", label: "Large (28 systems)" },
  { value: "40", label: "Sprawling (40 systems)" },
];
const FACTION_OPTIONS = [
  { value: "1", label: "One enemy faction" },
  { value: "2", label: "Two enemy factions" },
  { value: "3", label: "Three enemy factions" },
];

/**
 * The procedural wizard: pick a game (one entry per modinfo shortname, newest
 * installed version, narrowed by the profile's game filter — auto-selected
 * when only one qualifies), size, enemy count and seed, then save the
 * generated document so the run is stable across sessions and content changes.
 */
function GenerateGalaxyForm({
  onCreated,
}: {
  onCreated: (id: string) => void;
}) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One wizard entry per shortname: the newest installed version represents
  // the game (battles always resolve "latest installed" at launch anyway).
  const gameChoices = useMemo(() => {
    const matcher = getGameMatcher();
    const games = scan.data?.games ?? [];
    const byShort = new Map<string, (typeof games)[number]>();
    for (const g of games) {
      if (matcher && !matcher(g.name)) continue;
      const short = (g.info.shortname ?? g.name).trim();
      if (!short) continue;
      const existing = byShort.get(short.toLowerCase());
      if (
        !existing ||
        compareGameVersions(g.info.version ?? "", existing.info.version ?? "") >
          0
      ) {
        byShort.set(short.toLowerCase(), g);
      }
    }
    return [...byShort.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [scan.data]);

  const [gameShort, setGameShort] = useState("");
  const selected =
    gameChoices.find(
      (g) => (g.info.shortname ?? g.name).trim().toLowerCase() === gameShort,
    ) ?? (gameChoices.length === 1 ? gameChoices[0] : undefined);
  const effectiveShort = selected
    ? (selected.info.shortname ?? selected.name).trim()
    : "";

  const { ais } = useSkirmishAis(
    target?.enginePath,
    target?.dataDir,
    selected?.primaryArchive.name,
  );

  const [size, setSize] = useState("18");
  const [factions, setFactions] = useState("2");
  const [seed, setSeed] = useState(() =>
    String(Math.floor(Math.random() * 100000)),
  );

  const { run: runScan, data: scanData, loading: scanLoading } = scan;
  useEffect(() => {
    if (!scanData && !scanLoading) runScan();
  }, [scanData, scanLoading, runScan]);

  const maps = scan.data?.maps ?? [];
  const blocked = !target
    ? "Install an engine first (Content → Engines)."
    : scan.data && (scan.data.games.length === 0 || gameChoices.length === 0)
      ? "Install a game first (Content → Games)."
      : selected && ais.length === 0
        ? "This game has no skirmish AIs to fight against."
        : maps.length === 0 && scan.data
          ? "Install at least one map first (Content → Maps)."
          : null;

  const create = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const id = `generated-${crypto.randomUUID()}`;
      const doc = generateGalaxy({
        seed: Number(seed) || 1,
        game: { shortname: effectiveShort },
        maps,
        ais: ais.map((a) => ({
          kind: a.kind,
          shortName: a.shortName,
          name: a.name,
        })),
        nodeCount: Number(size),
        factionCount: Number(factions),
        id,
        title: `${effectiveShort} Conquest`,
      });
      await conquestSave({ id, json: JSON.stringify(doc) });
      await refreshGalaxies();
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {blocked ? (
        <p className="text-sm text-muted-foreground">{blocked}</p>
      ) : (
        <>
          {gameChoices.length > 1 && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Game</span>
              <OptionSelect
                value={effectiveShort.toLowerCase()}
                onValueChange={setGameShort}
                placeholder={scan.loading ? "Scanning…" : "Pick a game"}
                options={gameChoices.map((g) => ({
                  value: (g.info.shortname ?? g.name).trim().toLowerCase(),
                  label: g.name,
                }))}
              />
            </div>
          )}
          {gameChoices.length === 1 && (
            <p className="text-sm text-muted-foreground">
              Game:{" "}
              <span className="text-foreground">{gameChoices[0].name}</span>
            </p>
          )}
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Galaxy size</span>
            <OptionSelect
              value={size}
              onValueChange={setSize}
              options={SIZE_OPTIONS}
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Opposition</span>
            <OptionSelect
              value={factions}
              onValueChange={setFactions}
              options={FACTION_OPTIONS}
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Seed</span>
            <div className="flex gap-2">
              <Input
                value={seed}
                onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                aria-label="Galaxy seed"
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
              The same seed always builds the same galaxy.
            </span>
          </div>
          {error && <ErrorBanner message={error} />}
          <Button onClick={create} disabled={busy || !selected}>
            {busy ? "Generating…" : "Create galaxy"}
          </Button>
        </>
      )}
    </div>
  );
}
