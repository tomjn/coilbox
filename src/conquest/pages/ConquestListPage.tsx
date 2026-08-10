import { Button, buttonVariants, cn, Input, useDrawer } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  Dices,
  Download,
  Orbit,
  Share2,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ContinueBadge } from "@/components/ContinueBadge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { FactionLogo } from "@/factions/FactionLogo";
import { useFactionLogo } from "@/factions/logos";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { mostRecentOpen } from "@/lib/recency";
import { challengeExport, challengeImport } from "../../challenge/bindings";
import { ChallengeCodeInput } from "../../challenge/ChallengeCodeInput";
import { ChallengeCodeView } from "../../challenge/ChallengeCodeView";
import { challengeDecodeErrorMessage } from "../../challenge/code";
import { unitsyncSkirmishAis } from "../../content/bindings";
import { resolveBranding, useBrandingCatalog } from "../../content/branding";
import { useUnitsyncScan } from "../../content/config";
import { useMapEligibility } from "../../content/mapEligibility";
import { BrandingLinks } from "../../content/pages/components/BrandingLinks";
import { BrandingScreenshots } from "../../content/pages/components/BrandingScreenshots";
import { ResolveContentGate } from "../../content/pages/components/ResolveContentDrawer";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import type { ContentRequirement } from "../../content/resolveContent";
import { useGamePresetParam } from "../../content/useGamePresetParam";
import { useImportParam } from "../../deeplink/useImportParam";
import { useRecordHubImport } from "../../hub/imports";
import {
  usePlayReadiness,
  usePreferredTarget,
  useSkirmishAis,
} from "../../play/config";
import { mergeGameAi } from "../../play/gameAi";
import { getGameMatcher, getProfile } from "../../profile/profile";
import { OptionSelect } from "../../uberstress/pages/components/OptionSelect";
import { conquestDelete, conquestSave } from "../bindings";
import {
  type ConquestChallengeSettings,
  decodeConquestChallenge,
  encodeConquestChallenge,
  encodeConquestChallengeFile,
  optionsFromChallenge,
} from "../challenge";
import { refreshGalaxies, useConquestState, useGalaxies } from "../conquests";
import { type GenerateOptions, generateGalaxy } from "../generate";
import type { ConquestState, GalaxyDoc } from "../model";
import { compareGameVersions, resolveGameByShortname } from "../model";
import { mergeConquestNames } from "../names";
import {
  DEFAULT_RADIUS_LY,
  RADIUS_CHOICES,
  systemCountWithin,
} from "../realstars";
import { GalaxyPreview2D } from "./components/GalaxyPreview2D";

/** Best-effort shortname/version match, mirroring `resolveGameByShortname`
 * (issue #387: the content-resolution step for a decoded challenge). */
function shortnameGameRequirement(
  game: ConquestChallengeSettings["game"],
): ContentRequirement {
  return {
    kind: "game",
    label: game.pinnedName ?? game.shortname,
    downloadKey: game.shortname,
    isInstalled: (installed) => {
      const matcher = getGameMatcher();
      const games = installed.games.filter((g) => !matcher || matcher(g.name));
      return (
        resolveGameByShortname(
          game,
          games.map((g) => ({
            name: g.name,
            info: { shortname: g.shortname ?? "", version: g.version ?? "" },
          })),
        ) !== undefined
      );
    },
  };
}

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
  // rapid installs (BAR et al.) live in packages/pool, not games/*.sd7. Shared
  // with the sidebar nav badge (issue #419) via `usePlayReadiness`, so the two
  // never disagree.
  const { target, ready } = usePlayReadiness();
  const needsGame = !ready;

  const runs = galaxies.filter((g) => file.conquests[g.galaxy.id]);
  const unstarted = galaxies.filter((g) => !file.conquests[g.galaxy.id]);

  // The single most recently updated run still in progress (issue #374's
  // "continue playing" affordance). Badged below, not a separate button,
  // since each run's card already links straight to it.
  const resumeGalaxyId = useMemo(
    () =>
      mostRecentOpen(
        runs,
        (g) => file.conquests[g.galaxy.id]?.status === "active",
        (g) => Date.parse(file.conquests[g.galaxy.id]?.updatedAt ?? ""),
      )?.galaxy.id,
    [runs, file],
  );

  // A confirmed `coilbox://import` deep link (issue #388) lands here with the
  // challenge code in the query string, and with the hub item it came from
  // alongside it when the hub browse screen started it (issue #1368).
  const { code: importCode, hubItemId } = useImportParam();
  const recordHubImport = useRecordHubImport();

  const openGenerate = (initialGameName?: string) =>
    drawer.open({
      title: "Generate a galaxy",
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
        <ImportChallengeForm
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
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => openImportChallenge()}>
              <Download className="mr-1.5 size-4" aria-hidden /> Import
              challenge
            </Button>
            <Button onClick={() => openGenerate()}>
              <Dices className="mr-1.5 size-4" aria-hidden /> Generate a galaxy
            </Button>
          </div>
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
                      resume={galaxy.id === resumeGalaxyId}
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
        <ChallengeCodeView
          code={challengeCode ?? ""}
          helpText="Anyone who pastes this code into Import challenge (needs the same game installed) plays the identical galaxy, so results are directly comparable."
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
            {galaxy.game.shortname} · {galaxy.nodes.length} systems ·{" "}
            {galaxy.factions.length} factions
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
  { value: "realstars", label: "Real stars (the solar neighbourhood)" },
];
// Real-star galaxies are sized by radius, not by node count: every system
// inside the radius is on the map. Counts come from the catalogue so they
// cannot drift from the data.
const RADIUS_OPTIONS = RADIUS_CHOICES.map((ly) => ({
  value: String(ly),
  label: `${ly} light years (${systemCountWithin(ly)} systems)`,
}));
const STYLE_OPTIONS = [
  { value: "galaxy", label: "Galaxy (starfield)" },
  { value: "theatre", label: "Theatre map (flat chart)" },
];
/** Sentinel for "let the generator decide" (the classic full-frontier start for
 * procedural galaxies, capital-only for real stars). An empty string cannot be
 * used: Radix Select reads it as no selection and falls back to the
 * placeholder, leaving the row looking blank. */
