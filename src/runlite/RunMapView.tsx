import { useMemo } from "react";
import { GalaxyView } from "../conquest/galaxy3d/GalaxyView";
import { useKnownSpaceMaps } from "../content/mapAppearanceCache";
import {
  useEffectsEnabled,
  usePerformanceMode,
  useReduceMotion,
} from "../general/display";
import {
  PLAYER_FACTION,
  runEmphasis,
  runIdentities,
  runOwners,
  runPathLinks,
  runToGalaxyDoc,
} from "./galaxyAdapter";
import type { RogueliteRun } from "./model";

/**
 * The run map. Rather than a bespoke renderer, it adapts the run into a
 * conquest `GalaxyDoc` (see `galaxyAdapter`) and renders it through the real
 * `GalaxyView`, inheriting its full visual language (stellar classes, binaries,
 * coronas, asteroid/comet void bodies, connection styling, nebula/starfield
 * backdrop, theatre skin) and camera (focus-on-select zoom, snap-back rotation,
 * eased transitions).
 *
 * The GalaxyDoc is memoised on the run's *structure* (nodes/edges/skin), which
 * the pure transitions preserve by identity across moves, so advancing doesn't
 * rebuild the scene — only `owners`/`selectedId`/`focusId` change, which
 * GalaxyView applies live.
 */
export function RunMapView({
  run,
  selectedId,
  onSelect,
  focusId,
  burstNodeId,
  className,
}: {
  run: RogueliteRun;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Zoom/centre the camera on this node (the briefed one); null frames all. */
  focusId?: string | null;
  /** Fire a one-shot win burst on this node (e.g. a battle just won). */
  burstNodeId?: string | null;
  className?: string;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately keyed on the run's structure, not the whole run, so advancing doesn't rebuild the scene
  const doc = useMemo(
    () => runToGalaxyDoc(run),
    [run.nodes, run.edges, run.settings.skin, run.settings.seed],
  );
  // Per-node identity bodies (station/wreck/anomaly/beacon/warlord) + battle
  // danger-tints. Derived from the run's stable structure, so it's a build-time
  // prop — a new map rebuilds the scene, which only happens when the graph does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the graph + seed, both stable across moves
  const identities = useMemo(
    () => runIdentities(run),
    [run.nodes, run.settings.seed],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: owners depend only on progress moving, applied live by GalaxyView
  const owners = useMemo(
    () => runOwners(run),
    [run.nodes, run.progress.currentNodeId, run.progress.visited],
  );
  // Graded de-emphasis: same live channel as owners, keyed on progress + the
  // graph (edges decide what's still reachable).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on progress + graph, applied live by GalaxyView
  const emphasis = useMemo(
    () => runEmphasis(run),
    [run.nodes, run.edges, run.progress.currentNodeId, run.progress.visited],
  );
  // The path already travelled, highlighted green up to the current node.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on progress + graph, applied live by GalaxyView
  const pathLinks = useMemo(
    () => runPathLinks(run),
    [run.nodes, run.edges, run.progress.visited],
  );

  // The maps this run's nodes are played on, so the hub can say which are void
  // for the ones this machine has not got (issue #1739).
  const nodeMaps = useMemo(
    () => doc.nodes.map((n) => n.battle.mapName).filter(Boolean),
    [doc.nodes],
  );
  const spaceMaps = useKnownSpaceMaps(nodeMaps);
  const reduceMotion = useReduceMotion();
  const effects = useEffectsEnabled();
  const performanceMode = usePerformanceMode();

  return (
    <GalaxyView
      galaxy={doc}
      owners={owners}
      emphasis={emphasis}
      identities={identities}
      depthMood
      laneFlow
      pathLinks={pathLinks}
      burstNodeId={burstNodeId}
      playerFactionId={PLAYER_FACTION}
      selectedId={selectedId}
      onSelect={onSelect}
      focusNodeId={focusId ?? null}
      spaceMaps={spaceMaps}
      display={{ reduceMotion, effects, performanceMode }}
      className={className}
    />
  );
}
