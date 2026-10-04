import { useMemo } from "react";
import { GalaxyView } from "../conquest/galaxy3d/GalaxyView";
import type { TerrainPixels } from "../conquest/galaxy3d/terrainLoad";
import { generatedTerrain } from "../conquest/territories";
import { useKnownSpaceMaps } from "../content/mapAppearanceCache";
import {
  useEffectsEnabled,
  usePerformanceMode,
  useReduceMotion,
} from "../general/display";
import {
  mapRunEmphasis,
  mapRunIdentities,
  mapRunOwners,
  mapRunPathLinks,
  mapRunToGalaxyDoc,
  PLAYER_FACTION,
  runEmphasis,
  runIdentities,
  runLocations,
  runOwners,
  runPathLinks,
  runToGalaxyDoc,
} from "./galaxyAdapter";
import { resolveRunMap } from "./mapRun";
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
 *
 * A run across a land map (`run.settings.map`) is drawn on that map instead:
 * the map document goes to the view with the run's state laid over it. The
 * view speaks in location ids there, so the ids going in and the selection
 * coming out are translated. A run whose map cannot be had falls back to the
 * column layout.
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
  // The map a land run crosses, built again from the run's settings, and which
  // location each run node stands for. Both null for a column run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the map settings and the graph, both stable across moves
  const land = useMemo(() => {
    const ref = run.settings.map;
    const map = ref ? resolveRunMap(ref, run.settings.game)?.map : undefined;
    const locations = map ? runLocations(run, map) : null;
    return map && locations ? { map, locations } : null;
  }, [run.settings.map, run.settings.game, run.nodes, run.edges]);
  const terrainPixels = useMemo((): TerrainPixels | undefined => {
    const terrain = land ? generatedTerrain(land.map) : null;
    if (!terrain) return undefined;
    const { width, height } = terrain;
    return {
      color: { data: terrain.image, width, height },
      height: { data: terrain.heightmap, width, height },
    };
  }, [land]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately keyed on the run's structure, not the whole run, so advancing doesn't rebuild the scene
  const doc = useMemo(
    () =>
      land
        ? mapRunToGalaxyDoc(run, land.map, land.locations)
        : runToGalaxyDoc(run),
    [land, run.nodes, run.edges, run.settings.skin, run.settings.seed],
  );
  // Per-node identity bodies (station/wreck/anomaly/beacon/warlord) + battle
  // danger-tints. Derived from the run's stable structure, so it's a build-time
  // prop — a new map rebuilds the scene, which only happens when the graph does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the graph + seed, both stable across moves
  const identities = useMemo(
    () => (land ? mapRunIdentities(run, land.locations) : runIdentities(run)),
    [land, run.nodes, run.settings.seed],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: owners depend only on progress moving, applied live by GalaxyView
  const owners = useMemo(
    () => (land ? mapRunOwners(run, land.map, land.locations) : runOwners(run)),
    [land, run.nodes, run.progress.currentNodeId, run.progress.visited],
  );
  // Graded de-emphasis: same live channel as owners, keyed on progress + the
  // graph (edges decide what's still reachable).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on progress + graph, applied live by GalaxyView
  const emphasis = useMemo(
    () =>
      land ? mapRunEmphasis(run, land.map, land.locations) : runEmphasis(run),
    [
      land,
      run.nodes,
      run.edges,
      run.progress.currentNodeId,
      run.progress.visited,
    ],
  );
  // The path already travelled, highlighted green up to the current node.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on progress + graph, applied live by GalaxyView
  const pathLinks = useMemo(
    () => (land ? mapRunPathLinks(run, land.locations) : runPathLinks(run)),
    [land, run.nodes, run.edges, run.progress.visited],
  );

  // On a land map the view knows locations, and the page knows run nodes.
  const nodeIdAt = useMemo(
    () => new Map([...(land?.locations ?? [])].map(([id, at]) => [at, id])),
    [land],
  );
  const toView = (id: string | null | undefined) =>
    id ? (land?.locations.get(id) ?? id) : (id ?? null);
  const onViewSelect =
    onSelect && land
      ? (at: string | null) => {
          if (at === null) return onSelect(null);
          // Scenery has no run node, so a click on it selects nothing.
          const id = nodeIdAt.get(at);
          if (id) onSelect(id);
        }
      : onSelect;

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
      depthMood={!land}
      laneFlow
      pathLinks={pathLinks}
      burstNodeId={toView(burstNodeId)}
      playerFactionId={PLAYER_FACTION}
      selectedId={toView(selectedId)}
      onSelect={onViewSelect}
      focusNodeId={toView(focusId)}
      terrainPixels={terrainPixels}
      spaceMaps={spaceMaps}
      display={{ reduceMotion, effects, performanceMode }}
      className={className}
    />
  );
}
