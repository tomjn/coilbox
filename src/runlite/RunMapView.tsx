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
  runOwners,
  runToGalaxyDoc,
  runVisible,
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
  className,
}: {
  run: RogueliteRun;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Zoom/centre the camera on this node (the briefed one); null frames all. */
  focusId?: string | null;
  className?: string;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately keyed on the run's structure, not the whole run, so advancing doesn't rebuild the scene
  const doc = useMemo(
    () => runToGalaxyDoc(run),
    [run.nodes, run.edges, run.settings.skin],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: owners/fog depend only on progress moving, applied live by GalaxyView
  const owners = useMemo(
    () => runOwners(run),
    [run.nodes, run.progress.currentNodeId, run.progress.visited],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  const visibleIds = useMemo(
    () => runVisible(run),
    [run.nodes, run.edges, run.progress.currentNodeId, run.progress.status],
  );

  const spaceMaps = useKnownSpaceMaps();
  const reduceMotion = useReduceMotion();
  const effects = useEffectsEnabled();
  const performanceMode = usePerformanceMode();

  return (
    <GalaxyView
      galaxy={doc}
      owners={owners}
      playerFactionId={PLAYER_FACTION}
      selectedId={selectedId}
      onSelect={onSelect}
      focusNodeId={focusId ?? null}
      visibleIds={visibleIds}
      spaceMaps={spaceMaps}
      display={{ reduceMotion, effects, performanceMode }}
      className={className}
    />
  );
}