const STARTING_DEFAULT = "auto";
const STARTING_OPTIONS = [
  { value: STARTING_DEFAULT, label: "Full frontier (default)" },
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
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const brandingEntries = useBrandingCatalog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One wizard entry per shortname: the newest installed version represents
  // the game (battles always resolve "latest installed" at launch anyway).
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
  // Default to the preselected game (if it matches one on offer), else the
  // first game, so the create button is never a silent dead-end. The user
  // can still switch games via the select.
  const selected =
    gameChoices.find(
      (g) => (g.info.shortname ?? g.name).trim().toLowerCase() === gameShort,
    ) ??
    (initialGameName
      ? gameChoices.find((g) => g.name === initialGameName)
      : undefined) ??
    gameChoices[0];
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
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS_LY));
  const realStars = layout === "realstars";
  const [style, setStyle] = useState("galaxy");
  const [starting, setStarting] = useState(STARTING_DEFAULT);
  const [fog, setFog] = useState(false);
  const [seed, setSeed] = useState(() =>
    String(Math.floor(Math.random() * 100000)),
  );

  const { run: runScan, data: scanData, loading: scanLoading } = scan;
  useEffect(() => {
    if (!scanData && !scanLoading) runScan();
  }, [scanData, scanLoading, runScan]);

  // Excluded maps never enter the pool, so a generated galaxy cannot put the
  // player on one (see `content/mapEligibility`).
  const { eligible } = useMapEligibility();
  const maps = useMemo(
    () => eligible(scan.data?.maps ?? []),
    [scan.data, eligible],
  );

  // One options builder shared by the live preview and the create action, so
  // the galaxy the user saw is exactly the galaxy that gets saved.
  const genOptions = useCallback(
    (id: string): GenerateOptions => ({
      seed: Number(seed) || 1,
      game: { shortname: effectiveShort },
      maps,
      nodeCount: Number(size),
      factionCount: Number(factions),
      layout: layout as GenerateOptions["layout"],
      radiusLy: Number(radius),
      skin: style === "theatre" && !realStars ? "theatre" : "galaxy",
      startingSystems:
        starting === STARTING_DEFAULT ? undefined : Number(starting),
      fogOfWar: fog,
      names,
      id,
      title: `${effectiveShort} Conquest`,
    }),
    [
      seed,
      effectiveShort,
      maps,
      size,
      factions,
      layout,
      radius,
      realStars,
      style,
      starting,
      fog,
      names,
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
          {/* Reuse the same branding catalog art shown on game detail (issue
              #372), so the conquest setup feels like part of the game's world. */}
          {brandingEntry && <BrandingLinks entry={brandingEntry} />}
          {brandingEntry?.screenshots?.length ? (
            <BrandingScreenshots shots={brandingEntry.screenshots} />
          ) : null}
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Shape</span>
            <OptionSelect
              value={layout}
              onValueChange={setLayout}
              options={LAYOUT_OPTIONS}
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              {realStars ? "Radius from Sol" : "Galaxy size"}
            </span>
            {realStars ? (
              <OptionSelect
                value={radius}
                onValueChange={setRadius}
                options={RADIUS_OPTIONS}
              />
            ) : (
              <OptionSelect
                value={size}
                onValueChange={setSize}
                options={SIZE_OPTIONS}
              />
            )}
            {realStars && (
              <span className="text-xs text-muted-foreground">
                Every real system within the radius, at its true position. You
                start at Sol, in the middle.
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Opposition</span>
            <OptionSelect
              value={factions}
              onValueChange={setFactions}
              options={FACTION_OPTIONS}
            />
          </div>
          {!realStars && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Map style</span>
              <OptionSelect
                value={style}
                onValueChange={setStyle}
                options={STYLE_OPTIONS}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Starting systems</span>
            <OptionSelect
              value={starting}
              onValueChange={setStarting}
              options={
                realStars
                  ? [
                      {
                        value: STARTING_DEFAULT,
                        label: "Capital only (default)",
                      },
                      ...STARTING_OPTIONS.slice(1),
                    ]
                  : STARTING_OPTIONS
              }
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
              {realStars
                ? "The stars never change. The seed sets the factions, where your enemies start, and which maps each system is fought on."
                : "The same seed always builds the same galaxy."}
            </span>
          </div>
          {preview && !realStars && (
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

/**
 * Paste a challenge code, resolve it against the recipient's own install, and
 * generate the identical galaxy locally (issue #376). `installedGame` is
 * resolved from the decoded settings, not from the wizard's own game picker —
 * a challenge names its own game.
 *
 * SEAM FOR #387 (resolve missing content on import): the "game not installed"
 * branch below is exactly where a content-resolution/download flow belongs. It
 * currently just reports the gap; `optionsFromChallenge` (see `../challenge.ts`)
 * is the pure settings -> generator-options step #387's resolution result would
 * feed into unchanged.
 */
function ImportChallengeForm({
  onImported,
  initialCode,
}: {
  onImported: (id: string) => void;
  /** A confirmed `coilbox://` import code to prefill and run once (issue #388). */
  initialCode?: string;
}) {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const brandingEntries = useBrandingCatalog();
  const { eligible } = useMapEligibility();
  const [pending, setPending] = useState<ConquestChallengeSettings | null>(
    null,
  );

  const { run: runScan, data: scanData, loading: scanLoading } = scan;
  useEffect(() => {
    if (!scanData && !scanLoading) runScan();
  }, [scanData, scanLoading, runScan]);

  const finishImport = async (settings: ConquestChallengeSettings) => {
    if (!target) throw new Error("Install an engine first.");
    const matcher = getGameMatcher();
    const games = (scanData?.games ?? []).filter(
      (g) => !matcher || matcher(g.name),
    );
    const installedGame = resolveGameByShortname(settings.game, games);
    if (!installedGame) {
      throw new Error(
        `This challenge needs "${settings.game.shortname}", which isn't installed. Install it from Content → Games, then try again.`,
      );
    }

    const maps = eligible(scanData?.maps ?? []).map((m) => ({
      name: m.name,
      width: m.width,
      height: m.height,
    }));
    const { ais } = await unitsyncSkirmishAis({
      enginePath: target.enginePath,
      dataDir: target.dataDir,
      gameArchive: installedGame.primaryArchive.name,
    });
    const brandingEntry = resolveBranding(brandingEntries, installedGame);
    const names = mergeConquestNames(
      getProfile().conquest,
      brandingEntry?.conquest,
    );

    const id = `generated-${crypto.randomUUID()}`;
    const doc = generateGalaxy(
      optionsFromChallenge(
        settings,
        {
          maps,
          names,
        },
        id,
      ),
    );
    await conquestSave({
      id,
      json: JSON.stringify({ ...doc, importedChallenge: true }),
    });
    await refreshGalaxies();
    onImported(id);
  };

  // Decode the code, then either finish straight away (game already
  // installed — no pointless prompt) or hand off to the resolve gate, which
  // offers the download and calls `finishImport` once it clears (#387).
  const importChallenge = async (code: string) => {
    const result = decodeConquestChallenge(code);
    if (!result.ok) {
      throw new Error(challengeDecodeErrorMessage(result.error));
    }
    setPending(result.settings);
  };

  // Open a challenge file exported via exportChallengeFile above (#476), the
  // rest of the import (decode, resolve, generate) is identical to a pasted
  // code.
  const pickChallengeFile = async (): Promise<string | null> => {
    const src = await open({
      title: "Import challenge",
      multiple: false,
      filters: [{ name: "Coilbox challenge", extensions: ["json"] }],
    });
    if (typeof src !== "string") return null;
    const { text } = await challengeImport({ src });
    return text;
  };

  return (
    <>
      <ChallengeCodeInput
        helpText="Paste a challenge code shared by another player to generate the identical galaxy on your own install."
        initialCode={initialCode}
        onImport={importChallenge}
        onPickFile={pickChallengeFile}
      />
      {pending && (
        <ResolveContentGate
          title="Set up this challenge"
          requirements={[shortnameGameRequirement(pending.game)]}
          target={target ?? undefined}
          targetLoading={targetLoading}
          onContinue={() => finishImport(pending).then(() => setPending(null))}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
