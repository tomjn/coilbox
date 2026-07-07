import { Button } from "@picoframe/frame";
import { ArrowLeft, ShieldAlert, Swords } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useUnitsyncScan } from "../../content/config";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import {
  useEffectsEnabled,
  usePerformanceMode,
  useReduceMotion,
} from "../../general/display";
import { assetUrl } from "../../lib/assetUrl";
import { usePreferredTarget } from "../../play/config";
import { useConquestState, useGalaxies } from "../conquests";
import { GalaxyView, starTypeFor } from "../galaxy3d/GalaxyView";
import type { ConquestState, GalaxyDoc, GalaxyNode } from "../model";
import {
  NEUTRAL,
  newConquestState,
  playableFactions,
  resolveGameByShortname,
} from "../model";
import { attackableNodes } from "../rules";
import { FactionDot, SidePicker } from "./components/RunSetup";

/**
 * The strategic map page: the full-bleed 3D galaxy with HTML overlays — a
 * status bar (turn, territory tallies, incursion warning), a right-hand
 * selection panel with the Attack/Defend call-to-action, and the run-start
 * panel (faction + side choice over a live preview) when this galaxy has no
 * run yet.
 */
export default function GalaxyPage() {
  const { id } = useParams();
  const { galaxies, loading, error } = useGalaxies();
  const loaded = galaxies.find((g) => g.galaxy.id === id);

  if (loading) {
    return (
      <div className="p-4">
        <SkeletonList />
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {error && <ErrorBanner message={error} />}
        <EmptyState label="Galaxy not found." />
        <Link to="/conquest" className="text-sm text-primary hover:underline">
          Back to Conquest
        </Link>
      </div>
    );
  }
  return <GalaxyScreen key={loaded.galaxy.id} galaxy={loaded.galaxy} />;
}

