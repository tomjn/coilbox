import { Button, useDrawer } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { Download, ListTree, Loader2, ShieldAlert, Swords } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { FactionLogo } from "@/factions/FactionLogo";
import type { FactionLogoSrc } from "@/factions/fallback";
import { useFactionLogos } from "@/factions/logos";
import { buildEdgeMap, reachableFrom } from "../../../content/buildTree";
import {
  invalidateMapPreview,
  invalidateScans,
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "../../../content/config";
import { ErrorBanner } from "../../../content/pages/components/states";
import { TechTreePicker } from "../../../content/pages/components/TechTreePicker";
import {
  type DownloadProgress,
  dlDownloadMap,
} from "../../../downloads/bindings";
import { usePreferredTarget } from "../../../play/config";
import { SaveAsPresetButton } from "../../../play/pages/components/SaveAsPresetButton";
import { factionSides } from "../../galaxy3d/factionShape";
import type { ConquestState, GalaxyDoc, GalaxyNode } from "../../model";
import { resolveGameByShortname } from "../../model";
import { difficultyHandicap, difficultyTable } from "../../rules";
import { useConquestBattleRun } from "../../run";
import { BackToMapButton } from "./BackToMapButton";
import { BracketFrame } from "./hudChrome";
import { FactionDot } from "./RunSetup";

/**
 * The strategic battle briefing, rendered as an overlay *on the galaxy map*
 * (the map stays live behind it, camera zoomed on the contested system) rather
 * than a separate screen. briefing → launch → checking → result, mirroring the
 * campaign mission flow; the mode is passed in (defend when the node is the
 * active incursion's target, attack otherwise). On a resolved outcome the run
 * hook advances and persists the conquest, then `onClose` returns to the map.
 */
export function BattleOverlay({
  galaxy,
  node,
  state,
  mode,
  onClose,
}: {
  galaxy: GalaxyDoc;
  node: GalaxyNode;
  state: ConquestState;
  mode: "attack" | "defend";
  onClose: () => void;
}) {
  const run = useConquestBattleRun(galaxy, state, node, mode);
  const drawer = useDrawer();

  const enemyFactionId =
    mode === "defend"
      ? state.incursions.find((i) => i.nodeId === node.id)?.factionId
      : state.owners[node.id];
  const enemyFaction = galaxy.factions.find((f) => f.id === enemyFactionId);
  const enemyCount =
    node.battle.enemyAiCount ?? difficultyTable(node.difficulty);
  const handicap = node.battle.handicap ?? difficultyHandicap(node.difficulty);

  // Faction emblems for the briefing rows (chosen faction + opposition), by side.
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const installedGame = resolveGameByShortname(
    galaxy.game,
    scan.data?.games ?? [],
  );
  const factionLogos = useFactionLogos({
    game: installedGame ?? undefined,
    enginePath: target?.enginePath,
    dataDir: target?.dataDir,
    gameArchive: installedGame?.primaryArchive.name,
    sideNames: [state.playerSide, enemyFaction?.side].filter(
      (s): s is string => !!s,
    ),
  });
  const playerLogo = state.playerSide
    ? factionLogos[state.playerSide.toLowerCase()]
    : undefined;
  const enemyLogo = enemyFaction?.side
    ? factionLogos[enemyFaction.side.toLowerCase()]
    : undefined;

  // Read-only tech tree (issue #489). Conquest has no persistent unlock set
  // like warpath's unlockedUnits, so a node's authored disabledUnits
  // restriction stands in as its "opaque id set" (see #377). Light the
  // complement, the units still usable in this fight, against the player's
  // faction tree.
  const dataset = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    installedGame?.primaryArchive.name,
  );
  const gameInfo = useUnitsyncGameInfo(
    target?.enginePath,
    target?.dataDir,
    installedGame?.primaryArchive.name,
  );
  const playerStartUnit = state.playerSide
    ? gameInfo.info?.sides.find(
        (s) => s.name.toLowerCase() === state.playerSide?.toLowerCase(),
      )?.startUnit
    : undefined;
  // Scope to the player's own faction tree when it's known, dropping other
  // factions' units so they don't clutter an "Other units" bucket. Otherwise
  // fall back to the whole dataset, still grouped sensibly by TechTreePicker.
  const techUnits = useMemo(() => {
    const units = dataset.dataset?.units ?? [];
    if (!playerStartUnit) return units;
    const reachable = reachableFrom(playerStartUnit, buildEdgeMap(units));
    return units.filter((u) => reachable.has(u.name.toLowerCase()));
  }, [dataset.dataset, playerStartUnit]);
  const availableUnits = useMemo(() => {
    const disabled = new Set(
      (node.battle.disabledUnits ?? []).map((u) => u.toLowerCase()),
    );
    return techUnits
      .map((u) => u.name.toLowerCase())
      .filter((id) => !disabled.has(id));
  }, [techUnits, node.battle.disabledUnits]);
  const openTechTree = installedGame
    ? () =>
        drawer.open({
          title: "Available units",
          description:
            "Units usable in this fight, lit up against your faction's build tree. Restricted units stay unlit.",
          width: "40rem",
          content: (
            <TechTreePicker
              units={techUnits}
              roots={playerStartUnit ? [playerStartUnit] : []}
              selected={availableUnits}
              selectedLabel="available"
              enginePath={target?.enginePath}
              dataDir={target?.dataDir}
              gameArchive={installedGame.primaryArchive.name}
            />
          ),
        })
    : undefined;

  return (
    // A transparent full-bleed layer captures clicks (so the map beneath isn't
    // selectable while briefing) but lets the zoomed star show through. The card
    // sticks to the bottom so it doesn't cover the focused system.
    <div className="absolute inset-0 z-20 flex items-end justify-center p-4 pb-8">
      {/* Clicking the map (anywhere outside the card) dismisses the briefing,
          matching the run map. Nothing has committed yet, so backing out is
          free. */}
      <button
        type="button"
        aria-label="Back to map"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <BracketFrame className="flex w-[30rem] max-w-full flex-col gap-4 p-5 backdrop-blur-sm">
        {/* Its own box in the gutter to the card's left, matching the map's
            top-left exit control. */}
        <BackToMapButton
          onClick={onClose}
          className="absolute right-full top-0 mr-4"
        />
        {/* Its own gutter box beneath the back arrow — save this fight as a
            skirmish preset to replay later. Prefers the exact draft last launched
            (so an outcome save captures the fight as fought, not the node's
            now-advanced next matchup), else the live briefing snapshot. */}
        {run.installedGame && (
          <SaveAsPresetButton
            appearance="gutter"
            getDraft={() => run.lastSnapshot ?? run.snapshot()}
            defaultName={`${node.name} vs ${enemyFaction?.name ?? "garrison"}`}
            className="absolute right-full top-16 mr-4"
          />
        )}
        {/* Another gutter box beneath the preset save button. Read-only lit
            tree of units still usable in this fight (issue #489). */}
        {openTechTree && (
          <button
            type="button"
            onClick={openTechTree}
            aria-label="View available units"
            title="View tech tree"
            className="pointer-events-auto absolute right-full top-32 mr-4 flex items-center justify-center rounded-md border border-border/50 bg-card/70 p-3.5 text-muted-foreground backdrop-blur-sm transition-colors hover:border-border hover:text-foreground"
          >
            <ListTree className="size-5" aria-hidden />
          </button>
        )}
        <header className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 font-display text-lg font-semibold uppercase tracking-wide">
            {mode === "defend" ? (
              <ShieldAlert className="size-5 text-amber-400" aria-hidden />
            ) : (
              <Swords className="size-5 text-primary" aria-hidden />
            )}
            {mode === "defend" ? "Defend" : "Attack"} {node.name}
          </h1>
          {node.blurb && (
            <p className="text-sm text-muted-foreground">{node.blurb}</p>
          )}
        </header>

        {run.phase === "briefing" && (
          <Briefing
            galaxy={galaxy}
            node={node}
            state={state}
            mode={mode}
            enemyName={enemyFaction?.name}
            enemyColor={enemyFaction?.color}
            enemySides={
              enemyFaction ? factionSides(galaxy, enemyFaction.id) : 0
            }
            enemyLogo={enemyLogo}
            playerLogo={playerLogo}
            enemyCount={enemyCount}
            handicap={handicap}
            run={run}
          />
        )}
        {run.phase === "checking" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Reading the battle report…
          </div>
        )}
        {run.phase === "result" && (
          <div className="flex flex-col gap-3">
            {run.error && <ErrorBanner message={run.error} />}
            <p className="text-sm text-muted-foreground">
              The outcome could not be read from the replay. How did the battle
              end?
            </p>
            <div className="flex gap-2">
              <Button disabled={run.saving} onClick={run.recordVictory}>
                Victory
              </Button>
              <Button
                variant="outline"
                disabled={run.saving}
                onClick={run.recordDefeat}
              >
                Defeat
              </Button>
            </div>
          </div>
        )}
        {(run.phase === "victory" || run.phase === "defeat") && (
          <Outcome
            phase={run.phase}
            mode={mode}
            node={node}
            resolved={run.resolved}
            autoDetected={run.autoDetected}
            onContinue={onClose}
          />
        )}
      </BracketFrame>
    </div>
  );
}

