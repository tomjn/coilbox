import { Button, useHideSidebar } from "@picoframe/frame";
import {
  ArrowLeft,
  Dices,
  Hourglass,
  Loader2,
  ShieldAlert,
  Swords,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { FactionLogo } from "@/factions/FactionLogo";
import type { FactionLogoSrc } from "@/factions/fallback";
import { useFactionLogos } from "@/factions/logos";
import { SubstitutedMapNote } from "../../challenge/SubstitutedMapNote";
import { resolveBranding, useBrandingCatalog } from "../../content/branding";
import { useUnitsyncGameInfo, useUnitsyncScan } from "../../content/config";
import { useKnownSpaceMaps } from "../../content/mapAppearanceCache";
import { useMapEligibility } from "../../content/mapEligibility";
import { ReplayHistoryList } from "../../content/pages/components/ReplayHistoryList";
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
import { getProfile } from "../../profile/profile";
import { conquestSave } from "../bindings";
import { refreshGalaxies, useConquestState, useGalaxies } from "../conquests";
import { factionFocusNode } from "../focusTarget";
import { FOG_RANGE, withinJumps } from "../fog";
import { isVoidNode, type VoidBody, voidBodiesFor } from "../galaxy3d/bodies";
import { factionSides } from "../galaxy3d/factionShape";
import { GalaxyView, nodeBodyLabel } from "../galaxy3d/GalaxyView";
import { galaxyPalette } from "../galaxy3d/palette";
import {
  regenerateGalaxy,
  restoreChallengeMap,
  substituteExcludedMaps,
} from "../generate";
import type { ConquestState, GalaxyDoc, GalaxyNode, TurnEvent } from "../model";
import {
  NEUTRAL,
  newConquestState,
  playableFactions,
  resolveGameByShortname,
} from "../model";
import { mergeConquestNames } from "../names";
import { advanceTurn, attackableNodes } from "../rules";
import { BattleOverlay } from "./components/BattleOverlay";
import {
  BracketFrame,
  HUD_ACCENT_INK,
  MAP_BAND_CLASS,
  MAP_DIM_INK_CLASS,
  MAP_INK_CLASS,
} from "./components/hudChrome";
import { FactionDot, SidePicker } from "./components/RunSetup";

/**
 * The strategic map page: the full-bleed 3D galaxy with HTML overlays — a
 * status bar (turn, territory tallies, incursion warning), a right-hand
 * selection panel with the Attack/Defend call-to-action, and the run-start
 * panel (faction + side choice over a live preview) when this galaxy has no
 * run yet.
 */
export default function GalaxyPage() {
  // The galaxy is full-bleed. The nav stays reachable from the top bar.
  useHideSidebar();
  const { id } = useParams();
  const { galaxies, loading, error } = useGalaxies();
  const loaded = galaxies.find((g) => g.galaxy.id === id);
  // A saved galaxy can outlive the map rules it was generated under, so nodes
  // sitting on a now-excluded map are re-pointed on the way in (issue #696).
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { isExcluded } = useMapEligibility();
  const galaxy = useMemo(
    () =>
      loaded &&
      substituteExcludedMaps(loaded.galaxy, scan.data?.maps ?? [], isExcluded),
    [loaded, scan.data, isExcluded],
  );

  if (loading) {
    return (
      <div className="p-4">
        <SkeletonList />
      </div>
    );
  }
  if (!loaded || !galaxy) {
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
  return <GalaxyScreen key={galaxy.id} galaxy={galaxy} />;
}

function GalaxyScreen({ galaxy }: { galaxy: GalaxyDoc }) {
  const { loading, stateFor, saveFor } = useConquestState();
  const state = stateFor(galaxy);
  // A replay's "back to node" link deep-links here as `?node=<id>`, honoured
  // once on mount so the selection panel opens straight to it. A stale id (the
  // node no longer exists) just finds nothing and the panel stays closed.
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    searchParams.get("node"),
  );
  // Faction preview while setting up a run (before any state exists).
  const [setupFaction, setSetupFaction] = useState(galaxy.playerFactionId);
  const reduceMotion = useReduceMotion();
  const effects = useEffectsEnabled();
  const performanceMode = usePerformanceMode();
  // Space maps (voidwater) render as asteroid/comet nodes. This machine's own
  // answer for the maps it has, and the hub's catalog for the rest, so a galaxy
  // of maps nobody here has installed still draws asteroids (issue #1739).
  const nodeMaps = useMemo(
    () => galaxy.nodes.map((n) => n.battle.mapName).filter(Boolean),
    [galaxy.nodes],
  );
  const spaceMaps = useKnownSpaceMaps(nodeMaps);
  // Galaxy-wide void bodies (guarantees a comet when any node is a space map);
  // used for the selection-panel label so it matches the rendered body.
  const voidBodies = useMemo(
    () =>
      voidBodiesFor(
        galaxy.nodes.filter((n) => isVoidNode(n, spaceMaps)).map((n) => n.id),
      ),
    [galaxy, spaceMaps],
  );

  const playerFactionId = state?.playerFactionId ?? setupFaction;
  const owners = useMemo(
    () =>
      state?.owners ??
      Object.fromEntries(galaxy.nodes.map((n) => [n.id, n.owner])),
    [state, galaxy],
  );
  const attackable = useMemo(() => {
    if (state?.status !== "active") return new Set<string>();
    return new Set(attackableNodes(galaxy, state).map((n) => n.id));
  }, [galaxy, state]);

  // Faction emblems for the header cards: resolve each side's logo from the
  // installed game (archive Sidepics / catalog / bundled vector), tinted per
  // faction so two factions on the same game side stay distinct. Served from
  // the shared scan cache, so this doesn't re-scan when the setup panel already
  // did (see useUnitsyncScan).
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
    sideNames: galaxy.factions.map((f) => f.side ?? "").filter(Boolean),
    size: 20,
  });

  // A faction header card flies the camera to that faction's territory; another
  // map interaction (selecting a node / clicking empty space) releases it.
  const [factionFocus, setFactionFocus] = useState<string | null>(null);

  // Put a system standing in for a challenge's map back on that map, once this
  // install has it (issue #1834). Written to the document rather than the run
  // state, because the map a system fights on is part of the galaxy. A bundled
  // galaxy never carries a substitution, so the identity check keeps this from
  // ever writing a local copy of a read-only one.
  const restoreMap = async (nodeId: string) => {
    const doc = restoreChallengeMap(galaxy, nodeId);
    if (doc === galaxy) return;
    await conquestSave({ id: doc.id, json: JSON.stringify(doc) });
    await refreshGalaxies();
  };

  // Fog of war: the systems the player can see. Undefined = no fog (show all),
  // which is also how a finished run reveals the whole map. During setup (no
  // state) preview visibility around the faction being previewed.
  const visibleIds = useMemo(() => {
    if (!galaxy.rules?.fogOfWar) return undefined;
    if (state) {
      if (state.status !== "active") return undefined;
      return new Set(state.revealed ?? []);
    }
    const owned = galaxy.nodes
      .filter((n) => owners[n.id] === playerFactionId)
      .map((n) => n.id);
    return withinJumps(galaxy, owned, FOG_RANGE);
  }, [galaxy, state, owners, playerFactionId]);

  // Give each space galaxy its own backdrop palette (varied nebula + starfield
  // tints) unless its theme already sets one — so a fresh galaxy reads as its
  // own place instead of the single restrained default. Only the render doc is
  // themed; all strategic logic keeps using `galaxy` (identical nodes/links).
  const themedGalaxy = useMemo<GalaxyDoc>(() => {
    if (galaxy.theme?.skin === "theatre") return galaxy;
    if (galaxy.theme?.starPalette || galaxy.theme?.nebulaColors) return galaxy;
    const p = galaxyPalette(galaxy.id);
    return {
      ...galaxy,
      theme: { ...galaxy.theme, starPalette: p.stars, nebulaColors: p.nebula },
    };
  }, [galaxy]);

  const selected = galaxy.nodes.find((n) => n.id === selectedId);

  // The battle briefing now lives on the map (no separate screen): opening it
  // focuses the camera on the node; closing eases back to the overview.
  const [battleNodeId, setBattleNodeId] = useState<string | null>(null);
  const battleNode = battleNodeId
    ? galaxy.nodes.find((n) => n.id === battleNodeId)
    : undefined;
  const battleMode: "attack" | "defend" = state?.incursions.some(
    (i) => i.nodeId === battleNodeId,
  )
    ? "defend"
    : "attack";
  // The soonest-expiring incursion drives the single 3D warning marker; the
  // header lists them all.
  const primaryIncursion = state?.incursions
    .slice()
    .sort((a, b) => a.expiresOnTurn - b.expiresOnTurn)[0];

  // Space skins get a soft two-tone nebula wash behind the (transparent) GL
  // canvas; a theatre map keeps the flat backdrop.
  const backdrop =
    galaxy.theme?.skin === "theatre"
      ? undefined
      : {
          background:
            "radial-gradient(60% 55% at 22% 18%, rgba(24,48,90,0.55) 0%, transparent 60%)," +
            "radial-gradient(55% 55% at 82% 88%, rgba(58,20,52,0.5) 0%, transparent 62%)," +
            "#05070f",
        };

  // Wait for the saved run to load before building the map: otherwise the first
  // build frames the *default* faction (state not yet known) and recentres with
  // a jump once the played faction resolves.
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#05070f]">
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-hidden
        />
      </div>
    );
  }

  return (
    <div
      className="relative h-full overflow-hidden bg-[#05070f]"
      style={backdrop}
    >
      <GalaxyView
        galaxy={themedGalaxy}
        owners={owners}
        playerFactionId={playerFactionId}
        selectedId={selectedId}
        incursion={primaryIncursion}
        onSelect={(id) => {
          setSelectedId(id);
          setFactionFocus(null);
        }}
        visibleIds={visibleIds}
        spaceMaps={spaceMaps}
        focusNodeId={battleNodeId ?? factionFocus}
        focusBiasX={state ? 0 : 0.13}
        display={{ reduceMotion, effects, performanceMode }}
        className="absolute inset-0"
      />
      {effects && <AmbienceAudio galaxy={galaxy} />}

      {/* Legibility scrim so the transparent top bar reads over a bright field */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[9] h-28 bg-gradient-to-b from-background/85 via-background/25 to-transparent"
      />

      {/* Top status bar: a row of separate console cards. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 p-3">
        <div className="flex flex-wrap items-stretch gap-2">
          {/* Back to Conquest — arrow only, its own card. */}
          <BracketFrame className="pointer-events-auto flex items-stretch">
            <Link
              to="/conquest"
              aria-label="Conquest"
              className="flex items-center justify-center px-3 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
          </BracketFrame>
          {/* Galaxy title. The share action for a procedurally generated
              galaxy lives on the Conquest list now (issue #499), not here. */}
          <BracketFrame className="pointer-events-auto flex items-center gap-2 px-3 py-2">
            <span className="font-display text-sm font-semibold uppercase tracking-wide text-foreground">
              {galaxy.title}
            </span>
            {galaxy.importedChallenge && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Imported challenge
              </span>
            )}
          </BracketFrame>
          {/* Turn — its own card with a large number, sized to content. */}
          {state && (
            <BracketFrame className="pointer-events-auto flex flex-col justify-center px-3 py-1.5">
              <span className="font-display text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Turn
              </span>
              <span className="font-display text-xl font-semibold uppercase leading-none tracking-wide tabular-nums text-foreground">
                {state.turn}
              </span>
            </BracketFrame>
          )}
          {/* One clickable card per faction — click flies the camera to their
              territory (capital, or nearest system they still hold). */}
          {state && (
            <TerritoryTally
              galaxy={galaxy}
              state={state}
              visible={visibleIds}
              logos={factionLogos}
              onFocusFaction={(fid) => {
                const targetId = factionFocusNode(galaxy, state.owners, fid);
                setSelectedId(null);
                setFactionFocus((cur) =>
                  targetId && cur !== targetId ? targetId : null,
                );
              }}
            />
          )}
          {/* Advance the galaxy a turn without fighting — the world moves while
              you hold. */}
          {state && state.status === "active" && (
            <BracketFrame className="pointer-events-auto flex items-stretch">
              <button
                type="button"
                onClick={() => saveFor(galaxy.id, advanceTurn(galaxy, state))}
                className="flex items-center gap-1.5 px-2.5 py-2 font-display text-[11px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
              >
                <Hourglass className="size-3.5" aria-hidden /> Hold
              </button>
            </BracketFrame>
          )}
        </div>
        {state && state.status === "active" && state.incursions.length > 0 && (
          <div className="flex flex-col items-end gap-2">
            {state.incursions
              .slice()
              .sort((a, b) => a.expiresOnTurn - b.expiresOnTurn)
              .map((inc) => {
                const left = Math.max(0, inc.expiresOnTurn - state.turn);
                return (
                  <BracketFrame
                    key={inc.nodeId}
                    accent="amber"
                    className="pointer-events-auto"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setFactionFocus(null);
                        setSelectedId(inc.nodeId);
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-xs text-amber-200 transition-colors hover:text-amber-100"
                    >
                      <ShieldAlert
                        className="size-4 animate-pulse"
                        aria-hidden
                      />
                      Incursion at{" "}
                      {galaxy.nodes.find((n) => n.id === inc.nodeId)?.name ??
                        "?"}{" "}
                      — falls in {left} turn{left === 1 ? "" : "s"}
                    </button>
                  </BracketFrame>
                );
              })}
          </div>
        )}
      </div>

      {/* Right-hand selection panel (hidden while a battle briefing is open).
          Its own close button (and clicking empty space) clears the selection —
          no separate back-arrow control needed. */}
      {state && selected && state.status === "active" && !battleNodeId && (
        <SelectionPanel
          galaxy={galaxy}
          state={state}
          node={selected}
          attackable={attackable.has(selected.id)}
          voidBody={voidBodies.get(selected.id)}
          dataDir={target?.dataDir}
          onBattle={setBattleNodeId}
          onRestoreMap={restoreMap}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Battle briefing, over the live (zoomed) map */}
      {state && battleNode && state.status === "active" && (
        <BattleOverlay
          galaxy={galaxy}
          node={battleNode}
          state={state}
          mode={battleMode}
          onRestoreMap={restoreMap}
          onClose={() => setBattleNodeId(null)}
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

      {/* What the galaxy did on the last enemy round. */}
      {state &&
        state.status === "active" &&
        !battleNodeId &&
        state.lastRound &&
        state.lastRound.length > 0 && (
          <TurnRecap galaxy={galaxy} events={state.lastRound} />
        )}

      <p
        className={`pointer-events-none absolute bottom-2 left-3 z-10 px-2 py-1 text-[11px] ${MAP_BAND_CLASS} ${MAP_DIM_INK_CLASS}`}
      >
        drag to pan · scroll to zoom · right-drag to tilt
      </p>
    </div>
  );
}

/** A compact "Last turn" panel listing the enemy round's captures, so the
 * living galaxy's moves are legible. Names resolve from the doc; a capture from
 * NEUTRAL reads as a claim, a capture from a faction as a conquest. */
function TurnRecap({
  galaxy,
  events,
}: {
  galaxy: GalaxyDoc;
  events: TurnEvent[];
}) {
  const nodeName = (id: string) =>
    galaxy.nodes.find((n) => n.id === id)?.name ?? "?";
  const factionName = (id: string) =>
    id === NEUTRAL
      ? "neutral space"
      : (galaxy.factions.find((f) => f.id === id)?.name ?? id);
  return (
    <div
      className={`pointer-events-none absolute bottom-11 left-3 z-10 flex max-w-xs flex-col gap-1 px-2.5 py-2 backdrop-blur-sm ${MAP_BAND_CLASS}`}
    >
      <span
        className={`font-display text-[10px] uppercase tracking-[0.18em] ${MAP_DIM_INK_CLASS}`}
      >
        Last turn
      </span>
      {events.slice(0, 5).map((e) => (
        <span
          key={`${e.factionId}-${e.nodeId}`}
          className={`text-[11px] ${MAP_INK_CLASS}`}
        >
          {factionName(e.factionId)} took {nodeName(e.nodeId)}
          {e.from !== NEUTRAL ? ` from ${factionName(e.from)}` : ""}
        </span>
      ))}
      {events.length > 5 && (
        <span className={`text-[10px] ${MAP_DIM_INK_CLASS}`}>
          +{events.length - 5} more
        </span>
      )}
    </div>
  );
}

/** One console card per faction — emblem (tinted to the faction colour), name
 * and node count — plus a neutral card. Clicking a faction card flies the camera
 * to their territory. Under fog only revealed systems are counted, so the tally
 * never leaks enemy positions. Emitted as siblings into the status-bar row. */
function TerritoryTally({
  galaxy,
  state,
  visible,
  logos,
  onFocusFaction,
}: {
  galaxy: GalaxyDoc;
  state: ConquestState;
  visible?: Set<string>;
  logos: Record<string, FactionLogoSrc>;
  onFocusFaction: (factionId: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const n of galaxy.nodes) {
    if (visible && !visible.has(n.id)) continue;
    const o = state.owners[n.id] ?? NEUTRAL;
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return (
    <>
      {galaxy.factions.map((f) => {
        const isPlayer = f.id === state.playerFactionId;
        const logo = f.side ? logos[f.side.toLowerCase()] : undefined;
        return (
          <BracketFrame
            key={f.id}
            accent={isPlayer ? "teal" : "neutral"}
            className="pointer-events-auto flex items-stretch"
          >
            <button
              type="button"
              onClick={() => onFocusFaction(f.id)}
              className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {logo ? (
                <FactionLogo
                  logo={logo}
                  sideName={f.side}
                  tint={f.color}
                  size={18}
                />
              ) : (
                <FactionDot
                  color={f.color}
                  sides={factionSides(galaxy, f.id)}
                />
              )}
              <span
                className={`font-display text-[11px] uppercase tracking-wide ${
                  isPlayer ? "text-foreground" : ""
                }`}
              >
                {f.name}
              </span>
              {isPlayer && (
                <span
                  className={`font-display text-[9px] uppercase tracking-[0.18em] ${HUD_ACCENT_INK.teal}`}
                >
                  You
                </span>
              )}
              <span className="font-mono tabular-nums text-foreground">
                {counts.get(f.id) ?? 0}
              </span>
            </button>
          </BracketFrame>
        );
      })}
      {(counts.get(NEUTRAL) ?? 0) > 0 && (
        <BracketFrame className="pointer-events-auto flex items-center gap-1.5 px-2.5 py-2 text-xs text-muted-foreground">
          <FactionDot color="#6b7280" />
          <span className="font-display text-[11px] uppercase tracking-wide">
            Neutral
          </span>
          <span className="font-mono tabular-nums text-foreground">
            {counts.get(NEUTRAL)}
          </span>
        </BracketFrame>
      )}
    </>
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
  voidBody,
  dataDir,
  onBattle,
  onRestoreMap,
  onClose,
}: {
  galaxy: GalaxyDoc;
  state: ConquestState;
  node: GalaxyNode;
  attackable: boolean;
  voidBody: VoidBody | undefined;
  dataDir: string | undefined;
  onBattle: (nodeId: string) => void;
  /** Put this system back on the map the challenge named for it (issue #1834). */
  onRestoreMap: (nodeId: string) => Promise<void>;
  onClose: () => void;
}) {
  const owner = state.owners[node.id] ?? NEUTRAL;
  const faction = galaxy.factions.find((f) => f.id === owner);
  const isPlayers = owner === state.playerFactionId;
  const underIncursion = state.incursions.some((i) => i.nodeId === node.id);

  return (
    <BracketFrame
      accentColor={faction?.color}
      className="pointer-events-auto absolute right-3 top-16 z-10 flex w-72 flex-col gap-3 p-4 backdrop-blur-sm"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
            {node.name}
          </h2>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FactionDot
              color={faction?.color ?? "#6b7280"}
              sides={faction ? factionSides(galaxy, faction.id) : 0}
            />
            {faction?.name ?? "Unclaimed"}
            {node.kind === "capital" && " · Capital"}
          </span>
          {galaxy.theme?.skin !== "theatre" && (
            <span className="text-xs capitalize text-muted-foreground">
              {nodeBodyLabel(
                node.id,
                node.kind === "capital",
                voidBody,
                node.star,
              )}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          ×
        </Button>
      </header>
      <dl className="flex flex-col gap-1.5 text-xs">
        <div className="flex items-center justify-between">
          <dt className="font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Difficulty
          </dt>
          <dd>
            <DifficultyPips value={node.difficulty} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Battlefield
          </dt>
          <dd className="min-w-0 text-right">
            <span className="block truncate">{node.battle.mapName}</span>
            <SubstitutedMapNote
              original={node.battle.mapSubstitutedFrom}
              onRestore={() => onRestoreMap(node.id)}
            />
          </dd>
        </div>
      </dl>
      {node.blurb && (
        <p className="text-xs text-muted-foreground">{node.blurb}</p>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Battle history
        </span>
        <ReplayHistoryList
          dataDir={dataDir}
          match={(p) =>
            p.mode === "conquest" &&
            p.galaxyId === galaxy.id &&
            p.nodeId === node.id
          }
          emptyLabel="No battles fought here yet."
        />
      </div>
      {underIncursion ? (
        <Button className="w-full" onClick={() => onBattle(node.id)}>
          <ShieldAlert className="mr-1.5 size-4" aria-hidden /> Defend
        </Button>
      ) : attackable ? (
        <Button className="w-full" onClick={() => onBattle(node.id)}>
          <Swords className="mr-1.5 size-4" aria-hidden /> Attack
        </Button>
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
    </BracketFrame>
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
  const factionLogos = useFactionLogos({
    game: installedGame ?? undefined,
    enginePath: target?.enginePath,
    dataDir: target?.dataDir,
    gameArchive: installedGame?.primaryArchive.name,
    sideNames: choices.map((f) => f.side ?? "").filter(Boolean),
  });

  // The player plays the side their chosen faction *is*, not a free-floating
  // pick — that let you e.g. play the blue "Arm" faction as Core. Canonicalise
  // the faction's side to the game's actual side name (case-insensitive) so the
  // engine gets a valid side; fall back to the manual picker only when the
  // faction carries no side.
  const { info: gameInfo } = useUnitsyncGameInfo(
    target?.enginePath,
    target?.dataDir,
    installedGame?.primaryArchive.name,
  );
  const chosenFaction = choices.find((f) => f.id === faction);
  const chosenSide = chosenFaction?.side
    ? ((gameInfo?.sides ?? []).find(
        (s) => s.name.toLowerCase() === chosenFaction.side?.toLowerCase(),
      )?.name ?? chosenFaction.side)
    : undefined;
  const chosenSideLogo = chosenSide
    ? factionLogos[chosenSide.toLowerCase()]
    : undefined;
  const effectiveSide = chosenSide || side || undefined;

  // Reroll in place: same knobs (persisted on the doc), fresh seed, content
  // environment (maps/names) re-resolved from what's installed right now.
  const brandingEntries = useBrandingCatalog();
  const { eligible } = useMapEligibility();
  const brandingEntry = installedGame
    ? resolveBranding(brandingEntries, installedGame)
    : null;
  const canRegenerate =
    galaxy.generated?.nodeCount !== undefined &&
    galaxy.generated?.factionCount !== undefined;
  const [regenBusy, setRegenBusy] = useState(false);
  const regenerate = async () => {
    const maps = eligible(scan.data?.maps ?? []);
    if (maps.length === 0) return;
    setRegenBusy(true);
    try {
      const doc = regenerateGalaxy(
        galaxy,
        {
          maps,
          names: mergeConquestNames(
            getProfile().conquest,
            brandingEntry?.conquest,
          ),
        },
        Math.floor(Math.random() * 100000),
      );
      if (!doc) return;
      await conquestSave({ id: doc.id, json: JSON.stringify(doc) });
      await refreshGalaxies();
    } finally {
      setRegenBusy(false);
    }
  };

  return (
    <BracketFrame
      accent="teal"
      className="pointer-events-auto absolute right-3 top-16 z-10 flex max-h-[calc(100%-5rem)] w-[22rem] max-w-[90%] flex-col gap-4 overflow-auto p-4 backdrop-blur-sm"
    >
      <header className="flex flex-col gap-1 border-b border-border/40 pb-3">
        <span
          className={`font-display text-[10px] font-medium uppercase tracking-[0.24em] ${HUD_ACCENT_INK.teal}`}
        >
          New campaign
        </span>
        <h2 className="font-display text-2xl font-bold uppercase leading-none tracking-wide text-foreground">
          Begin conquest
        </h2>
        <p className="pt-0.5 text-xs text-muted-foreground">
          {galaxy.description}
        </p>
      </header>
      {choices.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span
            className={`font-display text-[10px] font-medium uppercase tracking-[0.2em] ${HUD_ACCENT_INK.teal}`}
          >
            Play as
          </span>
          <div className="flex flex-wrap gap-1.5">
            {choices.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onFaction(f.id)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-display text-[11px] uppercase tracking-wide transition-colors ${
                  faction === f.id
                    ? "border-cyan-400 bg-cyan-400/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {f.side && factionLogos[f.side.toLowerCase()] ? (
                  <FactionLogo
                    logo={factionLogos[f.side.toLowerCase()]}
                    sideName={f.side}
                    tint={f.color}
                    size={18}
                  />
                ) : (
                  <FactionDot
                    color={f.color}
                    sides={factionSides(galaxy, f.id)}
                  />
                )}
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {chosenSide ? (
        <div className="flex flex-col gap-1.5">
          <span
            className={`font-display text-[10px] font-medium uppercase tracking-[0.2em] ${HUD_ACCENT_INK.teal}`}
          >
            Side
          </span>
          <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
            {chosenSideLogo ? (
              <FactionLogo
                logo={chosenSideLogo}
                sideName={chosenSide}
                tint={chosenFaction?.color}
                size={20}
              />
            ) : (
              chosenFaction && (
                <FactionDot
                  color={chosenFaction.color}
                  sides={factionSides(galaxy, chosenFaction.id)}
                />
              )
            )}
            <span className="font-display text-xs uppercase tracking-wide text-foreground">
              {chosenSide}
            </span>
          </div>
        </div>
      ) : (
        <SidePicker
          enginePath={target?.enginePath}
          dataDir={target?.dataDir}
          gameArchive={installedGame?.primaryArchive.name}
          value={side}
          onChange={setSide}
        />
      )}
      {canRegenerate && (
        <Button
          variant="outline"
          disabled={regenBusy || busy || !scan.data}
          onClick={regenerate}
        >
          <Dices className="mr-1.5 size-4" aria-hidden />
          {regenBusy ? "Regenerating…" : "Regenerate galaxy"}
        </Button>
      )}
      <Button
        disabled={busy || regenBusy}
        className="font-display uppercase tracking-wide"
        onClick={async () => {
          setBusy(true);
          try {
            await onStart(effectiveSide);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          "Starting…"
        ) : (
          <>
            <Swords className="mr-1.5 size-4" aria-hidden /> Start conquest
          </>
        )}
      </Button>
    </BracketFrame>
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
      <BracketFrame className="flex w-[26rem] max-w-[90%] flex-col items-center gap-3 p-6 text-center">
        <h2
          className={`font-display text-2xl font-bold uppercase tracking-wide ${won ? "text-emerald-400" : HUD_ACCENT_INK.danger}`}
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
        <p className="text-xs text-muted-foreground">
          Starting again resets {galaxy.title} with a new seed.
        </p>
      </BracketFrame>
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
