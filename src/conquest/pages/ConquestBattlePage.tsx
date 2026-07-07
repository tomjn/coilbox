import { Button } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Download,
  Loader2,
  ShieldAlert,
  Swords,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { invalidateMapPreview, invalidateScans } from "../../content/config";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { type DownloadProgress, dlDownloadMap } from "../../downloads/bindings";
import { usePreferredTarget } from "../../play/config";
import { useConquestState, useGalaxies } from "../conquests";
import { factionSides } from "../galaxy3d/factionShape";
import type { ConquestState, GalaxyDoc, GalaxyNode } from "../model";
import { difficultyHandicap, difficultyTable } from "../rules";
import { useConquestBattleRun } from "../run";
import { FactionDot } from "./components/RunSetup";

/**
 * One strategic battle: briefing → launch → checking → result, mirroring the
 * campaign mission flow. The mode derives from the run state — defending when
 * the node is the active incursion's target, attacking otherwise. Victory and
 * defeat screens report the territorial consequence and return to the galaxy.
 */
export default function ConquestBattlePage() {
  const { id, nodeId } = useParams();
  const { galaxies, loading } = useGalaxies();
  const loaded = galaxies.find((g) => g.galaxy.id === id);

  if (loading) {
    return (
      <div className="p-4">
        <SkeletonList />
      </div>
    );
  }
  const node = loaded?.galaxy.nodes.find((n) => n.id === nodeId);
  if (!loaded || !node) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <EmptyState label="Battle not found." />
        <Link to="/conquest" className="text-sm text-primary hover:underline">
          Back to Conquest
        </Link>
      </div>
    );
  }
  return (
    <Battle
      key={`${loaded.galaxy.id}:${node.id}`}
      galaxy={loaded.galaxy}
      node={node}
    />
  );
}

function Battle({ galaxy, node }: { galaxy: GalaxyDoc; node: GalaxyNode }) {
  const { stateFor, loading } = useConquestState();
  const state = stateFor(galaxy);
  const mode: "attack" | "defend" =
    state?.incursion?.nodeId === node.id ? "defend" : "attack";
  const run = useConquestBattleRun(galaxy, state, node, mode);
  const navigate = useNavigate();

  const backToGalaxy = () =>
    navigate(`/conquest/${encodeURIComponent(galaxy.id)}`);

  if (!loading && !state) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <EmptyState label="This conquest has not been started yet." />
        <Link
          to={`/conquest/${encodeURIComponent(galaxy.id)}`}
          className="text-sm text-primary hover:underline"
        >
          Back to the galaxy
        </Link>
      </div>
    );
  }

  const enemyFactionId =
    mode === "defend" ? state?.incursion?.factionId : state?.owners[node.id];
  const enemyFaction = galaxy.factions.find((f) => f.id === enemyFactionId);
  const enemyCount =
    node.battle.enemyAiCount ?? difficultyTable(node.difficulty);
  const handicap = node.battle.handicap ?? difficultyHandicap(node.difficulty);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-br from-slate-900 to-slate-950">
      <div className="relative z-10 flex h-full min-h-0 flex-col items-center justify-center gap-4 p-4">
        <div className="flex w-[30rem] max-w-full flex-col gap-4 rounded-lg border border-border/50 bg-card/85 p-5 backdrop-blur-sm">
          <header className="flex flex-col gap-1">
            <Link
              to={`/conquest/${encodeURIComponent(galaxy.id)}`}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden /> {galaxy.title}
            </Link>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
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
                The outcome could not be read from the replay. How did the
                battle end?
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
              onContinue={backToGalaxy}
            />
          )}
        </div>
      </div>
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
  enemyCount,
  handicap,
  run,
}: {
  galaxy: GalaxyDoc;
  node: GalaxyNode;
  state: ConquestState | undefined;
  mode: "attack" | "defend";
  enemyName?: string;
  enemyColor?: string;
  enemySides?: number;
  enemyCount: number;
  handicap: number;
  run: ReturnType<typeof useConquestBattleRun>;
}) {
  const playerFaction = galaxy.factions.find(
    (f) => f.id === state?.playerFactionId,
  );
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Battlefield</dt>
          <dd className="truncate">{node.battle.mapName}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Opposition</dt>
          <dd className="flex items-center gap-1.5">
            <FactionDot color={enemyColor ?? "#6b7280"} sides={enemySides} />
            {enemyCount} × {enemyName ?? "garrison"}
            {handicap > 0 ? ` (+${handicap}%)` : ""}
          </dd>
        </div>
        {playerFaction && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Fighting for</dt>
            <dd className="flex items-center gap-1.5">
              <FactionDot
                color={playerFaction.color}
                sides={factionSides(galaxy, playerFaction.id)}
              />
              {playerFaction.name}
              {state?.playerSide ? ` · ${state.playerSide}` : ""}
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
            state?.owners[node.id] === state?.playerFactionId
              ? " — it is your homeworld"
              : ""}
            .
          </p>
        )}
      </dl>

      {run.error && <ErrorBanner message={run.error} />}

      {run.noEngine ? (
        <p className="text-sm text-muted-foreground">
          Install an engine first (Content → Engines).
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
  const newIncursion = resolved?.incursion;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h2
        className={`text-2xl font-bold ${won ? "text-emerald-400" : "text-red-400"}`}
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
      {resolved?.status === "active" && newIncursion && (
        <p className="flex items-center gap-1.5 text-sm text-amber-300">
          <ShieldAlert className="size-4" aria-hidden />
          Enemy incursion detected — check the galaxy map.
        </p>
      )}
      {autoDetected && (
        <p className="text-xs text-muted-foreground/70">
          Result detected from the replay.
        </p>
      )}
      <Button onClick={onContinue}>Return to the galaxy</Button>
    </div>
  );
}