function Briefing({
  galaxy,
  node,
  state,
  mode,
  enemyName,
  enemyColor,
  enemySides,
  enemyLogo,
  playerLogo,
  enemyCount,
  handicap,
  run,
}: {
  galaxy: GalaxyDoc;
  node: GalaxyNode;
  state: ConquestState;
  mode: "attack" | "defend";
  enemyName?: string;
  enemyColor?: string;
  enemySides?: number;
  enemyLogo?: FactionLogoSrc;
  playerLogo?: FactionLogoSrc;
  enemyCount: number;
  handicap: number;
  run: ReturnType<typeof useConquestBattleRun>;
}) {
  const playerFaction = galaxy.factions.find(
    (f) => f.id === state.playerFactionId,
  );
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Battlefield
          </dt>
          <dd className="truncate">{node.battle.mapName}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Opposition
          </dt>
          <dd className="flex items-center gap-1.5">
            {enemyLogo ? (
              <FactionLogo logo={enemyLogo} sideName={enemyName} size={16} />
            ) : (
              <FactionDot color={enemyColor ?? "#6b7280"} sides={enemySides} />
            )}
            {enemyCount} × {enemyName ?? "garrison"}
            {handicap > 0 ? ` (+${handicap}%)` : ""}
          </dd>
        </div>
        {playerFaction && (
          <div className="flex justify-between gap-2">
            <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Fighting for
            </dt>
            <dd className="flex items-center gap-1.5">
              {playerLogo ? (
                <FactionLogo
                  logo={playerLogo}
                  sideName={state.playerSide}
                  size={16}
                />
              ) : (
                <FactionDot
                  color={playerFaction.color}
                  sides={factionSides(galaxy, playerFaction.id)}
                />
              )}
              {playerFaction.name}
              {state.playerSide ? ` · ${state.playerSide}` : ""}
            </dd>
          </div>
        )}
        {mode === "attack" && (
          <p className="text-xs text-muted-foreground">
            Defeat costs nothing but the turn — the enemy may move.
          </p>
        )}
        {mode === "defend" && (
          <p className="text-xs text-amber-300/90">
            Lose this defence and the system falls
            {node.kind === "capital" &&
            state.owners[node.id] === state.playerFactionId
              ? " — it is your homeworld"
              : ""}
            .
          </p>
        )}
      </dl>

      {run.error && <ErrorBanner message={run.error} />}

      {run.noEngine ? (
        <p className="text-sm text-muted-foreground">
          Install an engine first (
          <Link className="underline underline-offset-4" to="/settings/engines">
            Settings → Engines
          </Link>
          ).
        </p>
      ) : run.missing ? (
        <RequirementGate node={node} run={run} />
      ) : run.canStart ? (
        <Button onClick={run.start} className="w-full">
          <Swords className="mr-1.5 size-4" aria-hidden /> Launch battle
        </Button>
      ) : (
        <Button disabled className="w-full">
          <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
          {run.running
            ? "A game is already running"
            : run.scanLoading
              ? "Scanning content…"
              : run.ais.length === 0
                ? "No skirmish AI available"
                : "Preparing…"}
        </Button>
      )}
    </div>
  );
}