function GalaxyScreen({ galaxy }: { galaxy: GalaxyDoc }) {
  const { loading, stateFor, saveFor } = useConquestState();
  const state = stateFor(galaxy);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Faction preview while setting up a run (before any state exists).
  const [setupFaction, setSetupFaction] = useState(galaxy.playerFactionId);
  const reduceMotion = useReduceMotion();
  const effects = useEffectsEnabled();
  const performanceMode = usePerformanceMode();

  const playerFactionId = state?.playerFactionId ?? setupFaction;
  const owners = useMemo(
    () =>
      state?.owners ??
      Object.fromEntries(galaxy.nodes.map((n) => [n.id, n.owner])),
    [state, galaxy],
  );
  const attackable = useMemo(() => {
    if (!state || state.status !== "active") return new Set<string>();
    return new Set(attackableNodes(galaxy, state).map((n) => n.id));
  }, [galaxy, state]);

  const selected = galaxy.nodes.find((n) => n.id === selectedId);

  return (
    <div className="relative h-full overflow-hidden bg-[#05070f]">
      <GalaxyView
        galaxy={galaxy}
        owners={owners}
        playerFactionId={playerFactionId}
        selectedId={selectedId}
        incursion={state?.incursion}
        onSelect={setSelectedId}
        display={{ reduceMotion, effects, performanceMode }}
        className="absolute inset-0"
      />
      {effects && <AmbienceAudio galaxy={galaxy} />}

      {/* Top status bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 p-3">
        <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border/50 bg-card/80 px-3 py-2 backdrop-blur-sm">
          <Link
            to="/conquest"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Conquest
          </Link>
          <span className="text-sm font-medium">{galaxy.title}</span>
          {state && (
            <span className="text-xs text-muted-foreground">
              Turn {state.turn}
            </span>
          )}
          {state && <TerritoryTally galaxy={galaxy} state={state} />}
        </div>
        {state?.incursion && state.status === "active" && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-950/70 px-3 py-2 text-xs text-amber-200 backdrop-blur-sm">
            <ShieldAlert className="size-4 animate-pulse" aria-hidden />
            Incursion at{" "}
            {galaxy.nodes.find((n) => n.id === state.incursion?.nodeId)?.name ??
              "?"}{" "}
            — falls in {Math.max(0, state.incursion.expiresOnTurn - state.turn)}{" "}
            turn
            {state.incursion.expiresOnTurn - state.turn === 1 ? "" : "s"}
          </div>
        )}
      </div>

      {/* Right-hand selection panel */}
      {state && selected && state.status === "active" && (
        <SelectionPanel
          galaxy={galaxy}
          state={state}
          node={selected}
          attackable={attackable.has(selected.id)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Run setup (no state yet) */}
      {!state && !loading && (
        <RunSetupPanel
          galaxy={galaxy}
          faction={setupFaction}
          onFaction={setSetupFaction}
          onStart={async (playerSide) => {
            await saveFor(
              galaxy.id,
              newConquestState(galaxy, {
                playerFactionId: setupFaction,
                playerSide,
                seed: Math.floor(Math.random() * 2 ** 31),
              }),
            );
          }}
        />
      )}

      {/* Terminal states */}
      {state && state.status !== "active" && (
        <EndScreen
          galaxy={galaxy}
          state={state}
          onRestart={() => saveFor(galaxy.id, undefined)}
        />
      )}

      <p className="pointer-events-none absolute bottom-2 left-3 z-10 text-[11px] text-muted-foreground/70">
        drag to pan · scroll to zoom · right-drag to tilt
      </p>
    </div>
  );
}

/** Per-faction node counts as coloured dots in the status bar. */
function TerritoryTally({
  galaxy,
  state,
}: {
  galaxy: GalaxyDoc;
  state: ConquestState;
}) {
  const counts = new Map<string, number>();
  for (const n of galaxy.nodes) {
    const o = state.owners[n.id] ?? NEUTRAL;
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return (
    <span className="flex items-center gap-2.5">
      {galaxy.factions.map((f) => (
        <span
          key={f.id}
          className={`flex items-center gap-1 text-xs ${
            f.id === state.playerFactionId
              ? "font-medium text-foreground"
              : "text-muted-foreground"
          }`}
          title={f.name}
        >
          <FactionDot color={f.color} />
          {f.id === state.playerFactionId && (
            <span className="uppercase tracking-wide text-[10px]">You</span>
          )}
          {counts.get(f.id) ?? 0}
        </span>
      ))}
      {(counts.get(NEUTRAL) ?? 0) > 0 && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <FactionDot color="#6b7280" />
          {counts.get(NEUTRAL)}
        </span>
      )}
    </span>
  );
}

function DifficultyPips({ value }: { value: number }) {
  return (
    <span
      className="flex gap-0.5"
      role="img"
      aria-label={`Difficulty ${value} of 5`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-3 rounded-sm ${
            i <= value ? "bg-amber-400" : "bg-muted"
          }`}
        />
      ))}
    </span>
  );
}

function SelectionPanel({
  galaxy,
  state,
  node,
  attackable,
  onClose,
}: {
  galaxy: GalaxyDoc;
  state: ConquestState;
  node: GalaxyNode;
  attackable: boolean;
  onClose: () => void;
}) {
  const owner = state.owners[node.id] ?? NEUTRAL;
  const faction = galaxy.factions.find((f) => f.id === owner);
  const isPlayers = owner === state.playerFactionId;
  const underIncursion = state.incursion?.nodeId === node.id;

  return (
    <aside className="absolute right-3 top-16 z-10 flex w-72 flex-col gap-3 rounded-lg border border-border/50 bg-card/85 p-4 backdrop-blur-sm">
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">{node.name}</h2>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FactionDot color={faction?.color ?? "#6b7280"} />
            {faction?.name ?? "Unclaimed"}
            {node.kind === "capital" && " · Capital"}
          </span>
          <span className="text-xs capitalize text-muted-foreground/70">
            {starTypeFor(node.id, node.kind === "capital").name}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          ×
        </Button>
      </header>
      <dl className="flex flex-col gap-1.5 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Difficulty</dt>
          <dd>
            <DifficultyPips value={node.difficulty} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Battlefield</dt>
          <dd className="truncate">{node.battle.mapName}</dd>
        </div>
      </dl>
      {node.blurb && (
        <p className="text-xs text-muted-foreground">{node.blurb}</p>
      )}
      {underIncursion ? (
        <Link
          to={`/conquest/${encodeURIComponent(galaxy.id)}/battle/${encodeURIComponent(node.id)}`}
        >
          <Button className="w-full">
            <ShieldAlert className="mr-1.5 size-4" aria-hidden /> Defend
          </Button>
        </Link>
      ) : attackable ? (
        <Link
          to={`/conquest/${encodeURIComponent(galaxy.id)}/battle/${encodeURIComponent(node.id)}`}
        >
          <Button className="w-full">
            <Swords className="mr-1.5 size-4" aria-hidden /> Attack
          </Button>
        </Link>
      ) : isPlayers ? (
        <p className="text-xs text-muted-foreground">
          Under your control
          {node.kind === "capital" ? " — your homeworld." : "."}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Out of reach — capture an adjacent system first.
        </p>
      )}
    </aside>
  );
}

/** Faction + in-game side choice over the live galaxy preview. */
function RunSetupPanel({
  galaxy,
  faction,
  onFaction,
  onStart,
}: {
  galaxy: GalaxyDoc;
  faction: string;
  onFaction: (id: string) => void;
  onStart: (playerSide: string | undefined) => Promise<void>;
}) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { run: runScan, data: scanData, loading: scanLoading } = scan;
  useEffect(() => {
    if (!scanData && !scanLoading) runScan();
  }, [scanData, scanLoading, runScan]);
  const [side, setSide] = useState("");
  const [busy, setBusy] = useState(false);
  const choices = playableFactions(galaxy);
  const installedGame = resolveGameByShortname(
    galaxy.game,
    scan.data?.games ?? [],
  );

  return (
    <div className="absolute inset-x-0 bottom-8 z-10 mx-auto flex w-[26rem] max-w-[90%] flex-col gap-3 rounded-lg border border-border/50 bg-card/90 p-4 backdrop-blur-sm">
      <h2 className="text-sm font-semibold">Begin conquest</h2>
      <p className="text-xs text-muted-foreground">{galaxy.description}</p>
      {choices.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Play as</span>
          <div className="flex flex-wrap gap-1.5">
            {choices.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onFaction(f.id)}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                  faction === f.id
                    ? "border-primary bg-primary/15"
                    : "border-border/50 hover:border-border"
                }`}
              >
                <FactionDot color={f.color} />
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <SidePicker
        enginePath={target?.enginePath}
        dataDir={target?.dataDir}
        gameArchive={installedGame?.primaryArchive.name}
        value={side}
        onChange={setSide}
      />
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onStart(side || undefined);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Starting…" : "Start conquest"}
      </Button>
    </div>
  );
}

function EndScreen({
  galaxy,
  state,
  onRestart,
}: {
  galaxy: GalaxyDoc;
  state: ConquestState;
  onRestart: () => void;
}) {
  const won = state.status === "won";
  const battles = state.history.length;
  const victories = state.history.filter((h) => h.outcome === "victory").length;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="flex w-[26rem] max-w-[90%] flex-col items-center gap-3 rounded-lg border border-border/50 bg-card/95 p-6 text-center">
        <h2
          className={`text-2xl font-bold ${won ? "text-emerald-400" : "text-red-400"}`}
        >
          {won ? "Galaxy conquered" : "Conquest lost"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {won
            ? "Every enemy capital has fallen. The galaxy is yours."
            : "Your capital has fallen."}{" "}
          {battles} battle{battles === 1 ? "" : "s"} fought over {state.turn}{" "}
          turn{state.turn === 1 ? "" : "s"}, {victories} won.
        </p>
        <div className="flex gap-2">
          <Button onClick={onRestart}>Start again</Button>
          <Link to="/conquest">
            <Button variant="outline">Back to Conquest</Button>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground/70">
          Starting again resets {galaxy.title} with a new seed.
        </p>
      </div>
    </div>
  );
}

/**
 * Author-supplied looping ambience for the galaxy (theme.ambience). Only
 * `local` (portable `.coilbox` media, served by `coilbox://`) and `data` refs
 * resolve — conquest has no per-document media store. Rendered only while
 * ambient effects are enabled; volume kept low so it stays atmosphere.
 */
function AmbienceAudio({ galaxy }: { galaxy: GalaxyDoc }) {
  const ambience = galaxy.theme?.ambience;
  const src =
    ambience?.kind === "local"
      ? assetUrl(ambience.path)
      : ambience?.kind === "data"
        ? ambience.dataUri
        : undefined;
  if (!src) return null;
  return (
    // biome-ignore lint/a11y/useMediaCaption: decorative looping ambience, no speech to caption
    <audio
      aria-hidden
      src={src}
      autoPlay
      loop
      ref={(el) => {
        if (el) el.volume = 0.3;
      }}
    />
  );
}
