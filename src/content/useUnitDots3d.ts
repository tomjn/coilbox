import { useEffect, useRef } from "react";

import type { MapScene3D } from "@/lib/mapScene";
import type { UnitIcons } from "./replayMapView/icons";
import type { TeamStyle } from "./replayMapView/paint";
import {
  createUnitDotsLayer,
  type DotGround,
  type UnitDotsLayer,
} from "./replayMapView/unitDots3d";
import type { ReplayTrackHandle } from "./replayTrack";
import { useMatchClock } from "./useMatchClock";

/**
 * Puts the recorded match's units on the 3D view as the game's icons, or dots
 * where there are none, at the page's match clock. Nothing is drawn without the scene, the open track and the ground to
 * stand on. The layer is made again when any of those changes and disposed when
 * the view unmounts.
 *
 * `track` must be the handle the flat map reads too, and `null` until the
 * match clock has the track's range.
 */
export function useUnitDots3d(
  view: MapScene3D | null,
  track: ReplayTrackHandle | null,
  teams: ReadonlyMap<number, TeamStyle>,
  ground: DotGround | null,
  icons: UnitIcons | null,
): void {
  const { clock } = useMatchClock();
  const layerRef = useRef<UnitDotsLayer | null>(null);
  const teamsRef = useRef(teams);
  teamsRef.current = teams;
  const iconsRef = useRef(icons);
  iconsRef.current = icons;

  useEffect(() => {
    if (!view || !track || !ground) return;
    const layer = createUnitDotsLayer({
      view,
      track,
      clock,
      teams: teamsRef.current,
      ground,
      icons: iconsRef.current,
      env: {
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (id) => cancelAnimationFrame(id),
      },
    });
    layerRef.current = layer;
    return () => {
      layer.dispose();
      layerRef.current = null;
    };
  }, [view, track, ground, clock]);

  useEffect(() => {
    layerRef.current?.setTeams(teams);
  }, [teams]);

  useEffect(() => {
    layerRef.current?.setIcons(icons);
  }, [icons]);
}