/** Install gate: a missing map downloads inline; a missing game links to the
 * Downloads page (games are bigger decisions than a map fetch). */
function RequirementGate({
  node,
  run,
}: {
  node: GalaxyNode;
  run: ReturnType<typeof useConquestBattleRun>;
}) {
  const { target } = usePreferredTarget();
  const missing = run.missing;
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!missing) return null;

  const download = async () => {
    setDownloading(true);
    setProgress(null);
    setError(null);
    const onProgress = new Channel<DownloadProgress>();
    onProgress.onmessage = (p) => setProgress(p);
    try {
      await dlDownloadMap({
        springName: node.battle.mapDownload?.springName ?? node.battle.mapName,
        searchUrl: node.battle.mapDownload?.searchUrl,
        onProgress,
      });
      invalidateScans();
      if (target?.enginePath && target?.dataDir) {
        invalidateMapPreview(
          target.enginePath,
          target.dataDir,
          node.battle.mapName,
        );
      }
      await run.recheck();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {missing.kind === "map" ? "Map" : "Game"} not installed:{" "}
        <span className="text-foreground">{missing.name}</span>
      </p>
      {error && <ErrorBanner message={error} />}
      {missing.kind === "map" ? (
        <Button onClick={download} disabled={downloading} className="w-full">
          <Download className="mr-1.5 size-4" aria-hidden />
          {downloading
            ? progress?.percent != null
              ? `Downloading… ${Math.round(progress.percent)}%`
              : "Downloading…"
            : "Download map"}
        </Button>
      ) : (
        <Link to="/downloads/games">
          <Button variant="outline" className="w-full">
            <Download className="mr-1.5 size-4" aria-hidden /> Open game
            downloads
          </Button>
        </Link>
      )}
    </div>
  );
}

