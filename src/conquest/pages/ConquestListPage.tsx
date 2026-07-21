import { Button, buttonVariants, cn, Input, useDrawer } from "@picoframe/frame";
import { ChevronRight, Dices, Orbit, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { FactionLogo } from "@/factions/FactionLogo";
import { useFactionLogo } from "@/factions/logos";
import { resolveBranding, useBrandingCatalog } from "../../content/branding";
import { useUnitsyncScan } from "../../content/config";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { usePreferredTarget, useSkirmishAis } from "../../play/config";
import { getGameMatcher, getProfile } from "../../profile/profile";
import { OptionSelect } from "../../uberstress/pages/components/OptionSelect";
import { conquestDelete, conquestSave } from "../bindings";
import { refreshGalaxies, useConquestState, useGalaxies } from "../conquests";
import { type GenerateOptions, generateGalaxy } from "../generate";
import type { ConquestState, GalaxyDoc } from "../model";
import { compareGameVersions, resolveGameByShortname } from "../model";
import { mergeConquestNames } from "../names";
import { GalaxyPreview2D } from "./components/GalaxyPreview2D";

/**
 * The Conquest hub: in-progress runs first, then galaxies ready to start
 * (bundled and generated), plus the "Generate a galaxy" drawer — the
 * procedural fallback for games that ship no authored galaxy. Faction/side
 * choice happens on the galaxy page itself, over a live preview of the map.
 */
export default function ConquestListPage() {
  const { galaxies, loading, error } = useGalaxies();
  const { file, saveFor } = useConquestState();
  const drawer = useDrawer();
  const navigate = useNavigate();

  // unitsync is the source of truth for "is a game available", not a file count:
  // rapid installs (BAR et al.) live in packages/pool, not games/*.sd7. Until the
  // scan resolves we keep showing the normal UI so guidance never flashes.
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const scanResolved = scan.data != null;
  const hasGames = (scan.data?.games.length ?? 0) > 0;
  const needsGame = !target || (scanResolved && !hasGames);

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
        {!needsGame && (
          <Button onClick={openGenerate} className="shrink-0">
            <Dices className="mr-1.5 size-4" aria-hidden /> Generate a galaxy
          </Button>
        )}
      </header>

      {error && <ErrorBanner message={error} />}

      {needsGame ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Orbit className="size-6 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {target
                ? "Conquest needs a game installed"
                : "Conquest needs an engine and a game"}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              {target
                ? "Conquest generates a galaxy for any installed game with skirmish AIs. Download a game to get started — it will appear here automatically."
                : "Install an engine and at least one game, then return here to generate a galaxy for it."}
            </p>
          </div>
          <div className="flex gap-2">
            {!target && (
              <Link
                to="/settings/engines"
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                Install an engine
              </Link>
            )}
            <Button
              variant="outline"
              onClick={() => navigate("/downloads/games")}
            >
              Browse games to download
            </Button>
          </div>
        </div>
      ) : loading ? (
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
                      onAbandon={() => saveFor(galaxy.id, undefined)}
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
  onAbandon,
}: {
  galaxy: GalaxyDoc;
  bundled: boolean;
  state: ConquestState | undefined;
  /** Present for in-progress cards: clears the run state, keeping the galaxy. */
  onAbandon?: () => void;
}) {
  const { refresh } = useGalaxies();
  // The player's chosen faction emblem (by its in-game side), shown in place of the
  // generic orbit glyph. Resolved per card — hooks are shared/cached per target.
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

const SIZE_OPTIONS = [
  { value: "12", label: "Small (12 systems)" },
  { value: "18", label: "Medium (18 systems)" },
  { value: "28", label: "Large (28 systems)" },
  { value: "40", label: "Sprawling (40 systems)" },
  { value: "56", label: "Vast (56 systems)" },
  { value: "80", label: "Immense (80 systems)" },
];
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
];
const STYLE_OPTIONS = [
  { value: "galaxy", label: "Galaxy (starfield)" },
  { value: "theatre", label: "Theatre map (flat chart)" },
];
// "" means the classic full-frontier start (capital + all neighbours).
const STARTING_OPTIONS = [
  { value: "", label: "Full frontier (default)" },
  { value: "1", label: "Capital only" },
  { value: "2", label: "Capital + 1 system" },
  { value: "3", label: "Capital + 2 systems" },
  { value: "4", label: "Capital + 3 systems" },
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
  const brandingEntries = useBrandingCatalog();
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
  // Default to the first game so the create button is never a silent dead-end;
  // the user can still switch games via the select.
  const selected =
    gameChoices.find(
      (g) => (g.info.shortname ?? g.name).trim().toLowerCase() === gameShort,
    ) ?? gameChoices[0];
  const effectiveShort = selected
    ? (selected.info.shortname ?? selected.name).trim()
    : "";

  const { ais } = useSkirmishAis(
    target?.enginePath,
    target?.dataDir,
    selected?.primaryArchive.name,
  );

  // Naming pools / faction presets: the matched game's catalog defaults, with
  // a distribution's profile.json overriding on top.
  const brandingEntry = selected
    ? resolveBranding(brandingEntries, selected)
    : null;
  const names = useMemo(
    () => mergeConquestNames(getProfile().conquest, brandingEntry?.conquest),
    [brandingEntry],
  );

  const [size, setSize] = useState("18");
  const [factions, setFactions] = useState("2");
  const [layout, setLayout] = useState("random");
  const [style, setStyle] = useState("galaxy");
  const [starting, setStarting] = useState("");
  const [fog, setFog] = useState(false);
  const [seed, setSeed] = useState(() =>
    String(Math.floor(Math.random() * 100000)),
  );

  const { run: runScan, data: scanData, loading: scanLoading } = scan;
  useEffect(() => {
    if (!scanData && !scanLoading) runScan();
  }, [scanData, scanLoading, runScan]);

  const maps = useMemo(() => scan.data?.maps ?? [], [scan.data]);

  // One options builder shared by the live preview and the create action, so
  // the galaxy the user saw is exactly the galaxy that gets saved.
  const genOptions = useCallback(
    (id: string): GenerateOptions => ({
      seed: Number(seed) || 1,
      game: { shortname: effectiveShort },
      maps,
      ais: ais.map((a) => ({
        kind: a.kind,
        shortName: a.shortName,
        name: a.name,
      })),
      aiConfig: brandingEntry?.conquestAi,
      nodeCount: Number(size),
      factionCount: Number(factions),
      layout: layout as GenerateOptions["layout"],
      skin: style === "theatre" ? "theatre" : "galaxy",
      startingSystems: starting ? Number(starting) : undefined,
      fogOfWar: fog,
      names,
      id,
      title: `${effectiveShort} Conquest`,
    }),
    [
      seed,
      effectiveShort,
      maps,
      ais,
      size,
      factions,
      layout,
      style,
      starting,
      fog,
      names,
      brandingEntry,
    ],
  );

  const preview = useMemo(() => {
    if (!selected || maps.length === 0) return null;
    try {
      return generateGalaxy(genOptions("preview"));
    } catch {
      return null;
    }
  }, [genOptions, selected, maps]);
  const blocked: ReactNode = !target ? (
    <>
      Install an engine first (
      <Link className="underline underline-offset-4" to="/settings/engines">
        Settings → Engines
      </Link>
      ).
    </>
  ) : scan.data &&
    (scan.data.games.length === 0 || gameChoices.length === 0) ? (
    <>
      Install a game first (
      <Link className="underline underline-offset-4" to="/content/games">
        Content → Games
      </Link>
      ).
    </>
  ) : selected && ais.length === 0 ? (
    "This game has no skirmish AIs to fight against."
  ) : maps.length === 0 && scan.data ? (
    <>
      Install at least one map first (
      <Link className="underline underline-offset-4" to="/content/maps">
        Content → Maps
      </Link>
      ).
    </>
  ) : null;

  const create = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const id = `generated-${crypto.randomUUID()}`;
      const doc = generateGalaxy(genOptions(id));
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
            <span className="font-medium">Shape</span>
            <OptionSelect
              value={layout}
              onValueChange={setLayout}
              options={LAYOUT_OPTIONS}
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Map style</span>
            <OptionSelect
              value={style}
              onValueChange={setStyle}
              options={STYLE_OPTIONS}
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Starting systems</span>
            <OptionSelect
              value={starting}
              onValueChange={setStarting}
              options={STARTING_OPTIONS}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <label htmlFor="conquest-fog" className="flex flex-col gap-0.5">
              <span className="font-medium">Fog of war</span>
              <span className="text-xs text-muted-foreground">
                Hide systems more than two jumps from your territory.
              </span>
            </label>
            <Switch id="conquest-fog" checked={fog} onCheckedChange={setFog} />
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
          {preview && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Preview</span>
              <GalaxyPreview2D galaxy={preview} />
              {preview.nodes.length < Number(size) && (
                <span className="text-xs text-muted-foreground">
                  Capped at {preview.nodes.length} named systems.
                </span>
              )}
            </div>
          )}
          {error && <ErrorBanner message={error} />}
          <Button onClick={create} disabled={busy || !selected}>
            {busy ? "Generating…" : "Create galaxy"}
          </Button>
        </>
      )}
    </div>
  );
}