function Outcome({
  phase,
  mode,
  node,
  resolved,
  autoDetected,
  onContinue,
}: {
  phase: "victory" | "defeat";
  mode: "attack" | "defend";
  node: GalaxyNode;
  resolved: ConquestState | null;
  autoDetected: boolean;
  onContinue: () => void;
}) {
  const won = phase === "victory";
  const consequence = won
    ? mode === "attack"
      ? `${node.name} is yours.`
      : `The incursion at ${node.name} is repelled.`
    : mode === "attack"
      ? `The assault on ${node.name} failed. Your territory holds.`
      : `${node.name} has fallen.`;
  const hasIncursion = (resolved?.incursions.length ?? 0) > 0;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h2
        className={`font-display text-2xl font-bold uppercase tracking-wide ${won ? "text-emerald-400" : "text-red-400"}`}
      >
        {won ? "Victory" : "Defeat"}
      </h2>
      <p className="text-sm text-muted-foreground">{consequence}</p>
      {resolved?.status === "won" && (
        <p className="text-sm text-emerald-300">
          Every enemy capital has fallen — the galaxy is yours.
        </p>
      )}
      {resolved?.status === "lost" && (
        <p className="text-sm text-red-300">Your capital is lost.</p>
      )}
      {resolved?.status === "active" && hasIncursion && (
        <p className="flex items-center gap-1.5 text-sm text-amber-300">
          <ShieldAlert className="size-4" aria-hidden />
          Enemy incursion detected — check the galaxy map.
        </p>
      )}
      {autoDetected && (
        <p className="text-xs text-muted-foreground">
          Result detected from the replay.
        </p>
      )}
      <Button onClick={onContinue}>Return to the galaxy</Button>
    </div>
  );
}
